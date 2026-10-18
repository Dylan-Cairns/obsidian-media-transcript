import { FileSystemAdapter, Notice, Platform, TAbstractFile, TFile } from 'obsidian';
import type MediaTranscriptPlugin from '../main';
import { sha256Hex } from './client';
import { DeviceState } from './deviceState';
import { uploadInPieces } from './pieceUpload';
import { t } from '../i18n';

// A recording still being written grows; wait until it stops.
const SETTLE_MS = 3000;
const RETRY_MS = 10 * 60_000;
// Up to this, a file is read whole and sent in one request. Larger, the
// desktop streams it from disk in one request, and a phone (which can't)
// sends it a piece at a time, carrying on after a break.
const STREAM_FROM = 64 * 1024 * 1024;

/**
 * Uploads media added to the vault to the Media One server, so it is on the
 * server (and, from there, on every device) right away. The file stays in the
 * vault: removing it is left to the offload step, which waits for a backup.
 *
 * Files that can't be uploaded now (no server, no network) wait in a queue
 * kept on this device and are retried every 10 minutes and at startup.
 *
 * A file added while Obsidian wasn't running (copied into the vault in the
 * Finder, say) raises no event; nor does one passed over before (too large
 * for an earlier version). So at startup and with each retry, media added
 * since uploading was turned on that the server doesn't have is queued too.
 */
export class Uploader {
  private running = false;
  private readonly device: DeviceState;
  /** Vault paths this device still has to upload. */
  readonly pending: string[];

  constructor(private readonly plugin: MediaTranscriptPlugin) {
    this.device = new DeviceState(plugin.app);
    this.pending = this.device.get<string[]>('pendingUploads', []);
  }

  /** Take over paths queued elsewhere (an older version's settings); missing files are skipped when uploading. */
  adopt(paths: string[]): void {
    const fresh = paths.filter(p => !this.pending.includes(p));
    if (fresh.length === 0) return;
    this.pending.push(...fresh);
    this.keep();
  }

  private keep(): void {
    this.device.set('pendingUploads', this.pending);
  }

  start(): void {
    const { plugin } = this;
    // Registered once the vault is loaded, so the existing files don't all count as new.
    plugin.app.workspace.onLayoutReady(() => {
      plugin.registerEvent(plugin.app.vault.on('create', f => this.added(f)));
      plugin.registerEvent(plugin.app.vault.on('rename', (f, old) => this.renamed(f, old)));
      plugin.registerEvent(plugin.app.vault.on('delete', f => this.forget(f.path)));
      void this.sweep().then(() => this.flush());
    });
    plugin.registerInterval(window.setInterval(() => void this.sweep().then(() => this.flush()), RETRY_MS));
  }

  /**
   * Since when this device uploads what is added: the first time it is seen
   * with uploading on. What was in the vault before is the backup's to copy.
   */
  private since(): number {
    let since = this.device.get<number>('uploadSince', 0);
    if (!since) {
      since = Date.now();
      this.device.set('uploadSince', since);
    }
    return since;
  }

  /** Uploading turned on: what is added from now on is new; what is there is not. */
  startCountingFromNow(): void {
    this.device.set('uploadSince', Date.now());
  }

  /** Queue media added since uploading was turned on that the server hasn't got. */
  async sweep(): Promise<number> {
    if (!this.enabled()) return 0;
    const since = this.since();
    const fresh = this.plugin.app.vault.getFiles().filter(f =>
      this.plugin.isMedia(f) && f.stat.ctime >= since && !this.pending.includes(f.path));
    if (fresh.length === 0) return 0;
    let onServer: Set<string>;
    try {
      onServer = new Set((await this.plugin.library.files()).map(e => e.vaultPath));
    } catch {
      return 0;  // the server isn't there: the next round
    }
    const missing = fresh.filter(f => !onServer.has(f.path)).map(f => f.path);
    if (missing.length) this.adopt(missing);
    return missing.length;
  }

  private enabled(): boolean {
    return this.plugin.settings.uploadNewMedia && this.plugin.library.configured;
  }

