import { isValidElement } from 'react';
import type * as React from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  Install,
  installBrowserStatus,
  installFilesStatus,
  installVersionStatus,
} from '../src/Install.js';
import type { BrowserProfile, ExtensionFiles } from '../src/controller.js';
const setState = vi.fn();
let selectedStep: number | undefined;
let selectedBrowser: 'Chrome' | 'Edge' | undefined;
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useState: (initial: unknown) => [
    typeof initial === 'number'
      ? (selectedStep ?? initial)
      : initial === 'Chrome'
        ? (selectedBrowser ?? initial)
        : initial,
    setState,
  ],
  useEffect: (effect: () => () => void) => {
    effect()();
  },
}));
function clickButtons(node: ReactNode): void {
  if (Array.isArray(node)) {
    node.forEach(clickButtons);
    return;
  }
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node))
    return;
  if (typeof node.type === 'function') {
    clickButtons((node.type as (props: unknown) => ReactNode)(node.props));
    return;
  }
  node.props.onClick?.();
  clickButtons(node.props.children);
}
beforeEach(() => {
  setState.mockClear();
  selectedStep = undefined;
  selectedBrowser = undefined;
});
afterEach(() => {
  vi.unstubAllGlobals();
});
const files: ExtensionFiles = {
  directory: '/custom/Avru/dev/extension',
  version: '0.0.1',
  extensionId: 'cbjgomelhiahmdadpkeijpbkldblanei',
};
const metadata = {
  browserName: 'Chrome',
  browserVersion: '150.0.1',
  versionSource: 'clientHints',
  extensionVersion: '0.0.1',
} as const;
const connected: BrowserProfile = {
  id: 'a',
  name: 'Chrome',
  connected: true,
  connectionId: 'c',
  tabs: [],
  metadata,
};
const offline: BrowserProfile = {
  id: 'b',
  name: 'Offline',
  connected: false,
  connectionId: null,
  tabs: [],
};
it('derives checklist states from polled data without inferring absence', () => {
  expect(installFilesStatus(null)).toBe('unknown');
  expect(installFilesStatus(undefined)).toBe('unknown');
  expect(installFilesStatus(files)).toBe('ready');
  expect(installBrowserStatus([])).toEqual({ status: 'unknown', name: null });
  expect(installBrowserStatus([offline])).toEqual({
    status: 'unknown',
    name: null,
  });
  expect(installBrowserStatus([connected])).toEqual({
    status: 'connected',
    name: 'Chrome',
  });
  expect(
    installBrowserStatus([
      {
        ...connected,
        metadata: { ...metadata, browserName: 'Unknown' },
      },
    ]),
  ).toEqual({ status: 'connected', name: 'Unknown' });
  expect(installBrowserStatus([{ ...connected, metadata: null }])).toEqual({
    status: 'connected',
    name: null,
  });
  expect(installVersionStatus([], '0.0.1')).toEqual({
    status: 'unknown',
    actual: undefined,
  });
  expect(installVersionStatus([connected], undefined)).toEqual({
    status: 'unknown',
    actual: '0.0.1',
  });
  expect(installVersionStatus([connected], '0.0.1')).toEqual({
    status: 'ready',
    actual: '0.0.1',
  });
  expect(
    installVersionStatus(
      [{ ...connected, metadata: { ...metadata, extensionVersion: '0.0.2' } }],
      '0.0.1',
    ),
  ).toEqual({ status: 'unknown', actual: '0.0.2' });
  expect(installVersionStatus([offline], '0.0.1')).toEqual({
    status: 'unknown',
    actual: undefined,
  });
});
it('renders unknown steps without claiming anything is missing', () => {
  for (const locale of ['zh', 'en'] as const) {
    const first = renderToStaticMarkup(Install({ locale, next: vi.fn() }));
    expect(first).toContain('chrome://extensions');
    expect(first).toContain('edge://extensions');
    expect(first).toContain(
      locale === 'zh' ? '打开扩展管理页' : 'Open the extensions page',
    );
    selectedStep = 2;
    const final = renderToStaticMarkup(Install({ locale, next: vi.fn() }));
    expect(final).toContain(
      locale === 'zh' ? '已连接浏览器：未知' : 'Connected browser: Unknown',
    );
    expect(final).toContain(
      locale === 'zh'
        ? '扩展版本：未知，期望版本：未知'
        : 'Extension version: Unknown; expected: Unknown',
    );
    expect(final).not.toContain(
      locale === 'zh' ? '未检测到已准备' : 'No prepared extension',
    );
    expect(first).not.toContain('Chromium');
    selectedStep = undefined;
  }
});
it('advances the checklist from live state and shows versions as data', () => {
  selectedStep = 1;
  const prepared = renderToStaticMarkup(
    Install({
      locale: 'zh',
      files,
      browsers: [connected],
      expectedExtensionVersion: '0.0.1',
      next: vi.fn(),
    }),
  );
  expect(prepared).toContain(files.directory);
  expect(prepared).toContain('已准备');
  expect(prepared).not.toContain('已连接浏览器');
  selectedStep = 2;
  const html = renderToStaticMarkup(
    Install({
      locale: 'zh',
      files,
      browsers: [connected],
      expectedExtensionVersion: '0.0.1',
      next: vi.fn(),
    }),
  );
  expect(html).toContain('已连接');
  expect(html).toContain('已连接浏览器：Chrome');
  expect(html).toContain('扩展版本：0.0.1，期望版本：0.0.1');
  const mismatched = renderToStaticMarkup(
    Install({
      locale: 'en',
      files,
      browsers: [
        {
          ...connected,
          metadata: { ...metadata, extensionVersion: '0.0.2' },
        },
      ],
      expectedExtensionVersion: '0.0.1',
      next: vi.fn(),
    }),
  );
  expect(mismatched).toContain('Extension version: 0.0.2; expected: 0.0.1');
  expect(mismatched).toContain('Unknown');
});
it('copies manager addresses and reports copy failure without opening', async () => {
  clickButtons(Install({ locale: 'zh', next: vi.fn() }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(setState).toHaveBeenCalledWith(true);
  vi.stubGlobal('navigator', {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  setState.mockClear();
  clickButtons(Install({ locale: 'zh', next: vi.fn() }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(setState).toHaveBeenCalledWith('chrome://extensions/');
  selectedBrowser = 'Edge';
  setState.mockClear();
  clickButtons(Install({ locale: 'zh', next: vi.fn() }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(setState).toHaveBeenCalledWith('edge://extensions/');
});
it('scrolls to the version area only when an anchor and target exist', () => {
  const scrollIntoView = vi.fn();
  vi.stubGlobal('document', {
    getElementById: (id: string) =>
      id === 'install-version' ? { scrollIntoView } : null,
  });
  renderToStaticMarkup(
    Install({ locale: 'zh', anchor: 'install-version', next: vi.fn() }),
  );
  expect(scrollIntoView).toHaveBeenCalledOnce();
  renderToStaticMarkup(
    Install({ locale: 'zh', anchor: 'install-missing', next: vi.fn() }),
  );
  expect(scrollIntoView).toHaveBeenCalledOnce();
  renderToStaticMarkup(Install({ locale: 'zh', next: vi.fn() }));
  expect(scrollIntoView).toHaveBeenCalledOnce();
});
