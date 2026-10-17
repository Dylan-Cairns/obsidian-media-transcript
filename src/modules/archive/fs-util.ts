import type { ArchiveSettings } from "./settings";
import type { Store } from "./store";

// Type-only imports above keep this module loadable in plain Node (test env).

// vault.adapter.mkdir is a single-level mkdir, not `mkdir -p`. Central mode produces
// paths like `_archive/ab/<hash>.jpg`; the bucket dir's parent may not exist yet on
// a fresh vault. Walk up and create each level.
export async function ensureDir(store: Store, dir: string): Promise<void> {
	if (!dir || (await store.exists(dir))) return;
	const parent = dir.substring(0, dir.lastIndexOf("/"));
	if (parent) await ensureDir(store, parent);
	await store.mkdir(dir);
}

export const MARKER_FILENAME = ".archive-redirect-managed";

export const MARKER_CONTENT = `Archive Redirect — managed archive folder
==========================================

This folder is created and maintained by the Archive Redirect Obsidian plugin.

Files here are NAMED by SHA1 of remote URLs (<hash>.<ext>) and referenced from
notes via HTML <img>/<video>/<audio> at render time. They do NOT appear in any
markdown ![]() or [[wikilink]] in your notes.

⚠️  WARNING — DO NOT clean this folder with third-party "orphan attachment"
   plugins. They scan only markdown link syntax and will flag every file here
   as orphaned. Running them will silently destroy your link-rot archive,
   INCLUDING content whose source URLs are already dead and unrecoverable.

   Known dangerous combinations:
     - oz-clear-unused-images
     - Local Images Plus' "Remove orphaned attachments" commands
     - Any tool that "garbage-collects unused attachments"

   Either DO NOT run such tools while Archive Redirect is in use, OR
   exclude this folder from their scope.

Plugin home: https://github.com/semsevens/obsidian-archive-redirect
`;

export function archiveRoot(settings: ArchiveSettings, destPath: string): string {
	if (settings.archiveMode === "central") return settings.centralArchivePath;
	return destPath.substring(0, destPath.lastIndexOf("/"));
}

export async function ensureMarker(store: Store, root: string): Promise<void> {
	if (!root) return;
	const markerPath = `${root}/${MARKER_FILENAME}`;
	if (await store.exists(markerPath)) return;
	await ensureDir(store, root);
	await store.write(markerPath, MARKER_CONTENT);
}
