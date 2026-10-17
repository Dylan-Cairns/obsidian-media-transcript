import { Platform, TFile, normalizePath } from 'obsidian';
import type MediaTranscriptPlugin from '../main';
import type { Job } from './client';
import { DeviceState } from './deviceState';

const EVERY_MS = 2 * 60_000;
// On a phone, leave a fresh transcript to the computer for a while: two
// devices writing the same new file at once makes Obsidian Sync keep both.
const PHONE_DELAY_S = 30 * 60;
// Clocks differ and jobs finish between polls: look back a little.
const OVERLAP_S = 120;

/**
 * Brings transcripts the server's worker wrote into the vault, beside where
 * the media is (or was), so they are searchable and sync like any note. A
 * transcript already in the vault is not overwritten (it may hold edits),
 * except by a transcription asked for again ("Transcribe again").
 */
export class TranscriptSync {
  private running = false;
  private jobs: Job[] = [];
  private readonly device: DeviceState;

  constructor(private readonly plugin: MediaTranscriptPlugin) {
    this.device = new DeviceState(plugin.app);
  }

  start(): void {
    const { plugin } = this;
    plugin.app.workspace.onLayoutReady(() => { void this.sync(); });
    plugin.registerInterval(window.setInterval(() => void this.sync(), EVERY_MS));
  }

  /** The jobs seen last, for showing what is being transcribed. */
  get known(): Job[] {
    return this.jobs;
  }

  async sync(): Promise<number> {
    const { plugin } = this;
    if (this.running || !plugin.library.configured) return 0;
    this.running = true;
    let written = 0;
    try {
      const since = this.device.get<number>('transcriptSyncSince', 0);
      const { jobs, now } = await plugin.library.jobs(since ? since - OVERLAP_S : undefined);
      this.remember(jobs);
      let next = now;
      for (const job of jobs) {
        if (job.state !== 'done' || job.outputs.length === 0) continue;
        if (Platform.isMobile && now - (job.finished ?? now) < PHONE_DELAY_S) {
          next = Math.min(next, job.changed);  // look at it again next time
          continue;
        }
        written += await this.bring(job);
      }
      this.device.set('transcriptSyncSince', next);
    } catch (e) {
      console.warn('[media-one] transcript sync:', e);
    } finally {
      this.running = false;
    }
    return written;
  }

  private remember(jobs: Job[]): void {
    const byId = new Map(this.jobs.map(j => [j.id, j]));
    for (const j of jobs) byId.set(j.id, j);
    this.jobs = [...byId.values()];
  }

  /** Write the job's transcripts the vault doesn't have yet; returns how many. */
  private async bring(job: Job): Promise<number> {
    const { vault } = this.plugin.app;
    const vaultPath = job.path.slice(job.path.indexOf('/') + 1);
    const dir = vaultPath.includes('/') ? vaultPath.slice(0, vaultPath.lastIndexOf('/')) : '';
    let n = 0;
    for (const name of job.outputs) {
      const target = normalizePath(dir ? `${dir}/${name}` : name);
      const existing = vault.getAbstractFileByPath(target);
      if (existing instanceof TFile) {
        if (!job.force) continue;
        const text = await this.plugin.library.text(target);
        if (text !== await vault.read(existing)) {
          await vault.modify(existing, text);
          n++;
        }
        continue;
      }
      const text = await this.plugin.library.text(target);
      if (dir && !vault.getAbstractFileByPath(dir)) await vault.createFolder(dir);
      if (vault.getAbstractFileByPath(target)) continue;  // arrived meanwhile (Sync)
      await vault.create(target, text);
      n++;
    }
    return n;
  }
}
