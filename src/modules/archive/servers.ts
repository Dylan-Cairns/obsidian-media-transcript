import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from "obsidian";
import { archiveName, nameOf } from "./resolver";
import { serverUrls, type ArchiveSettings } from "./settings";

const PROBE_TIMEOUT_MS = 4_000;
// A server that answered is trusted for a while; one that didn't is asked
// again soon, so turning Tailscale on is noticed without a reload.
const UP_TTL_MS = 5 * 60_000;
const DOWN_TTL_MS = 30_000;

export interface ServersHost {
	settings: ArchiveSettings;
	saveSettings(): Promise<void>;
	/** The local archive file at `path` (as `resolve` gives it), or null if it's gone. */
	readLocal(path: string): Promise<ArrayBuffer | null>;
}

/**
 * The archive servers in the settings: whether each can be reached right now,
 * and reading and writing files on them over WebDAV (GET / PUT / MKCOL).
 *
 * Every server gets every archived file. One that is unreachable when a file
 * is archived gets it later: the file waits in `pendingUploads` until `flush`.
 */
export class ArchiveServers {
	private status = new Map<string, { up: boolean; at: number }>();
	private probing = new Map<string, Promise<boolean>>();
	private flushing = new Set<string>();

	constructor(private host: ServersHost) {}

	/** Checked once and remembered, so a page of images doesn't each wait out a timeout when a server is off. */
	reachable(base: string): Promise<boolean> {
		const last = this.status.get(base);
		if (last && Date.now() - last.at < (last.up ? UP_TTL_MS : DOWN_TTL_MS)) return Promise.resolve(last.up);
		const running = this.probing.get(base);
		if (running) return running;
		const result = probe(base).then((up) => {
			this.status.set(base, { up, at: Date.now() });
			this.probing.delete(base);
			if (up && this.host.settings.pendingUploads[base]?.length) void this.flush(base);
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
	 * `keptLocally` false (mobile): with no server holding it either, there'd be
	 * no copy to upload later, so nothing is queued and the next scan tries again.
	 */
	async store(localPath: string, buf: ArrayBuffer, keptLocally = true): Promise<number> {
		const name = nameOf(localPath);
		let stored = 0;
		const missed: string[] = [];
		for (const [base, up] of await this.check()) {
			if (up && (await this.has(base, name) || await this.upload(base, name, buf))) stored++;
			else missed.push(base);
		}
		if (!keptLocally && stored === 0) return 0;
		const queued = missed.filter((base) => this.queue(base, localPath));
		if (queued.length) await this.host.saveSettings();
		return stored;
	}

	/** Upload what is waiting for `base`; stop at the first failure and leave the rest for next time. */
	async flush(base: string): Promise<number> {
		if (this.flushing.has(base)) return 0;
		this.flushing.add(base);
		let done = 0;
		try {
			const pending = this.host.settings.pendingUploads;
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
				done++;
			}
			if (pending[base]?.length === 0) delete pending[base];
			if (done) await this.host.saveSettings();
		} finally {
			this.flushing.delete(base);
		}
		return done;
	}

	/** Flush every server that has files waiting and can be reached. */
	async flushAll(): Promise<void> {
		for (const base of Object.keys(this.host.settings.pendingUploads)) {
			if (await this.reachable(base)) await this.flush(base);
		}
	}

	pendingCount(): number {
		return Object.values(this.host.settings.pendingUploads).reduce((n, l) => n + l.length, 0);
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
		const list = (this.host.settings.pendingUploads[base] ??= []);
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
