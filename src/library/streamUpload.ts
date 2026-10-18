import { Platform } from 'obsidian';
import { LibraryError } from './client';

/**
 * Upload a file from disk without holding it in memory: desktop only, through
 * Node's fs and http(s), which the desktop app has. For recordings and videos
 * of gigabytes, which a request built from an ArrayBuffer can't carry.
 */

type Node = {
  fs: typeof import('fs');
  crypto: typeof import('crypto');
  http: typeof import('http');
  https: typeof import('https');
};

function node(): Node {
  if (!Platform.isDesktopApp) throw new LibraryError(0, 'streaming an upload needs the desktop app');
  /* eslint-disable @typescript-eslint/no-require-imports -- desktop only, loaded on first use so phones never try */
  const fs = require('fs') as typeof import('fs');
  const crypto = require('crypto') as typeof import('crypto');
  const http = require('http') as typeof import('http');
  const https = require('https') as typeof import('https');
  /* eslint-enable @typescript-eslint/no-require-imports -- end of the desktop-only requires */
  return { fs, crypto, http, https };
}

/** The sha256 of a file, read in pieces. */
export function sha256OfFile(path: string): Promise<string> {
  const { fs, crypto } = node();
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(path)
      .on('data', chunk => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * PUT the file at `path` to `url` as the request body, streamed. Resolves with
 * the status; a status of 400 or more rejects with the server's error.
 */
export function putFile(url: string, path: string, size: number, onProgress?: (sent: number) => void): Promise<number> {
  const { fs, http, https } = node();
  const target = new URL(url);
  const lib = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(target, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) },
    }, res => {
      const chunks: Uint8Array[] = [];
      res.on('data', (c: Uint8Array) => chunks.push(c));
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        if (status < 400) return resolve(status);
        let message = `HTTP ${status}`;
        try {
          const body = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
          let at = 0;
          for (const c of chunks) {
            body.set(c, at);
            at += c.length;
          }
          message = (JSON.parse(new TextDecoder().decode(body)) as { error?: string }).error ?? message;
        } catch {
          // not JSON: keep the status
        }
        reject(new LibraryError(status, message));
      });
    });
    req.on('error', e => reject(new LibraryError(0, e.message)));
    let sent = 0;
    fs.createReadStream(path)
      .on('data', (c: Uint8Array | string) => {
        sent += c.length;
        onProgress?.(sent);
      })
      .on('error', e => req.destroy(e))
      .pipe(req);
  });
}
