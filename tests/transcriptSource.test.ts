import { describe, expect, it } from 'vitest';
import {
  nameKey,
  parseRemoteIndex,
  readSource,
  remotePathUrl,
  trackMarker,
  writeSource,
} from '../src/utils/transcriptSource';

const VIBEVOICE = `{
  "source": "Recording 20261006175951.m4a",
  "model": "vibevoice-4bit",
  "duration": 2037.2,
  "segments": [
    { "start": 0, "end": 1, "text": "hi", "source": "nested.m4a" }
  ]
}`;

describe('readSource', () => {
  it('reads the top-level source', () => {
    expect(readSource(VIBEVOICE)).toBe('Recording 20261006175951.m4a');
  });

  it('keeps only the filename of a recorded path', () => {
    expect(readSource('{"source": "/Users/me/rec/talk.m4a"}')).toBe('talk.m4a');
    expect(readSource('{"source": "C:\\\\rec\\\\talk.m4a"}')).toBe('talk.m4a');
  });

  it('ignores a source that is not top-level', () => {
    expect(readSource('{"segments": [{"source": "x.m4a"}]}')).toBeNull();
    expect(readSource('{"meta": {"source": "x.m4a"}, "segments": []}')).toBeNull();
  });

  it('ignores braces inside strings when judging depth', () => {
    expect(readSource('{"title": "a { b [", "source": "x.m4a"}')).toBe('x.m4a');
  });

  it('decodes escapes', () => {
    expect(readSource('{"source": "say \\"hi\\".m4a"}')).toBe('say "hi".m4a');
  });

  it('is null without a usable source', () => {
    expect(readSource('[{"start": 0}]')).toBeNull();
    expect(readSource('{"source": 3}')).toBeNull();
    expect(readSource('{"source": "noextension"}')).toBeNull();
    expect(readSource('1 --> 2\nhello')).toBeNull();
  });
});

describe('writeSource', () => {
  it('replaces the value and nothing else', () => {
    const out = writeSource(VIBEVOICE, 'Weekly sync.m4a');
    expect(out).toBe(VIBEVOICE.replace('Recording 20261006175951.m4a', 'Weekly sync.m4a'));
  });

  it('escapes the new name', () => {
    const out = writeSource(VIBEVOICE, 'say "hi".m4a');
    expect(out && readSource(out)).toBe('say "hi".m4a');
    expect(JSON.parse(out ?? '')).toMatchObject({ model: 'vibevoice-4bit' });
  });

  it('adds a source in the file\'s own indentation', () => {
    const text = '{\n    "model": "whisper",\n    "segments": []\n}';
    expect(writeSource(text, 'talk.m4a')).toBe('{\n    "source": "talk.m4a",\n    "model": "whisper",\n    "segments": []\n}');
  });

  it('adds a source to compact and empty objects', () => {
    expect(writeSource('{"segments":[]}', 'talk.m4a')).toBe('{"source": "talk.m4a", "segments":[]}');
    expect(writeSource('{}', 'talk.m4a')).toBe('{"source": "talk.m4a"}');
  });

  it('refuses what it cannot write safely', () => {
    expect(writeSource('[{"start": 0}]', 'talk.m4a')).toBeNull();
    expect(writeSource('not json', 'talk.m4a')).toBeNull();
  });
});

describe('trackMarker', () => {
  it('is the middle segment, if any', () => {
    expect(trackMarker('talk.whisper.json')).toBe('whisper');
    expect(trackMarker('Recording 1.vibevoice-4bit.json')).toBe('vibevoice-4bit');
    expect(trackMarker('talk.srt')).toBe('');
  });
});

describe('parseRemoteIndex', () => {
  const index = JSON.stringify({
    version: 1,
    files: [
      { path: '2026/10/talk.m4a', sha256: 'a', names: ['talk.m4a', 'old talk.m4a'] },
      { path: '2026/09/old talk.m4a', sha256: 'b', names: ['old talk.m4a'] },
      { path: 'flat.mp4' },
      { names: ['no path'] },
    ],
  });

  it('maps current names and aliases to paths, case-insensitively', () => {
    const r = parseRemoteIndex(index);
    expect(r?.byName.get('talk.m4a')).toBe('2026/10/talk.m4a');
    expect(r?.byName.get('flat.mp4')).toBe('flat.mp4');
    expect(r?.names).toEqual(['talk.m4a', 'old talk.m4a', 'flat.mp4']);
  });

  it('never lets an alias shadow a file that has that name now', () => {
    expect(parseRemoteIndex(index)?.byName.get('old talk.m4a')).toBe('2026/09/old talk.m4a');
  });

  it('is null for anything else', () => {
    expect(parseRemoteIndex('<html>')).toBeNull();
    expect(parseRemoteIndex('{"version": 1}')).toBeNull();
  });
});

describe('remotePathUrl', () => {
  it('encodes each segment and keeps the slashes', () => {
    expect(remotePathUrl('https://m.ts.net/media/', '2026/10/Recording 1.m4a'))
      .toBe('https://m.ts.net/media/2026/10/Recording%201.m4a');
  });
});

describe('nameKey', () => {
  it('matches a name however its characters are composed', () => {
    const composed = 'Café.m4a';
    const decomposed = 'Café.M4A';
    expect(nameKey(decomposed)).toBe(nameKey(composed));
    expect(parseRemoteIndex(JSON.stringify({ files: [{ path: 'a/' + decomposed }] }))?.byName.get(nameKey(composed)))
      .toBe('a/' + decomposed);
  });
});
