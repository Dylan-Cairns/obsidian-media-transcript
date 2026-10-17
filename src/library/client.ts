import { requestUrl, type RequestUrlResponse } from 'obsidian';

/** A media file in the library, as the server lists it. */
export interface LibraryFile {
  path: string;          // in the library: <vault folder>/<vaultPath>
  vaultPath: string;     // where it is (or was) in the vault
  sha256: string;
  size: number;
  names: string[];
  added?: string;
  renamed?: string;
}

export interface TrashItem {
  id: string;
  path: string;
  trashed: string;
  entry: LibraryFile;
}

export class LibraryError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * The Media One server's library API. Every change goes through the server,
 * which keeps the files and index.json and refuses anything unsafe (it never
 * deletes outright: deleted files wait in its trash for 30 days).
 */
export class LibraryClient {
  constructor(private readonly server: () => string, private readonly vault: () => string) {}

  get configured(): boolean {
    return this.server() !== '';
  }

  async files(): Promise<LibraryFile[]> {
    const r = await this.call('GET', `files?vault=${encodeURIComponent(this.vault())}`);
    return (r.json as { files: LibraryFile[] }).files;
  }

  async trash(): Promise<TrashItem[]> {
    const r = await this.call('GET', `trash?vault=${encodeURIComponent(this.vault())}`);
    return (r.json as { trash: TrashItem[] }).trash;
  }

  /** Store `data` at `vaultPath`. True if stored now, false if the server already had this file. */
  async upload(vaultPath: string, data: ArrayBuffer, sha256: string): Promise<boolean> {
    const q = new URLSearchParams({ vault: this.vault(), path: vaultPath, sha256 });
    const r = await this.call('PUT', `upload?${q.toString()}`, data, 'application/octet-stream');
    return r.status === 201;
  }

  async rename(from: string, to: string): Promise<void> {
    await this.call('POST', 'rename', JSON.stringify({ vault: this.vault(), from, to }), 'application/json');
  }

  async delete(vaultPath: string): Promise<void> {
    await this.call('POST', 'delete', JSON.stringify({ vault: this.vault(), path: vaultPath }), 'application/json');
  }

  /** Put a trashed file back; returns where it went (a number is added if the name was taken). */
  async restore(id: string): Promise<string> {
    const r = await this.call('POST', 'restore', JSON.stringify({ vault: this.vault(), id }), 'application/json');
    return (r.json as { vaultPath: string }).vaultPath;
  }

  /** Where the server serves a file of this vault. */
  url(vaultPath: string): string {
    const parts = [this.vault(), ...vaultPath.split('/')].map(encodeURIComponent);
    return `${this.server()}/library/${parts.join('/')}`;
  }

  private async call(method: string, api: string, body?: string | ArrayBuffer, contentType?: string): Promise<RequestUrlResponse> {
    if (!this.configured) throw new LibraryError(0, 'No Media One server is set.');
    let r: RequestUrlResponse;
    try {
      r = await requestUrl({ url: `${this.server()}/api/${api}`, method, body, contentType, throw: false });
    } catch {
      throw new LibraryError(0, 'The Media One server cannot be reached.');
    }
    if (r.status >= 400) {
      let message = `HTTP ${r.status}`;
      try {
        message = (r.json as { error?: string }).error ?? message;
      } catch {
        // not JSON: keep the status
      }
      throw new LibraryError(r.status, message);
    }
    return r;
  }
}

/** SHA-256 of `data`, as lowercase hex. */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
