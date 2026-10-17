import type { App, TFolder } from "obsidian";
import { ensureDir, MARKER_FILENAME } from "./fs-util.ts";

/**
 * Find folders in the vault that look like a *previous* central archive but
 * are NOT the current `centralArchivePath`. Identified by the presence of the
 * `.archive-redirect-managed` marker file we drop into every archive root.
 *
 * Used when the user changes `centralArchivePath` (or had set it differently
 * on another device before sync). The old cache folder is otherwise invisible
 * to the resolver — its files exist but the resolver computes a different path.
 */

function isFolder(x: unknown): x is TFolder {
	return !!x && typeof x === "object" && "children" in x;
}
function isMarkerFile(x: unknown): boolean {
	if (!x || typeof x !== "object") return false;
	if (!("stat" in x) || "children" in x) return false;
	const name = (x as unknown as { name?: unknown }).name;
	return typeof name === "string" && name === MARKER_FILENAME;
}

export interface StaleArchive {
	folderPath: string;
	markerPath: string;
}

export function findStaleCentralArchives(app: App, currentCentralPath: string): StaleArchive[] {
	const results: StaleArchive[] = [];
	const seen = new Set<string>();

	function walk(folder: TFolder) {
		for (const child of folder.children) {
			if (isFolder(child)) {
				walk(child);
				continue;
			}
			if (!isMarkerFile(child)) continue;
			const parentPath = (child as { parent: TFolder | null }).parent?.path ?? "";
			if (!parentPath) continue;
			if (parentPath === currentCentralPath) continue;
			if (seen.has(parentPath)) continue;
			seen.add(parentPath);
			results.push({
				folderPath: parentPath,
				markerPath: (child as { path: string }).path,
			});
		}
	}

	walk(app.vault.getRoot());
	return results;
}

export type ReconcileResult =
	| { ok: true; from: string; to: string }
	| { ok: false; reason: "same-path" | "dest-exists" | "source-missing" | "rename-failed"; detail?: string };

/**
 * Move a stale archive folder to the current central path. Atomic rename when
 * the FS allows it (same volume). Refuses to overwrite an existing destination
 * — if both paths exist, the user must run the "Migrate sibling archives to
 * central" command to merge, since hash collisions need explicit dedup logic.
 */
export async function reconcile(app: App, fromPath: string, toPath: string): Promise<ReconcileResult> {
	if (fromPath === toPath) return { ok: false, reason: "same-path" };

	if (await app.vault.adapter.exists(toPath)) {
		return {
			ok: false,
			reason: "dest-exists",
			detail: `${toPath} already exists. Use the Migrate command to merge.`,
		};
	}

	const folder = app.vault.getAbstractFileByPath(fromPath);
	if (!isFolder(folder)) return { ok: false, reason: "source-missing", detail: fromPath };

	// Ensure destination parent exists ("cache/media" needs "cache/" first).
	const parentOfDest = toPath.substring(0, toPath.lastIndexOf("/"));
	if (parentOfDest) await ensureDir(app.vault.adapter, parentOfDest);

	try {
		await app.vault.rename(folder, toPath);
	} catch (e) {
		return {
			ok: false,
			reason: "rename-failed",
			detail: e instanceof Error ? e.message : String(e),
		};
	}

	return { ok: true, from: fromPath, to: toPath };
}
