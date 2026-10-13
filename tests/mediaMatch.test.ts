import { describe, expect, it } from 'vitest';
import {
  icloudPlaceholderName,
  isAbsoluteFolder,
  parseFolderList,
  pickMedia,
  subtitleBaseCandidates,
  subtitleBaseName,
  type MediaEntry,
} from '../src/utils/mediaMatch';

const VIDEO = ['mp4', 'mkv'];
const AUDIO = ['mp3', 'm4a'];
const entry = (name: string): MediaEntry<string> => {
  const dot = name.lastIndexOf('.');
  return { basename: name.slice(0, dot), extension: name.slice(dot + 1), ref: name };
};

describe('subtitleBaseCandidates', () => {
  it('peels the marker and keeps the longest first', () => {
    expect(subtitleBaseCandidates('lecture.whisper.json')).toEqual(['lecture.whisper', 'lecture']);
    expect(subtitleBaseCandidates('talk.srt')).toEqual(['talk']);
  });
});

describe('subtitleBaseName', () => {
  it('drops one marker segment when there is one', () => {
    expect(subtitleBaseName('Recording 20261006175951.vibevoice-4bit.json')).toBe('Recording 20261006175951');
    expect(subtitleBaseName('talk.srt')).toBe('talk');
  });
});

describe('pickMedia', () => {
  const cands = subtitleBaseCandidates('talk.whisper.json');

  it('matches by basename regardless of folder', () => {
    expect(pickMedia(cands, [entry('other.mp3'), entry('talk.m4a')], VIDEO, AUDIO)).toBe('talk.m4a');
  });

  it('prefers video over audio, then the configured order', () => {
    expect(pickMedia(cands, [entry('talk.m4a'), entry('talk.mkv'), entry('talk.mp4')], VIDEO, AUDIO))
      .toBe('talk.mp4');
    expect(pickMedia(cands, [entry('talk.m4a'), entry('talk.mp3')], VIDEO, AUDIO)).toBe('talk.mp3');
  });

  it('ignores files that are not configured media', () => {
    expect(pickMedia(cands, [entry('talk.txt'), entry('talk.json')], VIDEO, AUDIO)).toBeNull();
  });

  it('keeps the first of equally good matches', () => {
    const a = { ...entry('talk.m4a'), ref: 'a' };
    const b = { ...entry('talk.m4a'), ref: 'b' };
    expect(pickMedia(cands, [a, b], VIDEO, AUDIO)).toBe('a');
  });

  it('is case-insensitive about extensions', () => {
    expect(pickMedia(cands, [entry('talk.M4A')], VIDEO, AUDIO)).toBe('talk.M4A');
  });
});

describe('folder settings', () => {
  it('tells absolute folders from vault ones', () => {
    expect(isAbsoluteFolder('/Volumes/2T/Media')).toBe(true);
    expect(isAbsoluteFolder('~/Recordings')).toBe(true);
    expect(isAbsoluteFolder('D:\\Media')).toBe(true);
    expect(isAbsoluteFolder('附件/media')).toBe(false);
  });

  it('reads one folder per line, trimmed and deduplicated', () => {
    expect(parseFolderList(' 附件/media/ \n\n/Volumes/2T\n附件/media\r\n')).toEqual(['附件/media', '/Volumes/2T']);
  });
});

describe('icloudPlaceholderName', () => {
  it('recovers the real name of an evicted file', () => {
    expect(icloudPlaceholderName('.talk.m4a.icloud')).toBe('talk.m4a');
    expect(icloudPlaceholderName('talk.m4a')).toBeNull();
  });
});
