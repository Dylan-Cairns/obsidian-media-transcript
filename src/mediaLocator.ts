import { App, Platform, TFile, normalizePath, requestUrl } from 'obsidian';
import type { MediaTranscriptSettings } from './settings';
import { findMediaForSubtitle } from './utils/subtitleFinder';
import {
  MediaEntry,
  icloudPlaceholderName,
  isAbsoluteFolder,
  pickMedia,
  remoteCandidates,
  remoteFileUrl,
  subtitleBaseCandidates,
} from './utils/mediaMatch';

/** Media ready to hand to an <audio>/<video> element, wherever it lives. */
export interface ResolvedMedia {
  src: string;          // URL the player loads
  basename: string;
  extension: string;    // lowercase
  file: TFile | null;   // set when the media is a vault file
  location: string;     // vault path or absolute path — for display and data attributes
}

export interface MediaLookup {
  media: ResolvedMedia | null;
  // Where we looked, in order, for the "no media" hint — so an unplugged
  // drive or a typo in settings is visible instead of a silent miss.
  searched: string[];
}

export function vaultMedia(app: App, file: TFile): ResolvedMedia {
  return {
    src: app.vault.getResourcePath(file),
    basename: file.basename,
    extension: file.extension.toLowerCase(),
    file,
    location: file.path,
  };
}

// An external folder is listed once and remembered; a miss rescans it, but not
// more often than this, so a transcript that genuinely has no media doesn't
// walk a 2 TB drive on every open.
const RESCAN_AFTER_MS = 30_000;
// Guards against pointing the setting at `/` or a home folder by accident.
const MAX_DEPTH = 12;
const MAX_ENTRIES = 200_000;
// A remote server that hasn't answered by now is treated as unreachable, so a
// sleeping machine costs a short wait rather than a hung transcript.
const REMOTE_TIMEOUT_MS = 5000;
// …and remembered as such for a while, so opening several transcripts while
// it's down doesn't cost the wait each time.
const REMOTE_RETRY_AFTER_MS = 60_000;

// The little of Node this file uses, typed locally: the project keeps Node
// types out of tsconfig so nothing else picks up a dependency mobile lacks.
interface NodeDirent { name: string; isDirectory(): boolean; isFile(): boolean }
interface NodeModules {
  fs: { promises: { readdir(dir: string, opts: { withFileTypes: true }): Promise<NodeDirent[]> } };
  path: { join(...parts: string[]): string };
  os: { homedir(): string };
}
function nodeModules(): NodeModules {
  const req = (window as unknown as { require: (id: string) => unknown }).require;
  return {
    fs: req('fs') as NodeModules['fs'],
    path: req('path') as NodeModules['path'],
    os: req('os') as NodeModules['os'],
  };
}

interface FolderIndex {
  scannedAt: number;
  entries: MediaEntry<string>[] | null; // null = folder unavailable (unplugged, typo)
}

/**
 * Finds the media for a subtitle, in order:
 *   1. the subtitle's own folder
 *   2. each configured media folder, recursively — a vault folder, or (desktop
 *      only) an absolute folder outside the vault such as an external drive or
 *      an iCloud Drive folder
 *   3. each remote media URL — a home server reached over Tailscale, say —
 *      streamed rather than downloaded
 *
 * Matching is by filename alone (see mediaMatch.ts), so the media can be
 * filed however you like as long as its name is kept.
 */
export class MediaLocator {
  private external = new Map<string, FolderIndex>();
  private scanning = new Map<string, Promise<FolderIndex>>();
  private unreachableSince = new Map<string, number>(); // remote base → when it last timed out

  constructor(private app: App, private settings: () => MediaTranscriptSettings) {}

  /** Forget external listings (settings changed). */
  invalidate() {
    this.external.clear();
    this.unreachableSince.clear();
  }

  /** List external folders in the background so the first open is instant. */
  warm() {
    for (const folder of this.settings().mediaFolders) {
      if (isAbsoluteFolder(folder) && Platform.isDesktopApp) void this.indexOf(folder);
    }
  }

  async resolveForSubtitle(subtitle: TFile): Promise<MediaLookup> {
    const settings = this.settings();
    const searched: string[] = [];

    const dir = subtitle.parent?.path ?? '';
    searched.push(`same folder (${dir || '/'})`);
    const sibling = findMediaForSubtitle(subtitle, this.app.vault, settings);
    if (sibling) return { media: vaultMedia(this.app, sibling), searched };

    const candidates = subtitleBaseCandidates(subtitle.name);
    const pick = <T>(entries: Iterable<MediaEntry<T>>) => pickMedia(
      candidates, entries, settings.supportedVideoExtensions, settings.supportedAudioExtensions,
    );

    for (const folder of settings.mediaFolders) {
      if (!isAbsoluteFolder(folder)) {
        searched.push(folder);
        const file = pick(this.vaultEntries(folder));
        if (file) return { media: vaultMedia(this.app, file), searched };
        continue;
      }

      if (!Platform.isDesktopApp) {
        searched.push(`${folder} (skipped: desktop only)`);
        continue;
      }
      let index = await this.indexOf(folder);
      let path = index.entries ? pick(index.entries) : null;
      if (!path && Date.now() - index.scannedAt > RESCAN_AFTER_MS) {
        index = await this.indexOf(folder, true);
        path = index.entries ? pick(index.entries) : null;
      }
      searched.push(index.entries ? folder : `${folder} (unavailable)`);
      if (path) return { media: this.externalMedia(path), searched };
    }

    for (const base of settings.mediaUrls) {
      const { url, reachable } = await this.probeRemote(base, candidates);
      searched.push(reachable ? base : `${base} (unreachable)`);
      if (url) return { media: this.remoteMedia(url), searched };
    }

    return { media: null, searched };
  }

