import { isValidElement } from 'react';
import type * as React from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { createController } from '../src/controller.js';
import type { ViewState } from '../src/controller.js';

let page = 'welcome';
const setPage = vi.fn();
beforeEach(() => {
  vi.stubGlobal('location', { hash: '' });
});
afterEach(() => {
  vi.unstubAllGlobals();
});
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useState: (initial: string | (() => string)) => [
    typeof initial === 'function' ? page : initial,
    setPage,
  ],
  useEffect: (effect: () => () => void) => {
    effect()();
  },
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => ViewState) =>
    snapshot(),
}));
function textOf(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node))
    return textOf(node.props.children);
  return '';
}
interface CollectedButton {
  text: string;
  onClick: () => void;
}
function collectButtons(node: ReactNode): CollectedButton[] {
  const found: CollectedButton[] = [];
  const visit = (current: ReactNode): void => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (
      !isValidElement<{ children?: ReactNode; onClick?: () => void }>(current)
    )
      return;
    if (typeof current.type === 'function') {
      visit((current.type as (props: unknown) => ReactNode)(current.props));
      return;
    }
    if (current.type === 'button' && current.props.onClick) {
      found.push({
        text: textOf(current.props.children),
        onClick: current.props.onClick,
      });
    }
    visit(current.props.children);
  };
  visit(node);
  return found;
}
function memoryLocalStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
function stubPreferencesDocument() {
  const documentElement = {
    dataset: {} as Record<string, string>,
    lang: '',
  };
  const target = { title: '', documentElement };
  vi.stubGlobal('document', target);
  return target;
}

it('follows the system theme by default and honors a stored theme', () => {
  const controller = createController({ key: null, clear: vi.fn() });
  const target = stubPreferencesDocument();
  const stored = memoryLocalStorage();
  vi.stubGlobal('localStorage', stored);
  page = 'welcome';
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const dark = App({ controller, preferredLanguage: 'en' });
  expect(target.documentElement.dataset.theme).toBe('dark');
  expect(renderToStaticMarkup(dark)).toContain('Switch to light theme');
  expect(stored.values.has('avru.theme')).toBe(false);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const light = App({ controller, preferredLanguage: 'en' });
  expect(target.documentElement.dataset.theme).toBe('light');
  expect(renderToStaticMarkup(light)).toContain('Switch to dark theme');
  expect(stored.values.has('avru.theme')).toBe(false);
  stored.values.set('avru.theme', 'dark');
  App({ controller, preferredLanguage: 'en' });
  expect(target.documentElement.dataset.theme).toBe('dark');
  stored.values.set('avru.theme', 'light');
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  App({ controller, preferredLanguage: 'en' });
  expect(target.documentElement.dataset.theme).toBe('light');
  stored.values.set('avru.theme', 'blue');
  App({ controller, preferredLanguage: 'en' });
  expect(target.documentElement.dataset.theme).toBe('dark');
});

it('uses a stored language before the browser language', () => {
  const controller = createController({ key: null, clear: vi.fn() });
  const target = stubPreferencesDocument();
  vi.stubGlobal('localStorage', memoryLocalStorage({ 'avru.locale': 'en' }));
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  page = 'welcome';
  const view = App({ controller, preferredLanguage: 'zh-CN' });
  expect(renderToStaticMarkup(view)).toContain('Enter Avru');
  expect(renderToStaticMarkup(view)).not.toContain('进入 Avru');
  expect(target.documentElement.lang).toBe('en');
});

it('switches theme and language from the header and persists the choice', () => {
  const controller = createController({ key: null, clear: vi.fn() });
  const target = stubPreferencesDocument();
  const stored = memoryLocalStorage();
  vi.stubGlobal('localStorage', stored);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  page = 'welcome';
  setPage.mockClear();
  const first = App({ controller, preferredLanguage: 'zh' });
  expect(target.documentElement.dataset.theme).toBe('light');
  expect(target.documentElement.lang).toBe('zh');
  expect(target.title).toBe('Avru · 本机浏览器工作台');
  expect(renderToStaticMarkup(first)).toContain('进入 Avru');
  const themeButton = collectButtons(first).find(
    (button) => button.text === '切换到深色主题',
  );
  expect(themeButton).toBeDefined();
  themeButton?.onClick();
  expect(stored.values.get('avru.theme')).toBe('dark');
  expect(target.documentElement.dataset.theme).toBe('dark');
  expect(setPage).toHaveBeenCalledWith('dark');
  const second = App({ controller, preferredLanguage: 'zh' });
  expect(renderToStaticMarkup(second)).toContain('切换到浅色主题');
  const languageButton = collectButtons(second).find(
    (button) => button.text === 'English',
  );
  expect(languageButton).toBeDefined();
  languageButton?.onClick();
  expect(stored.values.get('avru.locale')).toBe('en');
  expect(target.documentElement.lang).toBe('en');
  expect(target.title).toBe('Avru · Local browser workspace');
  const third = App({ controller, preferredLanguage: 'zh' });
  expect(renderToStaticMarkup(third)).toContain('Enter Avru');
  expect(renderToStaticMarkup(third)).toContain('Switch to light theme');
  const backButton = collectButtons(third).find(
    (button) => button.text === '中文',
  );
  expect(backButton).toBeDefined();
  backButton?.onClick();
  expect(stored.values.get('avru.locale')).toBe('zh');
  expect(target.documentElement.lang).toBe('zh');
});
