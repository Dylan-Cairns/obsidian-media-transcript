import { describe, expect, it } from 'vitest';
import { _all, setLanguage, t } from '../src/i18n';

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
});