  /**
   * Ask `base` for every candidate file at once and keep the best that exists.
   * A server can't be listed, so the remote folder is taken to be flat.
   * requestUrl rather than fetch: it isn't subject to CORS, which a plain file
   * server doesn't speak, and it works on mobile.
   */
  private async probeRemote(base: string, candidates: string[]): Promise<{ url: string | null; reachable: boolean }> {
    const since = this.unreachableSince.get(base);
    if (since !== undefined && Date.now() - since < REMOTE_RETRY_AFTER_MS) return { url: null, reachable: false };

    const settings = this.settings();
    const wanted = remoteCandidates(
      candidates,
      [...settings.supportedVideoExtensions, ...settings.supportedAudioExtensions],
    );
    let reachable = false;
    const timeout = new Promise<null>(r => setTimeout(() => r(null), REMOTE_TIMEOUT_MS));
    const results = await Promise.all(wanted.map(async entry => {
      const url = remoteFileUrl(base, entry.ref);
      const status = await Promise.race([
        requestUrl({ url, method: 'HEAD', throw: false }).then(r => r.status, () => null),
        timeout,
      ]);
      if (status !== null) reachable = true; // any answer, even a 404, means it's up
      return status !== null && status < 400 ? { ...entry, ref: url } : null;
    }));
    if (reachable) this.unreachableSince.delete(base);
    else this.unreachableSince.set(base, Date.now());
    const found = results.filter((e): e is MediaEntry<string> => e !== null);
    const url = pickMedia(candidates, found, settings.supportedVideoExtensions, settings.supportedAudioExtensions);
    return { url, reachable };
  }

  private remoteMedia(url: string): ResolvedMedia {
    const name = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
    const dot = name.lastIndexOf('.');
    return {
      src: url,
      basename: name.slice(0, dot),
      extension: name.slice(dot + 1).toLowerCase(),
      file: null,
      location: url,
    };
  }

  private vaultEntries(folder: string): MediaEntry<TFile>[] {
    const prefix = normalizePath(folder) + '/';
    return this.app.vault.getFiles()
      .filter(f => f.path.startsWith(prefix))
      .map(f => ({ basename: f.basename, extension: f.extension, ref: f }));
  }

  private externalMedia(absPath: string): ResolvedMedia {
    const name = absPath.split(/[\\/]/).pop() ?? absPath;
    const dot = name.lastIndexOf('.');
    // Obsidian serves local files under its own resource scheme; the vault's
    // getResourcePath builds the same kind of URL for files inside the vault.
    const urlPath = absPath.replace(/\\/g, '/').replace(/^\//, '')
      .split('/').map(encodeURIComponent).join('/');
    return {
      src: Platform.resourcePathPrefix + urlPath,
      basename: name.slice(0, dot),
      extension: name.slice(dot + 1).toLowerCase(),
      file: null,
      location: absPath,
    };
  }

  private indexOf(folder: string, force = false): Promise<FolderIndex> {
    const cached = this.external.get(folder);
    if (cached && !force) return Promise.resolve(cached);
    const running = this.scanning.get(folder);
    if (running) return running;

    const job = this.scan(folder)
      .then(entries => ({ scannedAt: Date.now(), entries }))
      .catch(() => ({ scannedAt: Date.now(), entries: null }))
      .then(index => {
        this.external.set(folder, index);
        this.scanning.delete(folder);
        return index;
      });
    this.scanning.set(folder, job);
    return job;
  }

  // Desktop only: Node's fs is required lazily so mobile never loads it.
  private async scan(folder: string): Promise<MediaEntry<string>[]> {
    const { fs, path, os } = nodeModules();

    const root = folder.startsWith('~') ? path.join(os.homedir(), folder.slice(1)) : folder;
    const settings = this.settings();
    const exts = new Set(
      [...settings.supportedVideoExtensions, ...settings.supportedAudioExtensions].map(e => e.toLowerCase()),
    );
    const out: MediaEntry<string>[] = [];

    const walk = async (dir: string, depth: number) => {
      if (depth > MAX_DEPTH || out.length >= MAX_ENTRIES) return;
      // A missing root throws (→ "unavailable"); an unreadable subfolder is skipped.
      const items = depth === 0
        ? await fs.promises.readdir(dir, { withFileTypes: true })
        : await fs.promises.readdir(dir, { withFileTypes: true }).catch((): NodeDirent[] => []);
      for (const item of items) {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) {
          if (!item.name.startsWith('.')) await walk(full, depth + 1);
          continue;
        }
        if (!item.isFile()) continue;
        // An evicted iCloud file is listed as its placeholder; reading the real
        // path makes macOS download it, so index it under its real name.
        const placeholder = icloudPlaceholderName(item.name);
        const name = placeholder ?? item.name;
        if (!placeholder && name.startsWith('.')) continue;
        const dot = name.lastIndexOf('.');
        if (dot <= 0) continue;
        const extension = name.slice(dot + 1).toLowerCase();
        if (!exts.has(extension)) continue;
        out.push({ basename: name.slice(0, dot), extension, ref: path.join(dir, name) });
      }
    };

    await walk(root, 0);
    return out;
  }
}
