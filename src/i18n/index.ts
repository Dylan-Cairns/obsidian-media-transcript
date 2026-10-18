import core from './locales/core';
import library from './locales/library';
import attention from './locales/attention';
import modules from './locales/modules';

/**
 * The plugin's text in the language Obsidian is set to (Settings → General →
 * Language). English is the default and the fallback for any text not
 * translated. Obsidian restarts when its language changes, so the language is
 * read once, at load.
 */

const en = { ...core.en, ...library.en, ...attention.en, ...modules.en };
export type TextKey = keyof typeof en;

const translations: Record<string, Partial<Record<TextKey, string>>> = {
  zh: { ...core.zh, ...library.zh, ...attention.zh, ...modules.zh },
};

/** Obsidian keeps its interface language in local storage ("zh", "zh-TW", "de"…; none = English). */
export function obsidianLanguage(): string {
  try {
    if (typeof window === 'undefined') return 'en';
    // Chosen in Settings → General. Unset, Obsidian follows the system's
    // language (as on a phone never switched), which it puts on the page.
    return window.localStorage?.getItem('language') || window.document?.documentElement?.lang || 'en';
  } catch {
    return 'en';
  }
}

let table: Partial<Record<TextKey, string>> | null = null;

function current(): Partial<Record<TextKey, string>> {
  if (table === null) table = translations[obsidianLanguage()] ?? {};
  return table;
}

/** For tests: use this language from now on. */
export function setLanguage(lang: string): void {
  table = translations[lang] ?? {};
}

/** The text for `key`, with `{name}` placeholders filled from `vars`. */
export function t(key: TextKey, vars?: Record<string, string | number>): string {
  const text = current()[key] ?? en[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** Every language's keys and placeholders, for the completeness test. */
export const _all = { en, translations };
