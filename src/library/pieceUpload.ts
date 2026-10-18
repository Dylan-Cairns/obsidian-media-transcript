import type { LibraryClient } from './client';

/** Pieces of 8 MB: little to hold in memory, few enough requests. */
export const PIECE = 8 * 1024 * 1024;

/**
 * Upload a file a piece at a time, reading it as a stream: what a phone can
 * do with a recording of gigabytes, holding one piece in memory. The server
 * keeps what arrived, so after a break (the app sent to the background, the
 * network gone) the next try carries on from there.
 *
 * `read(offset)` opens the file from `offset` as a stream. Returns true if the
 * file was stored now, false if the server had it already.
 */
export async function uploadInPieces(
  client: LibraryClient,
  vaultPath: string,
  size: number,
  read: (offset: number) => Promise<ReadableStream<Uint8Array>>,
  onProgress?: (sent: number) => void,
): Promise<boolean> {
  const begun = await client.uploadBegin(vaultPath, size);
  if ('entry' in begun) return false;
  const { id } = begun;
  let offset = begun.received;
  onProgress?.(offset);
  while (offset < size) {
    // Read from where the server is; a piece it says is out of step reopens the file there.
    const reader = (await read(offset)).getReader();
    let rest: Uint8Array = new Uint8Array(0);  // read past the piece being filled: the start of the next
    try {
      let inStep = true;
      while (offset < size && inStep) {
        const piece = new Uint8Array(Math.min(PIECE, size - offset));
        let filled = 0;
        while (filled < piece.length) {
          if (rest.length === 0) {
            const { done, value } = await reader.read();
            if (done) throw new Error(`the file ended at ${offset + filled} of ${size} bytes`);
            rest = value;
          }
          const take = Math.min(rest.length, piece.length - filled);
          piece.set(rest.subarray(0, take), filled);
          filled += take;
          rest = rest.subarray(take);
        }
        const sent = await client.uploadPiece(id, offset, piece.buffer, await sha256Hex(piece.buffer));
        inStep = sent === offset + piece.length;
        offset = sent;
        onProgress?.(offset);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  await client.uploadFinish(id);
  return true;
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
