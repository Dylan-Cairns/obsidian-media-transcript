/**
 * Media-fragment timestamps in link subpaths: `[[talk.m4a#t=83]]`.
 *
 * `#t=` is the W3C media-fragment syntax Obsidian's own media embeds already
 * honour, so a link we copy keeps working without this plugin. We write plain
 * seconds (the most widely understood form) and read the forms people type by
 * hand: `83`, `83.5`, `1:23`, `1:02:03`, and a `start,end` range (start wins).
 */
export function parseTimeFragment(subpath: string | undefined | null): number | null {
  if (!subpath) return null;
  const m = subpath.replace(/^#/, '').match(/(?:^|&)t=(?:npt:)?([0-9:.]+)/);
  if (!m) return null;

  const parts = m[1].split(':');
  if (parts.length > 3 || parts.some(p => p === '' || isNaN(Number(p)))) return null;
  const seconds = parts.reduce((acc, p) => acc * 60 + Number(p), 0);
  return Number.isFinite(seconds) ? seconds : null;
}

/** The subpath for a link that starts playback at `seconds` (whole seconds). */
export function timeFragment(seconds: number): string {
  return `#t=${Math.max(0, Math.floor(seconds))}`;
}
