import { beforeEach, describe, expect, it, vi } from 'vitest';

// One WebDAV server, in memory: files by URL, and whether it answers at all.
const server = { up: true, files: new Map<string, ArrayBuffer>() };

vi.mock('obsidian', () => ({
  requestUrl: ({ url, method = 'GET', body }: { url: string; method?: string; body?: ArrayBuffer }) => {
    if (!server.up) return Promise.reject(new Error('offline'));
    if (method === 'PUT') {
      server.files.set(url, body!);
      return Promise.resolve({ status: 201 });
    }
    if (method === 'MKCOL') return Promise.resolve({ status: 201 });
    if (url.endsWith('/')) return Promise.resolve({ status: 200 });
    const file = server.files.get(url);
    return Promise.resolve(file ? { status: 200, arrayBuffer: file } : { status: 404 });
  },
}));

const { ArchiveServers } = await import('../src/modules/archive/servers');

const BASE = 'https://m.ts.net/archive';
const PATH = '~/Media/_archive/ab/abcdef.mp4';
const NAME = `${BASE}/ab/abcdef.mp4`;
const BUF = new Uint8Array([1, 2, 3]).buffer;

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: k => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: k => void m.delete(k),
    clear: () => m.clear(),
    key: i => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

function host() {
  const local = new Map<string, ArrayBuffer>();
  return {
    local,
    app: { appId: 'test', vault: { getName: () => 'v' } } as never,
    settings: { sources: [{ kind: 'server' as const, url: BASE }, { kind: 'local' as const }] } as never,
    readLocal: (p: string) => Promise.resolve(local.get(p) ?? null),
    writeLocal: (p: string, b: ArrayBuffer) => { local.set(p, b); return Promise.resolve(); },
    removeLocal: (p: string) => { local.delete(p); return Promise.resolve(); },
  };
}

beforeEach(() => {
  server.up = true;
  server.files.clear();
  (globalThis as { window?: unknown }).window = {
    localStorage: memoryStorage(),
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
});

describe('ArchiveServers', () => {
  it('outbox: a server that takes the file at once leaves nothing on the device', async () => {
    const h = host();
    expect(await new ArchiveServers(h).store(PATH, BUF, 'outbox')).toBe(1);
    expect(server.files.has(NAME)).toBe(true);
    expect(h.local.size).toBe(0);
  });

  it('outbox: kept locally while the server is down, removed once uploaded', async () => {
    const h = host();
    server.up = false;
    const s = new ArchiveServers(h);
    expect(await s.store(PATH, BUF, 'outbox')).toBe(0);
    expect(h.local.has(PATH)).toBe(true);
    expect(s.pendingCount()).toBe(1);

    server.up = true;
    expect(await s.flush(BASE)).toBe(1);
    expect(server.files.has(NAME)).toBe(true);
    expect(h.local.has(PATH)).toBe(false);
    expect(s.pendingCount()).toBe(0);
  });

  it('kept: the local copy stays after it is uploaded', async () => {
    const h = host();
    h.local.set(PATH, BUF);
    server.up = false;
    const s = new ArchiveServers(h);
    await s.store(PATH, BUF, 'kept');
    server.up = true;
    await s.flush(BASE);
    expect(h.local.has(PATH)).toBe(true);
  });

  it('none: with no server up there is nothing to queue', async () => {
    const h = host();
    server.up = false;
    const s = new ArchiveServers(h);
    expect(await s.store(PATH, BUF, 'none')).toBe(0);
    expect(s.pendingCount()).toBe(0);
    expect(h.local.size).toBe(0);
  });

  it('keeps the queue on the device, not in the settings', async () => {
    const h = host();
    server.up = false;
    await new ArchiveServers(h).store(PATH, BUF, 'outbox');
    // A new instance (the app restarted) finds the queue and the outbox again.
    server.up = true;
    const again = new ArchiveServers(h);
    expect(again.pendingCount()).toBe(1);
    await again.flush(BASE);
    expect(h.local.has(PATH)).toBe(false);
    expect('pendingUploads' in (h.settings as object)).toBe(false);
  });

  it('adopts a queue saved by an earlier version, and can forget a server', () => {
    const s = new ArchiveServers(host());
    s.adopt({ [BASE]: [PATH, PATH], 'https://old/archive': ['x/y.jpg'] });
    expect(s.pendingCount()).toBe(2);
    s.forget('https://old/archive');
    expect(s.queued()).toEqual({ [BASE]: [PATH] });
  });
});
