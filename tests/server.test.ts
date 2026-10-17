import { describe, expect, it } from 'vitest';
import { applyServer, normalizeServer } from '../src/utils/server';

const S = 'https://old-mac.example.ts.net';

describe('applyServer', () => {
  it('adds the library and the archive first', () => {
    const r = applyServer({ mediaUrls: ['https://other/media'], sources: [{ kind: 'local' }], pendingUploads: {} }, '', S);
    expect(r.mediaUrls).toEqual([`${S}/library`, 'https://other/media']);
    expect(r.sources).toEqual([{ kind: 'server', url: `${S}/archive` }, { kind: 'local' }]);
  });

  it('takes over the addresses it already had, including the old WebDAV path', () => {
    const r = applyServer({
      mediaUrls: [`${S}/library/`],
      sources: [{ kind: 'server', url: `${S}/dav/archive` }, { kind: 'local' }],
      pendingUploads: { [`${S}/dav/archive`]: ['a.png'] },
    }, '', S);
    expect(r.mediaUrls).toEqual([`${S}/library`]);
    expect(r.sources).toEqual([{ kind: 'server', url: `${S}/archive` }, { kind: 'local' }]);
    expect(r.pendingUploads).toEqual({ [`${S}/archive`]: ['a.png'] });
  });

  it('replaces the previous server and keeps everything else', () => {
    const before = applyServer({ mediaUrls: ['https://x/m'], sources: [{ kind: 'local' }, { kind: 'server', url: 'https://y/dav' }], pendingUploads: {} }, '', S);
    const r = applyServer(before, S, 'https://new.ts.net');
    expect(r.mediaUrls).toEqual(['https://new.ts.net/library', 'https://x/m']);
    expect(r.sources).toEqual([
      { kind: 'server', url: 'https://new.ts.net/archive' },
      { kind: 'local' },
      { kind: 'server', url: 'https://y/dav' },
    ]);
  });

  it('clearing the server removes its entries and drops what waited for it', () => {
    const r = applyServer({
      mediaUrls: [`${S}/library`],
      sources: [{ kind: 'server', url: `${S}/archive` }, { kind: 'local' }],
      pendingUploads: { [`${S}/archive`]: ['a.png'], 'https://y/dav': ['b.png'] },
    }, S, '');
    expect(r.mediaUrls).toEqual([]);
    expect(r.sources).toEqual([{ kind: 'local' }]);
    expect(r.pendingUploads).toEqual({ 'https://y/dav': ['b.png'] });
  });

  it('leaves the archive alone when the module has no settings yet', () => {
    const r = applyServer({ mediaUrls: [], sources: null, pendingUploads: null }, '', S);
    expect(r.sources).toBeNull();
    expect(r.mediaUrls).toEqual([`${S}/library`]);
  });

  it('normalizes', () => {
    expect(normalizeServer(' https://a.ts.net/// ')).toBe('https://a.ts.net');
  });
});
