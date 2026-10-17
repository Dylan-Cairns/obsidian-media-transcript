import type { App } from 'obsidian';

/**
 * What belongs to this device only: the files it still has to upload, how far
 * it has brought transcripts in. Kept out of data.json, which Obsidian Sync
 * shares between devices (another device would see this one's queue, find
 * the files missing, and drop them), in this device's local storage, per vault.
 */
export class DeviceState {
  private readonly prefix: string;

  constructor(app: App) {
    // The vault's id where Obsidian has one: two vaults may share a name.
    const id = (app as unknown as { appId?: string }).appId ?? app.vault.getName();
    this.prefix = `media-one:${id}:`;
  }

  get<T>(key: string, fallback: T): T {
    try {
      const raw = window.localStorage.getItem(this.prefix + key);
      return raw === null ? fallback : JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  set(key: string, value: unknown): void {
    try {
      window.localStorage.setItem(this.prefix + key, JSON.stringify(value));
    } catch (e) {
      console.warn('[media-one] could not keep device state', e);
    }
  }
}
