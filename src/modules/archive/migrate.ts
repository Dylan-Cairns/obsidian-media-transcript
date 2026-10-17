import type { App, TFile, TFolder } from "obsidian";
import { ensureDir, ensureMarker } from "./fs-util.ts";
import type { ArchiveSettings } from "./settings";

// Duck-typing guards — the npm `obsidian` package ships TS types only, so we
// cannot use `instanceof TFile` in test environments (no runtime class).
// Real TFile always has a `stat` field and no `children`; real TFolder is the
// reverse. Production and tests both pass this check correctly.
function isFile(x: unknown): x is TFile {
	return !!x && typeof x === "object" && "stat" in x && !("children" in x);
}
function isFolder(x: unknown): x is TFolder {
	return !!x && typeof x === "object" && "children" in x;
}

// Minimal vault-path normalization: strip leading "./", collapse "//", trim trailing "/".
// Obsidian's `normalizePath` does this plus a few escape conversions we do not need here.
function normalizeVaultPath(p: string): string {
	return p.replace(/^\.\//, "").replace(/\/{2,}/g, "/").replace(/\/+$/, "");
}

/**
 * Migrate from "sibling" layout (per-note `_archive/`) to "central" layout
 * (`<centralPath>/<bucket>/<hash>.<ext>`).
 *
 * Two-phase: scan() builds a plan you can show to the user; execute() runs it.
 * Same-content dedup is automatic because filenames are SHA1 of the URL —
 * collisions can only happen when two sibling folders archived the same URL,
 * in which case either file is identical.
 */

export interface MigrationEntry {
	from: string;
	to: string;
	sha1: string;
	bytes: number;
}

export interface MigrationPlan {
	moves: MigrationEntry[];
	duplicates: { from: string; existingAt: string }[];
	failedLogs: string[];
	totalBytes: number;
	skippedNonHashed: string[];
}

const SHA1_FILENAME = /^([a-f0-9]{40})\.([a-z0-9]+)$/i;

export async function scan(app: App, settings: ArchiveSettings): Promise<MigrationPlan> {
	const plan: MigrationPlan = {
		moves: [],
		duplicates: [],
		failedLogs: [],
		totalBytes: 0,
		skippedNonHashed: [],
	};

	const central = normalizeVaultPath(settings.centralArchivePath);
	const archiveDirName = settings.archiveDirName;
	const seenSha1 = new Map<string, string>(); // sha1 → planned dest

	for (const folder of walkFolders(app.vault.getRoot())) {
		if (folder.name !== archiveDirName) continue;
		// Skip the central path itself and anything inside it (re-running migration is a no-op).
		if (folder.path === central || folder.path.startsWith(central + "/")) continue;

		for (const child of folder.children) {
			if (!isFile(child)) continue;

			if (child.name === ".failed.jsonl") {
				plan.failedLogs.push(child.path);
				continue;
			}

			const match = child.name.match(SHA1_FILENAME);
			if (!match) {
				plan.skippedNonHashed.push(child.path);
				continue;
			}
			const [, sha1, ext] = match;
			const bucket = sha1.substring(0, 2);
			const dest = `${central}/${bucket}/${sha1}.${ext.toLowerCase()}`;

			const alreadyPlanned = seenSha1.get(sha1);
			if (alreadyPlanned) {
				plan.duplicates.push({ from: child.path, existingAt: alreadyPlanned });
				continue;
			}
			if (await app.vault.adapter.exists(dest)) {
				plan.duplicates.push({ from: child.path, existingAt: dest });
				continue;
			}

			plan.moves.push({ from: child.path, to: dest, sha1, bytes: child.stat.size });
			seenSha1.set(sha1, dest);
			plan.totalBytes += child.stat.size;
		}
	}

	return plan;
}

export interface ProgressEvent {
	done: number; // moves attempted so far (success + skip + error)
	total: number;
	bytesProcessed: number;
}

export interface ExecuteOptions {
	deleteSource: boolean; // true = move (rename), false = copy + leave originals
	deleteEmptyDirs: boolean; // only honored when deleteSource = true
	onProgress?: (event: ProgressEvent) => void;
	signal?: AbortSignal; // user-triggered cancel
}

export interface ExecuteResult {
	moved: number;
	skipped: number;
	errors: { path: string; error: string }[];
	emptyDirsRemoved: number;
	failedLogMerged: number;
	cancelled: boolean;
}

export async function execute(
	app: App,
	plan: MigrationPlan,
	settings: ArchiveSettings,
	options: ExecuteOptions,
): Promise<ExecuteResult> {
	const result: ExecuteResult = {
		moved: 0,
		skipped: 0,
		errors: [],
		emptyDirsRemoved: 0,
		failedLogMerged: 0,
		cancelled: false,
	};

	const touchedFolders = new Set<string>();
	let bytesProcessed = 0;
	const total = plan.moves.length;

	// Write the marker first — even if the migration has zero files to move (because
	// the central path is empty), the marker tells future cleanup tools to stay away.
	await ensureMarker(app.vault.adapter, settings.centralArchivePath);

	for (let i = 0; i < plan.moves.length; i++) {
		if (options.signal?.aborted) {
			result.cancelled = true;
			break;
		}
		const entry = plan.moves[i];
		try {
			const file = app.vault.getAbstractFileByPath(entry.from);
			if (!isFile(file)) {
				result.skipped++;
			} else {
				// Capture the original parent path BEFORE rename — rename mutates
				// file.parent in place, so reading it after the move points to the
				// new (central) bucket dir, not the sibling _archive we want to clean.
				const originalParentPath = file.parent?.path ?? "";

				await ensureDir(app.vault.adapter, entry.to.substring(0, entry.to.lastIndexOf("/")));

				if (options.deleteSource) {
					// Use vault.rename, NOT fileManager.renameFile. The latter walks
					// every markdown file in the vault looking for backlinks to
					// update — O(notes × moves), can take minutes for large vaults.
					// Archive files are never linked from markdown (they're served
					// via HTML <img> at render time, by URL hash), so the link-aware
					// rename is pure overhead.
					await app.vault.rename(file, entry.to);
				} else {
					const buf = await app.vault.readBinary(file);
					await app.vault.adapter.writeBinary(entry.to, buf);
				}

				touchedFolders.add(originalParentPath);
				result.moved++;
				bytesProcessed += entry.bytes;
			}
		} catch (e: unknown) {
			result.errors.push({
				path: entry.from,
				error: e instanceof Error ? e.message : String(e),
			});
		}
		options.onProgress?.({
			done: i + 1,
			total,
			bytesProcessed,
		});
	}

	result.failedLogMerged = await mergeFailedLogs(app, plan.failedLogs, settings, options);

	if (options.deleteSource && options.deleteEmptyDirs) {
		for (const folderPath of touchedFolders) {
			if (!folderPath) continue;
			const folder = app.vault.getAbstractFileByPath(folderPath);
			if (isFolder(folder) && folder.children.length === 0) {
				try {
					await app.vault.trash(folder, true);
					result.emptyDirsRemoved++;
				} catch (e) {
					console.warn(`[archive-redirect:migrate] could not remove empty dir ${folderPath}: ${e}`);
				}
			}
		}
	}

	return result;
}

/**
 * Merge scattered sibling `.failed.jsonl` files into a single central log.
 *
 * Each line is one JSON object: { url, fetchUrl?, destPath, error, ts }.
 * Strategy: concatenate, dedup by `url`, keep the most recent ts.
 * This preserves history without bloating the central log when the same URL
 * failed many times across notes.
 */
async function mergeFailedLogs(
	app: App,
	logPaths: string[],
	settings: ArchiveSettings,
	options: ExecuteOptions,
): Promise<number> {
	if (logPaths.length === 0) return 0;

	const centralLogDir = settings.centralArchivePath;
	const centralLogPath = `${centralLogDir}/.failed.jsonl`;
	await ensureDir(app.vault.adapter, centralLogDir);

	const byUrl = new Map<string, { line: string; ts: string }>();

	if (await app.vault.adapter.exists(centralLogPath)) {
		const existing = await app.vault.adapter.read(centralLogPath);
		ingestLines(existing, byUrl);
	}

	let mergedCount = 0;
	for (const path of logPaths) {
		try {
			const content = await app.vault.adapter.read(path);
			ingestLines(content, byUrl);
			mergedCount++;
			if (options.deleteSource) {
				const f = app.vault.getAbstractFileByPath(path);
				if (isFile(f)) await app.vault.trash(f, true);
			}
		} catch (e) {
			console.warn(`[archive-redirect:migrate] failed log read ${path}: ${e}`);
		}
	}

	const out = Array.from(byUrl.values())
		.sort((a, b) => a.ts.localeCompare(b.ts))
		.map((v) => v.line)
		.join("\n");
	await app.vault.adapter.write(centralLogPath, out + (out.endsWith("\n") ? "" : "\n"));

	return mergedCount;
}

function ingestLines(text: string, into: Map<string, { line: string; ts: string }>) {
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (!line) continue;
		try {
			const obj = JSON.parse(line) as { url?: string; ts?: string };
			if (!obj.url) continue;
			const ts = obj.ts ?? "";
			const prev = into.get(obj.url);
			if (!prev || ts > prev.ts) into.set(obj.url, { line, ts });
		} catch {
			// skip malformed lines
		}
	}
}

function walkFolders(root: TFolder): TFolder[] {
	const result: TFolder[] = [];
	const stack: TFolder[] = [root];
	while (stack.length > 0) {
		const folder = stack.pop()!;
		result.push(folder);
		for (const child of folder.children) {
			if (isFolder(child)) stack.push(child);
		}
	}
	return result;
}

export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
	return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
