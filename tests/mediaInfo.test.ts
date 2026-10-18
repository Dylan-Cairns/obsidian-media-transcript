import { describe, expect, it } from 'vitest';
import { durationIn, formatDuration, isDatedName, isGenericName, isTranscriptNamedFor, openingWords, recordedAt } from '../src/library/mediaInfo';

describe('recordedAt', () => {
  it('reads the moment a recorder put in the name', () => {
    expect(recordedAt('Recording 20260902210306.m4a')).toEqual(new Date(2026, 8, 2, 21, 3, 6));
    expect(recordedAt('录制于 2026-08-27 11.05.55.m4a')).toEqual(new Date(2026, 7, 27, 11, 5, 55));
    expect(recordedAt('Pasted Image 20261009164946_322.png')).toEqual(new Date(2026, 9, 9, 16, 49, 46));
    expect(recordedAt('2026-09-07 会议.m4a')).toEqual(new Date(2026, 8, 7));
    expect(recordedAt('高买低卖也赚钱！2016-1-10 PM4 24.m4a')).toEqual(new Date(2016, 0, 10));
  });

  it('is null when the name says nothing, or something impossible', () => {
    expect(recordedAt('【0102早盘消息】王斌：2023年大吉大利！.m4a')).toBeNull();
    expect(recordedAt('Recording 20261399250000.m4a')).toBeNull();
    expect(recordedAt('Recording 20260231120000.m4a')).toBeNull();
  });
});

describe('formatDuration', () => {
  it('shows hours only when there are some', () => {
    expect(formatDuration(245)).toBe('4:05');
    expect(formatDuration(4363.16)).toBe('1:12:43');
    expect(formatDuration(0)).toBe('0:00');
  });
});

describe('durationIn', () => {
  it('reads the length a transcript records', () => {
    expect(durationIn('{\n  "source": "a.m4a",\n  "duration": 4363.16,\n  "segments": []}')).toBe(4363.16);
    expect(durationIn('{"segments": []}')).toBeNull();
  });
});

describe('isTranscriptNamedFor', () => {
  it('matches <name>.<model>.json, not annotations or other files', () => {
    expect(isTranscriptNamedFor('Recording 1.vibevoice-4bit.json', 'Recording 1.m4a')).toBe(true);
    expect(isTranscriptNamedFor('Recording 1.m4a.anno.json', 'Recording 1.m4a')).toBe(false);
    expect(isTranscriptNamedFor('Recording 10.vibevoice-4bit.json', 'Recording 1.m4a')).toBe(false);
    expect(isTranscriptNamedFor('Recording 1.vibevoice-4bit.txt', 'Recording 1.m4a')).toBe(false);
  });
});

describe('openingWords', () => {
  it('takes the first speech, skipping silence and music', () => {
    const json = JSON.stringify({ duration: 10, segments: [
      { start: 0, text: '[Silence]' }, { start: 2, text: '好，子涵聊完了。' }, { start: 5, text: '对，怎么样？' }, { start: 8, text: '（音乐）' },
    ] });
    expect(openingWords(json)).toBe('好，子涵聊完了。对，怎么样？');
    expect(openingWords(json, 6)).toBe('好，子涵聊完…');
    expect(openingWords('{"segments": []}')).toBe('');
  });
});

describe('isDatedName', () => {
  it('knows a daily note', () => {
    expect(isDatedName('2026-10-16')).toBe(true);
    expect(isDatedName('2026-09-07 语言即世界 - 和曾鸣聊产业史观')).toBe(false);
    expect(isDatedName('周会')).toBe(false);
  });
});

describe('isGenericName', () => {
  it('tells a name a device gave from one someone chose', () => {
    expect(isGenericName('Recording 20260902210306.m4a')).toBe(true);
    expect(isGenericName('录制于 2026-08-27 11.05.55.m4a')).toBe(true);
    expect(isGenericName('Pasted Image 20261009164946_322.png')).toBe(true);
    expect(isGenericName('高买低卖也赚钱！2016-1-10 PM4 24.m4a')).toBe(false);
    expect(isGenericName('周会.m4a')).toBe(false);
  });
});
