import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOCALE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  applyLocalePreference,
  applyThemePreference,
  initialLocale,
  initialTheme,
  otherLanguage,
  otherTheme,
  persistLocale,
  persistTheme,
  preferenceStorage,
  readStoredLocale,
  readStoredTheme,
  resolveLocale,
  resolveTheme,
  systemPrefersDark,
  watchSystemTheme,
} from '../src/preferences.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

interface MemoryStore {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  values: Map<string, string>;
}

function memoryStorage(initial: Record<string, string> = {}): MemoryStore {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

function stubStorage(store: Pick<MemoryStore, 'getItem' | 'setItem'>) {
  vi.stubGlobal('localStorage', store);
}

function stubMatchMedia(matches: boolean, onQuery?: (query: string) => void) {
  vi.stubGlobal('matchMedia', (query: string) => {
    onQuery?.(query);
    return { matches, media: query };
  });
}

function stubDocument() {
  const documentElement = {
    dataset: {} as Record<string, string>,
    lang: '',
  };
  const target = { title: '', documentElement };
  vi.stubGlobal('document', target);
  return target;
}

describe('resolveTheme', () => {
  it('prefers a stored theme over the system and follows the system otherwise', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme(null, false)).toBe('light');
  });
});

describe('resolveLocale', () => {
  it('prefers a stored locale over the browser language', () => {
    expect(resolveLocale('en', 'zh-CN')).toBe('en');
    expect(resolveLocale('zh', 'en-US')).toBe('zh');
    expect(resolveLocale(null, 'zh-TW')).toBe('zh');
    expect(resolveLocale(null, 'fr')).toBe('en');
  });
});

describe('otherTheme and otherLanguage', () => {
  it('returns the opposite choice in both directions', () => {
    expect(otherTheme('light')).toBe('dark');
    expect(otherTheme('dark')).toBe('light');
    expect(otherLanguage('zh')).toBe('en');
    expect(otherLanguage('en')).toBe('zh');
  });
});

describe('readStoredTheme and readStoredLocale', () => {
  it('accepts only known stored values', () => {
    expect(
      readStoredTheme(memoryStorage({ [THEME_STORAGE_KEY]: 'dark' })),
    ).toBe('dark');
    expect(
      readStoredTheme(memoryStorage({ [THEME_STORAGE_KEY]: 'blue' })),
    ).toBeNull();
    expect(readStoredTheme(memoryStorage())).toBeNull();
    expect(readStoredTheme(undefined)).toBeNull();
    expect(
      readStoredLocale(memoryStorage({ [LOCALE_STORAGE_KEY]: 'zh' })),
    ).toBe('zh');
    expect(
      readStoredLocale(memoryStorage({ [LOCALE_STORAGE_KEY]: 'fr' })),
    ).toBeNull();
    expect(readStoredLocale(undefined)).toBeNull();
  });
  it('treats an unreadable store as no stored preference', () => {
    const failing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {},
    };
    expect(readStoredTheme(failing)).toBeNull();
    expect(readStoredLocale(failing)).toBeNull();
  });
});

describe('systemPrefersDark', () => {
  it('asks the system media query and follows its answer', () => {
    const queries: string[] = [];
    stubMatchMedia(true, (query) => {
      queries.push(query);
    });
    expect(systemPrefersDark()).toBe(true);
    expect(queries).toEqual(['(prefers-color-scheme: dark)']);
    stubMatchMedia(false);
    expect(systemPrefersDark()).toBe(false);
  });
  it('falls back to light without matchMedia or when it throws', () => {
    expect(systemPrefersDark()).toBe(false);
    vi.stubGlobal('matchMedia', () => {
      throw new Error('denied');
    });
    expect(systemPrefersDark()).toBe(false);
  });
});

