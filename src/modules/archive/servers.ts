import { requestUrl, type App, type RequestUrlParam, type RequestUrlResponse } from "obsidian";
import { archiveName, nameOf } from "./resolver";
import { serverUrls, type ArchiveSettings } from "./settings";
import { DeviceState } from "../../library/deviceState";

const PROBE_TIMEOUT_MS = 4_000;
// A server that answered is trusted for a while; one that didn't is asked
// again soon, so turning Tailscale on is noticed without a reload.
const UP_TTL_MS = 5 * 60_000;
const DOWN_TTL_MS = 30_000;

export interface ServersHost {
	app: App;
	settings: ArchiveSettings;
	/** The local archive file at `path` (as `resolve` gives it), or null if it's gone. */
	readLocal(path: string): Promise<ArrayBuffer | null>;
	/** Keep `buf` at local archive path `path` until the servers have it. */
	writeLocal(path: string, buf: ArrayBuffer): Promise<void>;
	removeLocal(path: string): Promise<void>;
}

/**
 * Where a newly archived file is kept on this device: "kept" in the local
 * archive; in the local archive only until every server has it ("outbox");
 * or nowhere ("none": mobile, with the archive folder outside the vault).
 */
export type LocalCopy = "kept" | "outbox" | "none";

/**
 * The archive servers in the settings: whether each can be reached right now,
 * and reading and writing files on them over WebDAV (GET / PUT / MKCOL).
 *
 * Every server gets every archived file. One that is unreachable when a file
 * is archived gets it later: the file waits in this device's queue until
 * `flush`. The queue is kept on the device, not in data.json: Sync shares
 * that, and another device would find the files missing and drop them.
 */
export class ArchiveServers {
	private status = new Map<string, { up: boolean; at: number }>();
	private probing = new Map<string, Promise<boolean>>();
	private flushing = new Map<string, Promise<number>>();
	private device: DeviceState | null = null;
	/** Per server URL: archived files (local archive paths) not uploaded there yet. */
	private pendingMap: Record<string, string[]> | null = null;
	/** Local archive paths kept only until the servers have them. */
	private outboxList: string[] | null = null;

	constructor(private host: ServersHost) {}

	private get state(): DeviceState {
		return (this.device ??= new DeviceState(this.host.app));
	}

	private get pending(): Record<string, string[]> {
		return (this.pendingMap ??= this.state.get<Record<string, string[]>>("archivePendingUploads", {}));
	}

	private get outbox(): string[] {
		return (this.outboxList ??= this.state.get<string[]>("archiveOutbox", []));
	}

	private keep(): void {
		this.state.set("archivePendingUploads", this.pending);
		this.state.set("archiveOutbox", this.outbox);
	}

	/** Take over a queue saved elsewhere (data.json, by earlier versions). */
	adopt(queue: Record<string, string[]>): void {
		let added = 0;
		for (const [base, paths] of Object.entries(queue)) {
			for (const p of paths) if (this.queue(base, p)) added++;
		}
		if (added) this.keep();
	}

	/** The queue as it is now: per server, the files waiting for it. */
	queued(): Record<string, string[]> {
		return this.pending;
	}

	/** Replace the queue, e.g. with the server's address changed. */
	replaceQueue(queue: Record<string, string[]>): void {
		this.pendingMap = queue;
		this.keep();
	}

	/** Stop waiting to upload to `base` (it was removed from the sources). */
	forget(base: string): void {
		if (!(base in this.pending)) return;
		delete this.pending[base];
		this.keep();
	}

	/** Checked once and remembered, so a page of images doesn't each wait out a timeout when a server is off. */
	reachable(base: string): Promise<boolean> {
		const last = this.status.get(base);
		if (last && Date.now() - last.at < (last.up ? UP_TTL_MS : DOWN_TTL_MS)) return Promise.resolve(last.up);
		const running = this.probing.get(base);
		if (running) return running;
		const result = probe(base).then((up) => {
			this.status.set(base, { up, at: Date.now() });
			this.probing.delete(base);
			if (up && this.pending[base]?.length) void this.flush(base);
			return up;
		});
		this.probing.set(base, result);
		return result;
	}

	/** Each server's state, in settings order. */
	async check(): Promise<Map<string, boolean>> {
		const urls = serverUrls(this.host.settings.sources);
		const up = await Promise.all(urls.map((u) => this.reachable(u)));
		return new Map(urls.map((u, i) => [u, up[i]]));
	}

	/** The server copy of the file archived for `url`, from the first server that has it. */
	fetch(url: string): Promise<ArrayBuffer | null> {
		return this.fetchName(archiveName(url));
	}

	private async fetchName(name: string, except?: string): Promise<ArrayBuffer | null> {
		for (const [base, up] of await this.check()) {
			if (!up || base === except) continue;
			const r = await request({ url: `${base}/${name}` });
			if (r?.status === 200) return r.arrayBuffer;
		}
		return null;
	}

