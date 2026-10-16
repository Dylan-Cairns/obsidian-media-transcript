import { describe, expect, it } from 'vitest';
import {
  audioTwin,
  icloudPlaceholderName,
  isRemoteUrl,
  remoteCandidates,
  remoteFileUrl,
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

describe('remote media', () => {
  it('recognises URL prefixes', () => {
    expect(isRemoteUrl('https://old-mac.taildfed27.ts.net/recordings')).toBe(true);
    expect(isRemoteUrl('http://nas.local:8080')).toBe(true);
    expect(isRemoteUrl('/Volumes/2T')).toBe(false);
    expect(isRemoteUrl('附件/media')).toBe(false);
  });

  it('encodes the file name as one path segment', () => {
    expect(remoteFileUrl('https://h.ts.net/recordings/', 'Recording 1.m4a'))
      .toBe('https://h.ts.net/recordings/Recording%201.m4a');
    expect(remoteFileUrl('https://h.ts.net', '录音#1.m4a')).toBe('https://h.ts.net/%E5%BD%95%E9%9F%B3%231.m4a');
  });

  it('asks for every candidate name with every extension', () => {
    const names = remoteCandidates(['talk.whisper', 'talk'], ['MP4', 'm4a']).map(e => e.ref);
    expect(names).toEqual(['talk.whisper.mp4', 'talk.whisper.m4a', 'talk.mp4', 'talk.m4a']);
  });

  it('feeds pickMedia so video still beats audio', () => {
    const found = remoteCandidates(['talk'], ['m4a', 'mp4']);
    expect(pickMedia(['talk'], found, VIDEO, AUDIO)).toBe('talk.mp4');
  });
});

describe('audioTwin', () => {
  const video = ['mp4', 'mov'];
  const audio = ['m4a', 'mp3'];
  const have = (...paths: string[]) => (_: string, sibling: string) => (paths.includes(sibling) ? sibling : null);

  it('finds the audio file named like a video, beside it', () => {
    expect(audioTwin('南添/录制于 19.27.28.mp4', video, audio, have('南添/录制于 19.27.28.m4a'))).toBe('南添/录制于 19.27.28.m4a');
    expect(audioTwin('/Volumes/d/talk.MOV', video, audio, have('/Volumes/d/talk.mp3'))).toBe('/Volumes/d/talk.mp3');
  });

  it('takes audio extensions in order of preference', () => {
    expect(audioTwin('talk.mp4', video, audio, have('talk.mp3', 'talk.m4a'))).toBe('talk.m4a');
  });

  it('has none for audio, other folders or other names', () => {
    expect(audioTwin('talk.m4a', video, audio, have('talk.mp3'))).toBeNull();
    expect(audioTwin('a/talk.mp4', video, audio, have('b/talk.m4a'))).toBeNull();
    expect(audioTwin('talk.mp4', video, audio, have('talk 2.m4a'))).toBeNull();
  });

  it('lets a server look up by filename alone', () => {
    const byName = new Map([['talk.m4a', 'audio/talk.m4a']]);
    expect(audioTwin('video/talk.mp4', video, audio, name => byName.get(name) ?? null)).toBe('audio/talk.m4a');
  });
});
