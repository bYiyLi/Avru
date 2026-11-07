import { text } from './i18n';
import type { Locale } from './i18n';
export function localizePopup(root: Document, locale: Locale): void {
  root.documentElement.lang = locale;
  root.title = text(locale, 'popup.title');
  for (const [selector, key] of [
    ['#status', 'popup.checking'],
    ['#description', 'popup.description'],
    ['#endpoint-label', 'popup.endpoint'],
    ['#name-label', 'popup.name'],
    ['#pairing-help', 'popup.pairingHelp'],
    ['#pair', 'popup.pair'],
    ['#disconnect', 'popup.disconnect'],
    ['#revoke-help', 'popup.revokeHelp'],
  ] as const) {
    const element = root.querySelector(selector);
    if (element) element.textContent = text(locale, key);
  }
  const name = root.querySelector<HTMLInputElement>('[name=name]');
  if (name) name.placeholder = text(locale, 'popup.namePlaceholder');
}
