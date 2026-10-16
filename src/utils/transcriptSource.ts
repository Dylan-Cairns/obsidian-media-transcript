/**
 * Which media a transcript belongs to, read from the transcript itself.
 *
 * A transcript's filename is easily changed — in Obsidian, in Finder, on a
 * phone — and once its media has left the vault the name was all that tied
 * the two together. Transcription tools already write the media's filename
 * into the JSON (`"source": "talk.m4a"`), and that survives any rename or
 * move, so it is the link we trust first. Pure functions, no Obsidian here.
 */

// The top-level `"source": "…"` member. Tools write it near the top, and only
// the first one is considered, so a nested "source" further down a large file
// is never mistaken for it.
const SOURCE_MEMBER = /"source"\s*:\s*("(?:[^"\\]|\\.)*")/;
const HEAD_BYTES = 4096;

/** The media filename a JSON transcript names as its source, or null. */
export function readSource(text: string): string | null {
  const head = text.slice(0, HEAD_BYTES);
  const m = head.match(SOURCE_MEMBER);
  if (!m || !isTopLevel(head, m.index ?? 0)) return null;
  let value: unknown;
  try {
    value = JSON.parse(m[1]);
  } catch {
    return null;
  }
  if (typeof value !== 'string') return null;
  // Some tools record the path they were given; only the name travels.
  const name = value.split(/[\\/]/).pop()?.trim() ?? '';
  return name.includes('.') ? name : null;
}

/**
 * `text` with its source set to `name`, everything else byte for byte as it
 * was (so the file's formatting and the tool's other fields are untouched).
 * Adds the member when there is none. Null if `text` isn't a JSON object.
 */
export function writeSource(text: string, name: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const value = JSON.stringify(name);
  const head = text.slice(0, HEAD_BYTES);
  const m = head.match(SOURCE_MEMBER);
  let out: string;
  if (m && isTopLevel(head, m.index ?? 0)) {
    const start = (m.index ?? 0) + m[0].length - m[1].length;
    out = text.slice(0, start) + value + text.slice(start + m[1].length);
  } else {
    const brace = text.indexOf('{');
    const indent = text.slice(brace + 1).match(/^\r?\n([ \t]+)/)?.[1];
    const empty = Object.keys(parsed).length === 0;
    const member = indent !== undefined
      ? `\n${indent}"source": ${value}${empty ? '\n' : ','}`
      : `"source": ${value}${empty ? '' : ', '}`;
    out = text.slice(0, brace + 1) + member + text.slice(brace + 1);
  }
  // Never write something that no longer reads back as intended.
  try {
    JSON.parse(out);
  } catch {
    return null;
  }
  return readSource(out) === name.split(/[\\/]/).pop() ? out : null;
}

// Depth 1 inside the outermost object, ignoring braces inside strings.
function isTopLevel(text: string, at: number): boolean {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < at; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
  }
  return depth === 1 && !inString;
}

/** The `[marker]` of a subtitle filename: "talk.whisper.json" → "whisper", "talk.srt" → "". */
export function trackMarker(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 2 ? parts[parts.length - 2] : '';
}

/**
 * How a server index keys a filename: case-insensitive, and in one Unicode
 * form, since a name typed on one machine and stored on another may differ
 * only in how accented characters are composed.
 */
export function nameKey(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/**
 * A media server's index.json: where each file is, under every name it has
 * gone by. Written by the offload script; lets the server keep files in
 * dated folders (and survive renames there) while transcripts and notes
 * still ask for them by name.
 *
 *   { "version": 1, "files": [
 *       { "path": "2026/10/talk.m4a", "sha256": "…", "size": 123, "names": ["talk.m4a", "old name.m4a"] } ] }
 */
export interface RemoteIndex {
  byName: Map<string, string>; // lower-cased filename → path under the base
  names: string[];             // every current filename, for picking one by hand
}

export function parseRemoteIndex(text: string): RemoteIndex | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const files = (data as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) return null;

  const byName = new Map<string, string>();
  const names: string[] = [];
  // Current names first, so an alias never shadows a file that has that name now.
  const entries = files
    .map(f => f as { path?: unknown; names?: unknown })
    .filter((f): f is { path: string; names?: unknown } => typeof f.path === 'string' && f.path !== '');
  for (const f of entries) {
    const name = f.path.split('/').pop() ?? f.path;
    names.push(name);
    if (!byName.has(nameKey(name))) byName.set(nameKey(name), f.path);
  }
  for (const f of entries) {
    if (!Array.isArray(f.names)) continue;
    for (const alias of f.names) {
      if (typeof alias === 'string' && !byName.has(nameKey(alias))) byName.set(nameKey(alias), f.path);
    }
  }
  return { byName, names };
}

/** The URL of `path` (slash-separated, under `base`), each segment percent-encoded. */
export function remotePathUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + '/' + path.split('/').map(encodeURIComponent).join('/');
}
