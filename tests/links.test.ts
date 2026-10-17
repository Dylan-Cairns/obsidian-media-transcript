import { describe, expect, it } from 'vitest';
import { retargetLink, rewriteNote } from '../src/library/links';

const from = { name: 'Recording 1.m4a', path: 'Daily/att/Recording 1.m4a' };
const to = { name: '周会.m4a', path: '会议/周会.m4a' };

describe('retargetLink', () => {
  it('keeps a bare name a bare name, with its fragment and alias', () => {
    expect(retargetLink('![[Recording 1.m4a]]', 'Recording 1.m4a', from, to)).toBe('![[周会.m4a]]');
    expect(retargetLink('![[Recording 1.m4a#t=30|开头]]', 'Recording 1.m4a#t=30', from, to)).toBe('![[周会.m4a#t=30|开头]]');
    expect(retargetLink('[[recording 1.M4A]]', 'recording 1.M4A', from, to)).toBe('[[周会.m4a]]');
  });

  it('gives a path link the new path', () => {
    expect(retargetLink('![[Daily/att/Recording 1.m4a]]', 'Daily/att/Recording 1.m4a', from, to)).toBe('![[会议/周会.m4a]]');
    expect(retargetLink('![[att/Recording 1.m4a]]', 'att/Recording 1.m4a', from, to)).toBe('![[会议/周会.m4a]]');
  });

  it('handles markdown links with escaped spaces', () => {
    expect(retargetLink('![x](Recording%201.m4a)', 'Recording%201.m4a', from, to)).toBe('![x](%E5%91%A8%E4%BC%9A.m4a)');
    expect(retargetLink('[x](Daily/att/Recording%201.m4a)', 'Daily/att/Recording%201.m4a', from, to)).toBe('[x](%E4%BC%9A%E8%AE%AE/%E5%91%A8%E4%BC%9A.m4a)');
  });

  it('leaves other links alone', () => {
    expect(retargetLink('![[Recording 10.m4a]]', 'Recording 10.m4a', from, to)).toBeNull();
    expect(retargetLink('![[Other/Recording 1.m4a]]', 'Other/Recording 1.m4a', from, to)).toBeNull();
    expect(retargetLink('[[Recording 1.m4a.md]]', 'Recording 1.m4a.md', from, to)).toBeNull();
  });
});

describe('rewriteNote', () => {
  it('rewrites every link to the file, from the end so offsets hold', () => {
    const text = 'a ![[Recording 1.m4a]] b [[Recording 1.m4a#t=5]] c ![[x.m4a]]';
    const links = [
      { original: '![[Recording 1.m4a]]', link: 'Recording 1.m4a', start: 2, end: 22 },
      { original: '[[Recording 1.m4a#t=5]]', link: 'Recording 1.m4a#t=5', start: 25, end: 48 },
      { original: '![[x.m4a]]', link: 'x.m4a', start: 51, end: 61 },
    ];
    expect(rewriteNote(text, links, from, to)).toEqual({ text: 'a ![[周会.m4a]] b [[周会.m4a#t=5]] c ![[x.m4a]]', changed: 2 });
  });

  it('skips a link that moved since the cache saw it', () => {
    const text = 'xx ![[Recording 1.m4a]]';
    const links = [{ original: '![[Recording 1.m4a]]', link: 'Recording 1.m4a', start: 0, end: 20 }];
    expect(rewriteNote(text, links, from, to)).toEqual({ text, changed: 0 });
  });
});
