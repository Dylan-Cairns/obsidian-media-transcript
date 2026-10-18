import { Platform } from 'obsidian';
import type { PieceSource } from './pieceUpload';

/**
 * Pieces read straight from a file on disk, wherever they are in it: the
 * desktop app has Node's fs, so a file of gigabytes is read a piece at a
 * time and never held whole.
 */
export async function fileSource(fullPath: string): Promise<PieceSource> {
  if (!Platform.isDesktopApp) throw new Error('reading from disk needs the desktop app');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- desktop only, loaded on first use so phones never try
  const fs = require('fs') as typeof import('fs');
  const handle = await fs.promises.open(fullPath, 'r');
  return {
    async read(offset, length) {
      const out = new Uint8Array(length);
      let filled = 0;
      while (filled < length) {
        const { bytesRead } = await handle.read(out, filled, length - filled, offset + filled);
        if (bytesRead === 0) throw new Error(`the file ended at ${offset + filled}`);
        filled += bytesRead;
      }
      return out.buffer;
    },
    close: () => handle.close().catch(() => {}),
  };
}