	/** Whether any reachable server has the file archived for `url`. */
	async storedAnywhere(url: string): Promise<boolean> {
		const name = archiveName(url);
		for (const [base, up] of await this.check()) {
			if (up && (await this.has(base, name))) return true;
		}
		return false;
	}

	/**
	 * Put a newly archived file (local path `localPath`) on every server, queueing
	 * it for those that can't take it now. Returns how many servers have it.
	 * With `local` "outbox" a server missed means the file is kept locally until
	 * it is uploaded there. With "none" and no server holding it either, there'd
	 * be no copy to upload later, so nothing is queued and the next scan tries again.
	 */
	async store(localPath: string, buf: ArrayBuffer, local: LocalCopy = "kept"): Promise<number> {
		const name = nameOf(localPath);
		let stored = 0;
		const missed: string[] = [];
		for (const [base, up] of await this.check()) {
			if (up && (await this.has(base, name) || await this.upload(base, name, buf))) stored++;
			else missed.push(base);
		}
		if (missed.length === 0 || (local === "none" && stored === 0)) return stored;
		if (local === "outbox") {
			await this.host.writeLocal(localPath, buf);
			if (!this.outbox.includes(localPath)) this.outbox.push(localPath);
		}
		missed.forEach((base) => this.queue(base, localPath));
		this.keep();
		return stored;
	}

	/**
	 * Upload what is waiting for `base`; stop at the first failure and leave the
	 * rest for next time. A flush already running for `base` is waited for.
	 */
	flush(base: string): Promise<number> {
		const running = this.flushing.get(base);
		if (running) return running;
		const p = this.flushNow(base).finally(() => this.flushing.delete(base));
		this.flushing.set(base, p);
		return p;
	}

	private async flushNow(base: string): Promise<number> {
		let done = 0;
		const pending = this.pending;
		while (pending[base]?.length) {
			const localPath = pending[base][0];
			const name = nameOf(localPath);
			if (!(await this.has(base, name))) {
				// No local copy (mobile, or deleted by hand): take it from a server that has it.
				const buf = (await this.host.readLocal(localPath)) ?? (await this.fetchName(name, base));
				if (!buf) console.warn(`[archive-redirect] no copy of ${name} left to upload to ${base}`);
				else if (!(await this.upload(base, name, buf))) break;
			}
			pending[base].shift();
			await this.uploaded(localPath);
			done++;
		}
		if (pending[base]?.length === 0) delete pending[base];
		if (done) this.keep();
		return done;
	}

	/** An outbox copy every server now has is no longer needed here. */
	private async uploaded(localPath: string): Promise<void> {
		const i = this.outbox.indexOf(localPath);
		if (i < 0 || Object.values(this.pending).some((l) => l.includes(localPath))) return;
		await this.host.removeLocal(localPath);
		this.outbox.splice(i, 1);
	}

	/** Flush every server that has files waiting and can be reached. */
	async flushAll(): Promise<void> {
		for (const base of Object.keys(this.pending)) {
			if (await this.reachable(base)) await this.flush(base);
		}
	}

	pendingCount(): number {
		return Object.values(this.pending).reduce((n, l) => n + l.length, 0);
	}

	private async has(base: string, name: string): Promise<boolean> {
		return (await request({ url: `${base}/${name}`, method: "HEAD" }))?.status === 200;
	}

	private async upload(base: string, name: string, body: ArrayBuffer): Promise<boolean> {
		const put = () => request({ url: `${base}/${name}`, method: "PUT", body, contentType: "application/octet-stream" });
		let r = await put();
		if (r?.status === 409) {
			// WebDAV won't create the bucket folder on its own.
			await request({ url: `${base}/${name.substring(0, name.indexOf("/"))}`, method: "MKCOL" });
			r = await put();
		}
		return !!r && r.status >= 200 && r.status < 300;
	}

	private queue(base: string, localPath: string): boolean {
		const list = (this.pending[base] ??= []);
		if (list.includes(localPath)) return false;
		list.push(localPath);
		return true;
	}
}

/** A response, or null when the request never got one (offline, DNS, refused). */
async function request(param: RequestUrlParam): Promise<RequestUrlResponse | null> {
	try {
		return await requestUrl({ ...param, throw: false });
	} catch {
		return null;
	}
}

/** Any HTTP answer counts: the server is there, whatever it says about `/`. */
async function probe(base: string): Promise<boolean> {
	let timer: number | undefined;
	try {
		return await Promise.race([
			request({ url: base + "/", method: "HEAD" }).then((r) => r !== null),
			new Promise<boolean>((r) => {
				timer = window.setTimeout(() => r(false), PROBE_TIMEOUT_MS);
			}),
		]);
	} finally {
		window.clearTimeout(timer);
	}
}
