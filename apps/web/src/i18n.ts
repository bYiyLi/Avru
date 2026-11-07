import { en } from './locales/en.js';
import { zh } from './locales/zh.js';
import type { Language } from './presentation.js';
import type { MessageArguments, MessageKey } from './i18n-types.js';
export const catalogs = { en, zh };
export function translate<Key extends MessageKey>(
  locale: Language,
  key: Key,
  ...args: MessageArguments<Key>
): string {
  const values: Record<string, string | number> = args[0] ?? {};
  return catalogs[locale][key].replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined)
      throw new Error(`Missing message parameter: ${name}`);
    return typeof value === 'number' ? number(locale, value) : value;
  });
}
export function number(locale: Language, value: number, digits = 0) {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}
export function timestamp(locale: Language, value: number) {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    timeZone: 'UTC',
    hourCycle: 'h23',
  }).format(value);
}
export function tabCount(locale: Language, count: number) {
  const category = new Intl.PluralRules(locale).select(count);
  return translate(
    locale,
    category === 'one' ? 'browser.tabs.one' : 'browser.tabs.other',
    { count },
  );
}
export function localizeDocument(
  target: Pick<Document, 'title' | 'documentElement'>,
  locale: Language,
) {
  target.documentElement.lang = locale;
  target.title = translate(locale, 'shell.title');
}