  private added(file: TAbstractFile): void {
    if (!(file instanceof TFile) || !this.plugin.isMedia(file) || !this.enabled()) return;
    void this.enqueue(file.path);
  }

  private renamed(file: TAbstractFile, oldPath: string): void {
    const i = this.pending.indexOf(oldPath);
    if (i < 0) return;
    this.pending[i] = file.path;
    this.keep();
  }

  private forget(path: string): void {
    const i = this.pending.indexOf(path);
    if (i < 0) return;
    this.pending.splice(i, 1);
    this.keep();
  }

  async enqueue(path: string): Promise<void> {
    if (!this.pending.includes(path)) {
      this.pending.push(path);
      this.keep();
    }
    await this.flush();
  }

  /** Upload what is waiting, oldest first; stops at the first failure to reach the server. */
  async flush(): Promise<void> {
    if (this.running || !this.enabled() || this.pending.length === 0) return;
    this.running = true;
    try {
      for (const path of [...this.pending]) {
        const outcome = await this.uploadOne(path);
        if (outcome === 'retry') break;
        this.forget(path);
      }
    } finally {
      this.running = false;
    }
  }

  /** 'done' (stored, already there, or nothing to do) or 'retry' later. */
  async uploadOne(path: string): Promise<'done' | 'retry'> {
    const { vault } = this.plugin.app;
    const file = vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return 'done';
    if (!(await this.settled(file))) return 'retry';
    const adapter = vault.adapter;
    const large = file.stat.size > STREAM_FROM;
    const stream = large && Platform.isDesktopApp && adapter instanceof FileSystemAdapter;
    try {
      let stored: boolean;
      if (large) {
        const size = file.stat.size;
        const progress = new Notice(t('library.uploading', { name: file.name, percent: 0 }), 0);
        let shown = -1;
        const onProgress = (sent: number) => {
          const percent = Math.floor((sent / size) * 100);
          if (percent === shown) return;
          shown = percent;
          // All sent: the server reads it back to check it before keeping it.
          progress.setMessage(percent >= 100 ? t('library.uploadChecking', { name: file.name }) : t('library.uploading', { name: file.name, percent }));
        };
        try {
          if (stream && adapter instanceof FileSystemAdapter) {
            stored = await this.plugin.library.uploadFromDisk(file.path, adapter.getFullPath(file.path), size, onProgress);
          } else {
            // The app serves vault files with ranges: read from where the server is, as a stream.
            const url = vault.getResourcePath(file);
            stored = await uploadInPieces(this.plugin.library, file.path, size, async offset => {
              const r = await fetch(url, { headers: { Range: `bytes=${offset}-` } });
              if (!r.ok || !r.body) throw new Error(`can't read ${file.path} (${r.status})`);
              if (offset > 0 && r.status !== 206) throw new Error(`can't read ${file.path} from the middle`);
              return r.body;
            }, onProgress);
          }
        } finally {
          progress.hide();
        }
      } else {
        const data = await vault.readBinary(file);
        stored = await this.plugin.library.upload(file.path, data, await sha256Hex(data));
      }
      if (stored) new Notice(t('library.uploaded', { name: file.name }));
      this.plugin.mediaLocator.invalidate();
      return 'done';
    } catch (e) {
      const status = (e as { status?: number }).status ?? 0;
      if (status === 409) {
        new Notice(t('library.uploadConflict', { name: file.name, path: file.path }), 10000);
        return 'done';
      }
      if (status === 400) {
        console.warn(`[media-one] upload of ${path} refused:`, e);
        return 'done';
      }
      return 'retry';
    }
  }

  /** Wait until the file stops growing (a recording being written, a copy in progress). */
  private async settled(file: TFile): Promise<boolean> {
    const adapter = this.plugin.app.vault.adapter;
    let size = (await adapter.stat(file.path))?.size ?? -1;
    for (let i = 0; i < 20; i++) {
      await sleep(SETTLE_MS);
      const now = (await adapter.stat(file.path))?.size ?? -1;
      if (now === size && now > 0) return true;
      size = now;
    }
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}
