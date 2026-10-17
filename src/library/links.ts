/**
 * Rewriting a note's links to a media file that was renamed on the server.
 *
 * Obsidian updates links itself only for files it can see; a recording that
 * lives on the server is not one, so its embeds are rewritten here. Pure
 * functions, no Obsidian here.
 */

export interface Target {
  name: string;   // file name with extension
  path: string;   // vault path
}

/**
 * `original` (a link as written: `![[a.m4a#t=5|x]]`, `[x](a%20b.m4a)`) with
 * its target changed from `from` to `to`, or null if it doesn't point at
 * `from`. A link written as a bare name stays a bare name; one written as a
 * path gets the new path.
 */
export function retargetLink(original: string, link: string, from: Target, to: Target): string | null {
  const linkPath = decodeSafe(link.split('#')[0].split('|')[0]).trim();
  const lower = linkPath.toLowerCase();
  let replacement: string;
  if (lower === from.name.toLowerCase()) replacement = to.name;
  else if (lower === from.path.toLowerCase() || lower === '/' + from.path.toLowerCase()) replacement = to.path;
  else if (lower.endsWith('/' + from.name.toLowerCase()) && from.path.toLowerCase().endsWith(lower)) replacement = to.path;
  else return null;

  // The target as it appears in the text: plain in a wikilink, maybe escaped in a markdown link.
  const written = [linkPath, linkPath.replace(/ /g, '%20'), encodeURI(linkPath)];
  for (const w of written) {
    const at = original.indexOf(w);
    if (at < 0) continue;
    const escaped = w === linkPath ? replacement : w.includes('%') && w === encodeURI(linkPath) ? encodeURI(replacement) : replacement.replace(/ /g, '%20');
    return original.slice(0, at) + escaped + original.slice(at + w.length);
  }
  return null;
}

export interface LinkAt {
  original: string;
  link: string;
  start: number;   // offset of `original` in the note
  end: number;
}

/**
 * The note's text with each of `links` that points at `from` retargeted to
 * `to`. A link whose text no longer stands where the cache said is skipped
 * (the note changed since), so nothing is overwritten by guesswork.
 */
export function rewriteNote(text: string, links: LinkAt[], from: Target, to: Target): { text: string; changed: number } {
  let out = text;
  let changed = 0;
  for (const l of [...links].sort((a, b) => b.start - a.start)) {
    if (out.slice(l.start, l.end) !== l.original) continue;
    const next = retargetLink(l.original, l.link, from, to);
    if (next === null || next === l.original) continue;
    out = out.slice(0, l.start) + next + out.slice(l.end);
    changed++;
  }
  return { text: out, changed };
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
