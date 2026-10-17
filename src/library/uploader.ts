import { Notice, TAbstractFile, TFile } from 'obsidian';
import type MediaTranscriptPlugin from '../main';
import { sha256Hex } from './client';
import { DeviceState } from './deviceState';
import { t } from '../i18n';

// A recording still being written grows; wait until it stops.
const SETTLE_MS = 3000;
const RETRY_MS = 10 * 60_000;
// Read whole into memory to hash and send: keep that to what a phone can hold.
const MAX_BYTES = 1024 * 1024 * 1024;

/**
 * Uploads media added to the vault to the Media One server, so it is on the
 * server (and, from there, on every device) right away. The file stays in the
 * vault: removing it is left to the offload step, which waits for a backup.
 *
 * Files that can't be uploaded now (no server, no network) wait in a queue
 * kept on this device and are retried every 10 minutes and at startup.
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
      void this.flush();
    });
    plugin.registerInterval(window.setInterval(() => void this.flush(), RETRY_MS));
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
    if (file.stat.size > MAX_BYTES) {
      new Notice(t('library.uploadTooBig', { name: file.name }));
      return 'done';
    }
    try {
      const data = await vault.readBinary(file);
      const stored = await this.plugin.library.upload(file.path, data, await sha256Hex(data));
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
