import { describe, expect, it } from 'vitest';
import { _all, obsidianLanguage, setLanguage, t } from '../src/i18n';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

describe('i18n', () => {
  it('Chinese translates every text, with the same placeholders', () => {
    const zh = _all.translations.zh;
    const missing = Object.keys(_all.en).filter(k => !(k in zh));
    expect(missing).toEqual([]);
    for (const [k, v] of Object.entries(zh)) {
      expect(k in _all.en, `unknown key ${k}`).toBe(true);
      expect(placeholders(v as string), k).toEqual(placeholders((_all.en as Record<string, string>)[k]));
    }
  });

  it('falls back to English and fills placeholders', () => {
    setLanguage('xx');
    const key = Object.keys(_all.en)[0] as keyof typeof _all.en;
    if (key) expect(t(key)).toBe(_all.en[key]);
    setLanguage('en');
  });

  it('follows the language Obsidian shows when none was chosen (the system language)', () => {
    const g = globalThis as { window?: unknown };
    const store = (lang: string | null) => ({ getItem: (k: string) => (k === 'language' ? lang : null) });
    try {
      g.window = { localStorage: store('zh'), document: { documentElement: { lang: 'en' } } };
      expect(obsidianLanguage()).toBe('zh');
      g.window = { localStorage: store(null), document: { documentElement: { lang: 'zh' } } };
      expect(obsidianLanguage()).toBe('zh');
      g.window = { localStorage: store(null), document: { documentElement: { lang: '' } } };
      expect(obsidianLanguage()).toBe('en');
    } finally {
      delete g.window;
    }
  });
});
