import { en } from '../locales/en';
import type { MessageKey } from '../locales/en';
import { zh } from '../locales/zh';
export type Locale = 'zh' | 'en';
export function localeFor(language: string): Locale {
  return language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
export function text(
  locale: Locale,
  key: Exclude<MessageKey, 'status.pairing'>,
): string {
  return (locale === 'zh' ? zh : en)[key];
}
export function pairingText(locale: Locale, code: string): string {
  return (locale === 'zh' ? zh : en)['status.pairing'].replace(
    '{code}',
    () => code,
  );
}
