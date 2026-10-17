// Pure data + helpers. Kept free of `obsidian` runtime imports so tests can
// load this module without spinning up Obsidian's class registry.
// UI lives in `settings-ui.ts`.

export type ArchiveMode = "sibling" | "central";

/**
 * One place archived copies are read from (and written to). "local" is the
 * archive folder configured above; a server is a WebDAV folder laid out like
 * the central archive (<url>/<bucket>/<sha1>.<ext>).
 */
export type ArchiveSource = { kind: "local" } | { kind: "server"; url: string };

export interface ArchiveSettings {
	archiveMode: ArchiveMode;
	archiveDirName: string;
	centralArchivePath: string;
	autoArchiveOnModify: boolean;
	includedPaths: string[];
	/** Where to read copies from, first choice first; the remote URL comes after all of them. */
	sources: ArchiveSource[];
	/** Per server URL: archived files (<bucket>/<sha1>.<ext>) not uploaded there yet. */
	pendingUploads: Record<string, string[]>;
}

export const DEFAULT_SETTINGS: ArchiveSettings = {
	archiveMode: "sibling",
	archiveDirName: "_archive",
	centralArchivePath: "_archive",
	autoArchiveOnModify: true,
	includedPaths: [],
	sources: [{ kind: "local" }],
	pendingUploads: {},
};

export function normalizeServerUrl(url: string): string {
	return url.trim().replace(/\/+$/, "");
}

export function serverUrls(sources: ArchiveSource[]): string[] {
	return sources.flatMap((s) => (s.kind === "server" && s.url ? [s.url] : []));
}

/**
 * Settings saved by 0.6.0 had one `serverUrl` and a `sourceOrder`; turn them
 * into the source list. Later settings pass through unchanged.
 */
export function migrateSources(raw: { sources?: unknown; serverUrl?: unknown; sourceOrder?: unknown }): ArchiveSource[] {
	if (Array.isArray(raw.sources)) return raw.sources as ArchiveSource[];
	const url = typeof raw.serverUrl === "string" ? normalizeServerUrl(raw.serverUrl) : "";
	if (!url) return [{ kind: "local" }];
	const server: ArchiveSource = { kind: "server", url };
	return raw.sourceOrder === "local-first" ? [{ kind: "local" }, server] : [server, { kind: "local" }];
}

/** An archive path given as absolute (or ~/) lives outside the vault. */
export function isExternalPath(path: string): boolean {
	return path.startsWith("/") || path.startsWith("~/");
}

export function expandHome(path: string, home: string): string {
	return path.startsWith("~/") ? home + path.substring(1) : path;
}

export function isInScope(mdPath: string, includedPaths: string[]): boolean {
	if (includedPaths.length === 0) return true;
	return includedPaths.some((p) => mdPath === p || mdPath.startsWith(p + "/"));
}
