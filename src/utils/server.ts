/**
 * One Media One server address, spread over the lists the modules already
 * have: transcripts read media from `<server>/library`, and the web image
 * archive shares its files through `<server>/archive`.
 *
 * Pure functions, no Obsidian here: the plugin applies the result.
 */

export type Source = { kind: 'local' } | { kind: 'server'; url: string };

export interface ServerLists {
  mediaUrls: string[];
  sources: Source[] | null;   // null: the archive module has no settings yet
  pendingUploads: Record<string, string[]> | null;
}

export function normalizeServer(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export const libraryUrl = (server: string) => `${server}/library`;
export const archiveUrl = (server: string) => `${server}/archive`;

/**
 * The lists with `previous` server's entries replaced by `next`'s (either may
 * be ''). The archive's address under the old WebDAV path (`/dav/archive`)
 * counts as the server's too, so it isn't kept as a second copy of itself.
 * Files waiting to be uploaded to a dropped address wait for the new one.
 */
export function applyServer(lists: ServerLists, previous: string, next: string): ServerLists {
  const servers = [previous, next].filter(s => s !== '');
  const ownLibrary = new Set(servers.map(libraryUrl));
  const ownArchive = new Set(servers.flatMap(s => [archiveUrl(s), `${s}/dav/archive`]));

  const mediaUrls = lists.mediaUrls.filter(u => !ownLibrary.has(normalizeServer(u)));
  if (next) mediaUrls.unshift(libraryUrl(next));

  if (!lists.sources) return { mediaUrls, sources: null, pendingUploads: lists.pendingUploads };

  const sources = lists.sources.filter(s => s.kind !== 'server' || !ownArchive.has(normalizeServer(s.url)));
  if (next) sources.unshift({ kind: 'server', url: archiveUrl(next) });

  const pendingUploads: Record<string, string[]> = {};
  for (const [url, paths] of Object.entries(lists.pendingUploads ?? {})) {
    const target = ownArchive.has(normalizeServer(url)) ? (next ? archiveUrl(next) : null) : url;
    if (!target) continue;
    pendingUploads[target] = [...new Set([...(pendingUploads[target] ?? []), ...paths])];
  }
  return { mediaUrls, sources, pendingUploads };
}
