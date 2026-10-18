import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('obsidian', () => ({ Platform: { isDesktopApp: true } }));
const { fileSource } = await import('../src/library/streamUpload');

describe('fileSource', () => {
  it('reads pieces from anywhere in a file on disk, and says when it ends', async () => {
    const data = new Uint8Array(3_000_000).map((_, i) => (i * 13) % 251);
    const path = join(mkdtempSync(join(tmpdir(), 'mo-')), 'clip.mp4');
    writeFileSync(path, data);
    const s = await fileSource(path);
    const at = async (offset: number, length: number) => Buffer.from(await s.read(offset, length));
    expect(Buffer.compare(await at(2_000_000, 500_000), Buffer.from(data.subarray(2_000_000, 2_500_000)))).toBe(0);
    expect(Buffer.compare(await at(0, 10), Buffer.from(data.subarray(0, 10)))).toBe(0);
    await expect(s.read(2_999_990, 100)).rejects.toThrow('ended');
    await s.close();
  });
});