describe('watchSystemTheme', () => {
  it('reacts to media changes but preserves a manual theme', () => {
    const store = memoryStorage();
    stubStorage(store);
    let listener: ((event: { matches: boolean }) => void) | undefined;
    const remove = vi.fn();
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: (
        _type: string,
        callback: (event: { matches: boolean }) => void,
      ) => {
        listener = callback;
      },
      removeEventListener: remove,
    }));
    const onChange = vi.fn();
    const cleanup = watchSystemTheme(onChange);
    listener?.({ matches: false });
    expect(onChange).toHaveBeenCalledWith('light');
    persistTheme('dark');
    listener?.({ matches: false });
    expect(onChange).toHaveBeenCalledTimes(1);
    cleanup();
    expect(remove).toHaveBeenCalledOnce();
  });
  it('ignores absent or unavailable media APIs', () => {
    expect(() => {
      watchSystemTheme(vi.fn())();
    }).not.toThrow();
    vi.stubGlobal('matchMedia', () => {
      throw new Error('unavailable');
    });
    expect(() => {
      watchSystemTheme(vi.fn())();
    }).not.toThrow();
  });
});

describe('preferenceStorage', () => {
  it('returns the browser store when present and undefined otherwise', () => {
    expect(preferenceStorage()).toBeUndefined();
    const store = memoryStorage();
    stubStorage(store);
    expect(preferenceStorage()).toBe(store);
  });
  it('returns undefined when reading the store throws', () => {
    const original = Object.getOwnPropertyDescriptor(
      globalThis,
      'localStorage',
    );
    try {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get() {
          throw new Error('denied');
        },
      });
      expect(preferenceStorage()).toBeUndefined();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
});

describe('persistTheme and persistLocale', () => {
  it('writes the choice to the store', () => {
    const store = memoryStorage();
    stubStorage(store);
    persistTheme('dark');
    persistLocale('en');
    expect(store.values.get(THEME_STORAGE_KEY)).toBe('dark');
    expect(store.values.get(LOCALE_STORAGE_KEY)).toBe('en');
  });
  it('never throws without a store or when the store refuses the write', () => {
    expect(() => {
      persistTheme('dark');
    }).not.toThrow();
    expect(() => {
      persistLocale('zh');
    }).not.toThrow();
    const failing = {
      getItem: () => null,
      setItem: () => {
        throw new Error('denied');
      },
    };
    stubStorage(failing);
    expect(() => {
      persistTheme('light');
    }).not.toThrow();
    expect(() => {
      persistLocale('en');
    }).not.toThrow();
  });
});

describe('initialTheme', () => {
  it('uses a stored theme before the system and follows the system otherwise', () => {
    stubStorage(memoryStorage({ [THEME_STORAGE_KEY]: 'light' }));
    stubMatchMedia(true);
    expect(initialTheme()).toBe('light');
    stubStorage(memoryStorage({ [THEME_STORAGE_KEY]: 'dark' }));
    stubMatchMedia(false);
    expect(initialTheme()).toBe('dark');
    stubStorage(memoryStorage());
    stubMatchMedia(true);
    expect(initialTheme()).toBe('dark');
    stubMatchMedia(false);
    expect(initialTheme()).toBe('light');
  });
});

describe('initialLocale', () => {
  it('uses a stored locale before the browser language', () => {
    stubStorage(memoryStorage({ [LOCALE_STORAGE_KEY]: 'en' }));
    expect(initialLocale('zh-CN')).toBe('en');
    stubStorage(memoryStorage());
    expect(initialLocale('zh-TW')).toBe('zh');
    expect(initialLocale('de')).toBe('en');
  });
});

describe('applyThemePreference', () => {
  it('marks the document root with the selected theme', () => {
    const target = stubDocument();
    applyThemePreference('dark');
    expect(target.documentElement.dataset.theme).toBe('dark');
    applyThemePreference('light');
    expect(target.documentElement.dataset.theme).toBe('light');
  });
  it('does nothing without a document', () => {
    expect(() => {
      applyThemePreference('dark');
    }).not.toThrow();
  });
});

describe('applyLocalePreference', () => {
  it('follows the selected language for lang and title', () => {
    const target = stubDocument();
    applyLocalePreference('zh');
    expect(target.documentElement.lang).toBe('zh');
    expect(target.title).toBe('Avru · 本机浏览器工作台');
    applyLocalePreference('en');
    expect(target.documentElement.lang).toBe('en');
    expect(target.title).toBe('Avru · Local browser workspace');
  });
  it('does nothing without a document', () => {
    expect(() => {
      applyLocalePreference('en');
    }).not.toThrow();
  });
});
