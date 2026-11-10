import { localizeDocument } from './i18n.js';
import { language } from './presentation.js';
import type { Language } from './presentation.js';

export type Theme = 'light' | 'dark';
export const THEME_STORAGE_KEY = 'avru.theme';
export const LOCALE_STORAGE_KEY = 'avru.locale';

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
type MatchMediaFn = (query: string) => {
  matches: boolean;
  addEventListener?: (
    type: 'change',
    listener: (event: { matches: boolean }) => void,
  ) => void;
  removeEventListener?: (
    type: 'change',
    listener: (event: { matches: boolean }) => void,
  ) => void;
};
type ThemeDocument = {
  documentElement?: { dataset: Record<string, string> };
};

const OTHER_THEME: Record<Theme, Theme> = { light: 'dark', dark: 'light' };
const OTHER_LANGUAGE: Record<Language, Language> = { zh: 'en', en: 'zh' };

export function otherTheme(theme: Theme): Theme {
  return OTHER_THEME[theme];
}

export function otherLanguage(locale: Language): Language {
  return OTHER_LANGUAGE[locale];
}

export function preferenceStorage(): PreferenceStorage | undefined {
  try {
    const storage = (globalThis as { localStorage?: PreferenceStorage })
      .localStorage;
    return storage ?? undefined;
  } catch {
    return undefined;
  }
}

export function readStoredTheme(
  storage: PreferenceStorage | undefined,
): Theme | null {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

export function readStoredLocale(
  storage: PreferenceStorage | undefined,
): Language | null {
  try {
    const value = storage?.getItem(LOCALE_STORAGE_KEY);
    return value === 'zh' || value === 'en' ? value : null;
  } catch {
    return null;
  }
}

export function systemPrefersDark(): boolean {
  try {
    const matchMedia = (globalThis as { matchMedia?: MatchMediaFn }).matchMedia;
    return matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  } catch {
    return false;
  }
}

export function resolveTheme(
  stored: Theme | null,
  prefersDark: boolean,
): Theme {
  return stored ?? (prefersDark ? 'dark' : 'light');
}

export function resolveLocale(
  stored: Language | null,
  preferred: string,
): Language {
  return stored ?? language(preferred);
}

export function initialTheme(): Theme {
  return resolveTheme(
    readStoredTheme(preferenceStorage()),
    systemPrefersDark(),
  );
}

/** Follow live OS theme changes until a stored manual choice takes precedence. */
export function watchSystemTheme(onChange: (theme: Theme) => void): () => void {
  try {
    const media = (globalThis as { matchMedia?: MatchMediaFn }).matchMedia?.(
      '(prefers-color-scheme: dark)',
    );
    const listener = (event: { matches: boolean }) => {
      if (readStoredTheme(preferenceStorage()) === null)
        onChange(event.matches ? 'dark' : 'light');
    };
    media?.addEventListener?.('change', listener);
    return () => media?.removeEventListener?.('change', listener);
  } catch {
    return () => {};
  }
}

export function initialLocale(preferred: string): Language {
  return resolveLocale(readStoredLocale(preferenceStorage()), preferred);
}

export function persistTheme(theme: Theme): void {
  try {
    preferenceStorage()?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // A denied store must not break the switch itself.
  }
}

export function persistLocale(locale: Language): void {
  try {
    preferenceStorage()?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // A denied store must not break the switch itself.
  }
}

export function applyThemePreference(theme: Theme): void {
  const element = (globalThis as { document?: ThemeDocument }).document
    ?.documentElement;
  if (element) element.dataset.theme = theme;
}

export function applyLocalePreference(locale: Language): void {
  const target = (globalThis as { document?: Document }).document;
  if (target) localizeDocument(target, locale);
}
