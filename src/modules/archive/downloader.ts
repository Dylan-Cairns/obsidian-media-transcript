import { Vault, requestUrl } from "obsidian";
import { matchPolicy } from "./policies";
import type { ArchiveSettings } from "./settings";
import { archiveRoot, ensureDir, ensureMarker } from "./fs-util";
import { storeFor, type Store } from "./store";
import type { ArchiveServers } from "./servers";

export { ensureDir, ensureMarker } from "./fs-util";

export type DownloadResult =
	| "downloaded"
	| "skipped-exists"
	| "skipped-policy"
	| "failed-permanent"
	| "failed-transient";

const RETRY_BACKOFFS_MS = [0, 1000, 3000]; // 3 次尝试: 立刻 / +1s / +3s
const REQUEST_TIMEOUT_MS = 15_000;
const PERMANENT_STATUSES = new Set([400, 401, 403, 404, 410, 451]);

export async function download(
	url: string,
	destPath: string,
	vault: Vault,
	settings: ArchiveSettings,
	servers: ArchiveServers,
): Promise<DownloadResult> {
	// null on mobile with the archive folder outside the vault: there, servers are the only archive.
	const dest = storeFor(vault, destPath);
	if (dest && (await dest.store.exists(dest.path))) return "skipped-exists";

	const policy = matchPolicy(url);
	if (!policy.archive) return "skipped-policy";

	if (!dest) {
		if (await servers.storedAnywhere(url)) return "skipped-exists";
	} else {
		// Another device may have archived it already; its copy is quicker and surer than the original.
		const archived = await servers.fetch(url);
		if (archived) {
			await writeFile(dest, vault, settings, destPath, archived);
			await servers.store(destPath, archived);
			return "downloaded";
		}
	}

	// HTTP → HTTPS 自动升级（Obsidian requestUrl 不接受明文 HTTP）
	const fetchUrl = url.replace(/^http:\/\//, "https://");

	const headers: Record<string, string> = policy.referer ? { Referer: policy.referer } : {};

	let lastErr = "";
	let permanent = false;

	for (let i = 0; i < RETRY_BACKOFFS_MS.length; i++) {
		if (RETRY_BACKOFFS_MS[i] > 0) await sleep(RETRY_BACKOFFS_MS[i]);

		try {
			const response = await Promise.race([
				requestUrl({ url: fetchUrl, headers, throw: false }),
				rejectAfter<Awaited<ReturnType<typeof requestUrl>>>(REQUEST_TIMEOUT_MS),
			]);

			if (response.status === 200) {
				if (dest) await writeFile(dest, vault, settings, destPath, response.arrayBuffer);
				const uploaded = await servers.store(destPath, response.arrayBuffer, !!dest);
				// Kept nowhere (no local archive, no server up): leave it for the next scan.
				if (!dest && uploaded === 0) return "failed-transient";
				return "downloaded";
			}

			if (PERMANENT_STATUSES.has(response.status)) {
				lastErr = `HTTP ${response.status} (permanent)`;
				permanent = true;
				break;
			}

			lastErr = `HTTP ${response.status}`;
		} catch (e: unknown) {
			lastErr = e instanceof Error ? e.message : String(e);
		}
	}

	await logFailure(vault, settings, destPath, url, fetchUrl, lastErr);
	return permanent ? "failed-permanent" : "failed-transient";
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function rejectAfter<T>(ms: number): Promise<T> {
	return new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms));
}

async function writeFile(
	{ store, path }: { store: Store; path: string },
	vault: Vault,
	settings: ArchiveSettings,
	destPath: string,
	buf: ArrayBuffer,
): Promise<void> {
	await ensureDir(store, path.substring(0, path.lastIndexOf("/")));
	const root = storeFor(vault, archiveRoot(settings, destPath));
	if (root) await ensureMarker(store, root.path);
	await store.writeBinary(path, buf);
}

async function logFailure(
	vault: Vault,
	settings: ArchiveSettings,
	destPath: string,
	originalUrl: string,
	fetchUrl: string,
	error: string,
): Promise<void> {
	// Central mode: one shared log at <centralPath>/.failed.jsonl (not per-bucket,
	// which would scatter the log across 256 dirs).
	// Sibling mode: log lives next to the would-be archive file, same as before.
	const logDir =
		settings.archiveMode === "central"
			? settings.centralArchivePath
			: destPath.substring(0, destPath.lastIndexOf("/"));
	const log = storeFor(vault, logDir);
	if (!log) {
		console.warn(`[archive-redirect] ${originalUrl}: ${error}`);
		return;
	}
	const { store, path: dir } = log;
	await ensureDir(store, dir);
	const logPath = `${dir}/.failed.jsonl`;
	const entry =
		JSON.stringify({
			url: originalUrl,
			fetchUrl: fetchUrl !== originalUrl ? fetchUrl : undefined,
			destPath,
			error,
			ts: new Date().toISOString(),
		}) + "\n";
	await store.append(logPath, entry);
}
