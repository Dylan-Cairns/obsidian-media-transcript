import { TFile, Vault } from 'obsidian';
import type { MediaTranscriptSettings, SubtitlePriority } from '../settings';
import { pickMedia, subtitleBaseCandidates } from './mediaMatch';

export interface FoundSubtitleFile {
  file: TFile;
  marker: string;    // the [xx] part — empty string means no marker (e.g. "video.srt")
  extension: string; // "srt" | "vtt" | "json"
}

export const SUBTITLE_EXTENSIONS = ['srt', 'vtt', 'json'];

// Escape special regex characters in a string
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find all subtitle files that correspond to the given media file.
 *
 * Naming convention:
 *   [baseName].[ext]          → marker = ""
 *   [baseName].[marker].[ext] → marker = the middle part
 *
 * Search directory: settings.subtitleDirectory if set, otherwise the media file's own folder.
 */
export function findSubtitleFiles(
  mediaFile: TFile,
  vault: Vault,
  settings: MediaTranscriptSettings,
): FoundSubtitleFile[] {
  const searchDir = settings.subtitleDirectory.trim() || (mediaFile.parent?.path ?? '');
  return findSubtitleTracks(mediaFile.basename, searchDir, vault);
}

/**
 * The subtitle tracks named after `baseName` in `dir`. Split out from
 * findSubtitleFiles because a transcript no longer needs its media to be a
 * vault file — or to exist at all — to find its sibling tracks.
 */
export function findSubtitleTracks(
  baseName: string,
  dir: string,
  vault: Vault,
): FoundSubtitleFile[] {
  // Regex matches both:
  //   "video.srt"          → group 1 = undefined
  //   "video.whisper.srt"  → group 1 = "whisper"
  const pattern = new RegExp(
    `^${escapeRegex(baseName)}(?:\\.([^.]+))?\\.(?:${SUBTITLE_EXTENSIONS.join('|')})$`,
  );

  const results: FoundSubtitleFile[] = [];

  for (const file of vault.getFiles()) {
    if ((file.parent?.path ?? '') !== dir) continue;

    const match = file.name.match(pattern);
    if (!match) continue;

    const ext = file.extension.toLowerCase();
    if (!SUBTITLE_EXTENSIONS.includes(ext)) continue;

    results.push({ file, marker: match[1] ?? '', extension: ext });
  }

  return results;
}

/**
 * Sort a media file's subtitle files into the order they should be preferred.
 *
 * The first entry is what opens by default, so this decides which
 * transcription a recording is normally read through.
 *
 * Priority entries name the `[marker]` part of the filename, best first, with
 * the empty marker standing for the plain `video.srt` form. A marker the list
 * does not mention ranks after every one it does: an unlisted track is not
 * rejected, it is simply not what was asked for.
 *
 * Ties break on format — SRT, then VTT, then JSON — because that is the order
 * they carry the least machinery for the same words. Anything still tied keeps
 * the order it was found in, so the result is stable from one open to the next.
 */
const FORMAT_ORDER = ['srt', 'vtt', 'json'];

export function resolvePriority(
  found: FoundSubtitleFile[],
  priorities: SubtitlePriority[],
): FoundSubtitleFile[] {
  const rankOf = new Map(priorities.map((p, i) => [p.marker.trim(), i]));
  const rank = (f: FoundSubtitleFile) => rankOf.get(f.marker.trim()) ?? priorities.length;
  const format = (f: FoundSubtitleFile) => {
    const at = FORMAT_ORDER.indexOf(f.extension.toLowerCase());
    return at < 0 ? FORMAT_ORDER.length : at;
  };

  return found
    .map((file, found_at) => ({ file, found_at }))
    .sort((a, b) =>
      rank(a.file) - rank(b.file) ||
      format(a.file) - format(b.file) ||
      a.found_at - b.found_at)
    .map(entry => entry.file);
}

/**
 * Reverse lookup: given a subtitle file, find the media next to it.
 *
 * Every dotted prefix of the subtitle's name is a candidate media basename
 * (the [marker] is arbitrary), and video wins over audio — see mediaMatch.ts.
 * Only the subtitle's own folder is searched here; the configured media
 * folders are MediaLocator's job. Returns null if nothing matches.
 */
export function findMediaForSubtitle(
  subtitleFile: TFile,
  vault: Vault,
  settings: MediaTranscriptSettings,
): TFile | null {
  const dir = subtitleFile.parent?.path ?? '';
  const siblings = vault.getFiles()
    .filter(f => (f.parent?.path ?? '') === dir)
    .map(f => ({ basename: f.basename, extension: f.extension, ref: f }));
  return pickMedia(
    subtitleBaseCandidates(subtitleFile.name),
    siblings,
    settings.supportedVideoExtensions,
    settings.supportedAudioExtensions,
  );
}

/**
 * Find matching markdown note files for the given media file.
 * Same naming convention: [baseName].[marker].md or [baseName].md
 */
export function findMarkdownFiles(
  mediaFile: TFile,
  vault: Vault,
  settings: MediaTranscriptSettings,
): Array<{ file: TFile; marker: string }> {
  const baseName = mediaFile.basename;
  const mediaDir = mediaFile.parent?.path ?? '';
  const searchDir = settings.subtitleDirectory.trim() || mediaDir;

  const pattern = new RegExp(
    `^${escapeRegex(baseName)}(?:\\.([^.]+))?\\.md$`,
  );

  const results: Array<{ file: TFile; marker: string }> = [];

  for (const file of vault.getFiles()) {
    const dir = file.parent?.path ?? '';
    if (dir !== searchDir) continue;
    if (file.extension !== 'md') continue;

    const match = file.name.match(pattern);
    if (!match) continue;

    results.push({ file, marker: match[1] ?? '' });
  }

  return results;
}
