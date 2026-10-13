/**
 * Pure rules for pairing a subtitle with its media, wherever the media lives
 * (next to the subtitle, in another vault folder, or outside the vault).
 * No Obsidian or filesystem access here, so it can be unit-tested.
 */

/** Something that might be the media: a vault file, an absolute path, … */
export interface MediaEntry<T> {
  basename: string;  // filename without extension
  extension: string; // lowercase, no dot
  ref: T;
}

function withoutExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Media basenames a subtitle could belong to, longest first.
 *
 * Subtitles are named `[base].[ext]` or `[base].[marker].[ext]`, and the
 * marker is arbitrary, so every dotted prefix is a candidate:
 *   "lecture.whisper.json" → ["lecture.whisper", "lecture"]
 */
export function subtitleBaseCandidates(subtitleName: string): string[] {
  const parts = withoutExtension(subtitleName).split('.');
  const out: string[] = [];
  for (let k = parts.length; k >= 1; k--) out.push(parts.slice(0, k).join('.'));
  return out;
}

/**
 * The base a subtitle's sibling tracks share when there's no media to ask.
 * A marker never contains a dot, so peel exactly one segment when there is
 * one: "Recording 1.vibevoice-4bit.json" → "Recording 1", "talk.srt" → "talk".
 */
export function subtitleBaseName(subtitleName: string): string {
  const parts = withoutExtension(subtitleName).split('.');
  return parts.length > 1 ? parts.slice(0, -1).join('.') : parts[0];
}

/**
 * Choose the media for a subtitle among `entries`: any entry whose basename is
 * a candidate, video before audio, then in the configured extension order —
 * so an .mp4 wins over an .m4a of the same name. Earlier entries win ties.
 */
export function pickMedia<T>(
  candidates: string[],
  entries: Iterable<MediaEntry<T>>,
  videoExts: string[],
  audioExts: string[],
): T | null {
  const names = new Set(candidates);
  const video = videoExts.map(e => e.toLowerCase());
  const audio = audioExts.map(e => e.toLowerCase());
  const rank = (ext: string): number => {
    const vi = video.indexOf(ext);
    if (vi >= 0) return vi;
    const ai = audio.indexOf(ext);
    return ai >= 0 ? video.length + ai : -1;
  };

  let best: T | null = null;
  let bestRank = Number.MAX_SAFE_INTEGER;
  for (const e of entries) {
    if (!names.has(e.basename)) continue;
    const r = rank(e.extension.toLowerCase());
    if (r >= 0 && r < bestRank) {
      best = e.ref;
      bestRank = r;
    }
  }
  return best;
}

/** An absolute (outside-the-vault) folder, as opposed to a vault-relative one. */
export function isAbsoluteFolder(folder: string): boolean {
  return folder.startsWith('/') || folder.startsWith('~') || /^[A-Za-z]:[\\/]/.test(folder);
}

/** The settings textarea: one folder per line, blanks and duplicates dropped. */
export function parseFolderList(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const f = line.trim().replace(/[\\/]+$/, '');
    if (f && !out.includes(f)) out.push(f);
  }
  return out;
}

/**
 * The name iCloud gives an evicted file's placeholder on older macOS:
 * ".talk.m4a.icloud" stands for "talk.m4a". Returns null for anything else.
 */
export function icloudPlaceholderName(name: string): string | null {
  const m = name.match(/^\.(.+)\.icloud$/);
  return m ? m[1] : null;
}
