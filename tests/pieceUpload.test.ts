import { describe, expect, it } from 'vitest';
import { PIECE, uploadInPieces } from '../src/library/pieceUpload';
import type { LibraryClient } from '../src/library/client';

/** A server keeping pieces in order, as Media One does. */
function fakeServer(opts: { received?: number; there?: boolean; slipAt?: number } = {}) {
  const store: Uint8Array[] = [];
  let received = opts.received ?? 0;
  let finished = false;
  let slipped = false;
  const client = {
    uploadBegin: async () => (opts.there ? { entry: {} } : { id: 'u1', received }),
    uploadPiece: async (_id: string, offset: number, data: ArrayBuffer) => {
      if (offset !== received) return received;
      // Once: the piece is taken, but the answer says the server is a piece behind.
      if (opts.slipAt !== undefined && offset === opts.slipAt && !slipped) {
        slipped = true;
        return received;
      }
      store.push(new Uint8Array(data));
      received += data.byteLength;
      return received;
    },
    uploadFinish: async () => { finished = true; },
  } as unknown as LibraryClient;
  const joined = () => {
    const out = new Uint8Array(store.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of store) { out.set(c, at); at += c.length; }
    return out;
  };
  return { client, store, joined, get finished() { return finished; } };
}

/** The file as a stream from `offset`, in uneven chunks the way a reader hands them out. */
function opener(file: Uint8Array, opened: number[]) {
  return async (offset: number) => {
    opened.push(offset);
    let at = offset;
    const sizes = [1000, 3 * 1024 * 1024 + 7, 5 * 1024 * 1024];
    let i = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (at >= file.length) return controller.close();
        const n = sizes[i++ % sizes.length];
        controller.enqueue(file.subarray(at, at + n));
        at += n;
      },
    });
  };
}

const file = new Uint8Array(PIECE * 2 + 12345).map((_, i) => (i * 7) % 251);

describe('uploadInPieces', () => {
  it('sends the whole file in pieces, in order', async () => {
    const server = fakeServer();
    const opened: number[] = [];
    const progress: number[] = [];
    expect(await uploadInPieces(server.client, 'a.mp4', file.length, opener(file, opened), p => progress.push(p))).toBe(true);
    expect(Buffer.compare(Buffer.from(server.joined()), Buffer.from(file))).toBe(0);
    expect(server.finished).toBe(true);
    expect(opened).toEqual([0]);
    expect(progress.at(-1)).toBe(file.length);
  });

  it('carries on from what the server already has', async () => {
    const server = fakeServer({ received: PIECE });
    server.store.push(file.slice(0, PIECE));
    const opened: number[] = [];
    await uploadInPieces(server.client, 'a.mp4', file.length, opener(file, opened));
    expect(opened).toEqual([PIECE]);
    expect(Buffer.compare(Buffer.from(server.joined()), Buffer.from(file))).toBe(0);
  });

  it('reopens the file where the server says it is', async () => {
    const server = fakeServer({ slipAt: PIECE });
    const opened: number[] = [];
    await uploadInPieces(server.client, 'a.mp4', file.length, opener(file, opened));
    expect(opened).toEqual([0, PIECE]);
    expect(Buffer.compare(Buffer.from(server.joined()), Buffer.from(file))).toBe(0);
  });

  it('does nothing when the server has the file', async () => {
    const server = fakeServer({ there: true });
    const opened: number[] = [];
    expect(await uploadInPieces(server.client, 'a.mp4', file.length, opener(file, opened))).toBe(false);
    expect(opened).toEqual([]);
  });
});
