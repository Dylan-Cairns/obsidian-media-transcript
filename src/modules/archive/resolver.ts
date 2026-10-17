import { sha1Hex } from "./sha1.ts";
import type { ArchiveSettings, ArchiveSource } from "./settings";

/**
 * Map (remote URL, owning markdown path, settings) → vault-relative archive path.
 *
 * Pure function — same inputs always yield the same output. The two modes:
 *
 *  - "sibling": archive lives next to the markdown that referenced it.
 *      <mdDir>/<archiveDirName>/<sha1>.<ext>
 *      Pros: notes are self-contained, easy to move/share.
 *      Cons: same URL across notes is stored once per folder (no global dedup).
 *
 *  - "central": one shared folder at the vault root, bucketed by hash prefix.
 *      <centralArchivePath>/<bucket>/<sha1>.<ext>
 *      Pros: true global dedup; cache survives moving the markdown.
 *      Cons: deleting a note leaves orphan cache (needs GC).
 *
 * mdPath is kept in the signature even for "central" so a future "mixed mode"
 * (per-folder policy) can be added without changing every call site.
 */
export function resolve(url: string, mdPath: string, settings: ArchiveSettings): string {
	if (settings.archiveMode === "central") {
		return `${settings.centralArchivePath}/${archiveName(url)}`;
	}

	const dir = mdPath.substring(0, mdPath.lastIndexOf("/"));
	return `${dir}/${settings.archiveDirName}/${archiveName(url).substring(3)}`;
}

/**
 * The archived copies of `url` to try, in source order: the local one when it
 * exists (`localSrc`), and each server that is up. Missing ones are left out.
 */
export function sourceCandidates(
	url: string,
	sources: ArchiveSource[],
	localSrc: string | null,
	isUp: (server: string) => boolean,
): string[] {
	return sources.flatMap((s) => {
		if (s.kind === "local") return localSrc ? [localSrc] : [];
		return s.url && isUp(s.url) ? [`${s.url}/${archiveName(url)}`] : [];
	});
}

/** <bucket>/<sha1>.<ext>, the bucket being the first two hex chars of the hash: where servers keep `url`. */
export function archiveName(url: string): string {
	const hash = sha1Hex(url);
	return `${hash.substring(0, 2)}/${hash}.${guessExt(url)}`;
}

/** <bucket>/<sha1>.<ext> of a local archive path: its file name, under the hash's first two characters. */
export function nameOf(localPath: string): string {
	const file = localPath.substring(localPath.lastIndexOf("/") + 1);
	return `${file.substring(0, 2)}/${file}`;
}

function guessExt(url: string): string {
	try {
		const u = new URL(url);
		const pathMatch = u.pathname.match(/\.([a-zA-Z0-9]+)$/);
		if (pathMatch) return pathMatch[1].toLowerCase();
		const fmt = u.searchParams.get("wx_fmt");
		if (fmt) return fmt.toLowerCase();
	} catch {
		// fallthrough
	}
	return "bin";
}
