import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({ Platform: {}, TFile: class {}, normalizePath: (p: string) => p }));
const { archivedTitle } = await import('../src/library/transcriptSync');

const hash = '97452e24f46a8b8aa6f7de9f327af55cd1f68b51';

describe('archivedTitle', () => {
  it('is the note title and the first six of the hash', () => {
    expect(archivedTitle('mo-video-test', hash)).toBe('mo-video-test · 97452e');
  });

  it('drops what a file name may not hold, and keeps it short', () => {
    expect(archivedTitle('a/b: "c"? #d [e]', hash)).toBe('a b c d e · 97452e');
    expect(archivedTitle('x'.repeat(200), hash)).toBe(`${'x'.repeat(80)} · 97452e`);
  });

  it('falls back to the hash without a title', () => {
    expect(archivedTitle('', hash)).toBe('97452e24f46a');
    expect(archivedTitle(undefined, hash)).toBe('97452e24f46a');
  });
});
