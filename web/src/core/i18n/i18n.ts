/**
 * Tiny i18n layer. English is the reference table; th/zh must define the
 * exact same key set (enforced by tests/i18n.test.ts). Unknown keys fall
 * back to English, then to the key itself.
 */
import en from './en.json';
import th from './th.json';
import zh from './zh.json';

export type Locale = 'en' | 'th' | 'zh';

/** All message keys, derived from the English reference table. */
export type MessageKey = keyof typeof en;

export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'th', 'zh'] as const;

export const MESSAGE_TABLES: Record<Locale, Record<string, string>> = { en, th, zh };

export type Translator = (key: MessageKey | string) => string;

/** Create a lookup function bound to a locale (default 'en'). */
export function createTranslator(locale: Locale = 'en'): Translator {
  const table = MESSAGE_TABLES[locale] ?? MESSAGE_TABLES.en;
  return (key: MessageKey | string): string =>
    table[key] ?? MESSAGE_TABLES.en[key] ?? String(key);
}
