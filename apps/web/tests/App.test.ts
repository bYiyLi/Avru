import { createElement, isValidElement } from 'react';
import type * as React from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { App, Dashboard } from '../src/App.js';
import { Welcome } from '../src/Welcome.js';
import { Install } from '../src/Install.js';
import { createController } from '../src/controller.js';
import type { ViewState } from '../src/controller.js';
import { browserGuide, language, versionStatus } from '../src/presentation.js';
let page = 'welcome';
const setPage = vi.fn();
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useState: () => [page, setPage],
  useEffect: (effect: () => () => void) => {
    effect()();
  },
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => ViewState) =>
    snapshot(),
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
const profile = {
  id: 'a',
  name: '<script>alert(1)</script>',
  connected: true,
  connectionId: 'c',
  tabs: [{ id: 1, title: 'Tab', url: 'https://example.com' }],
};
const system = {
  daemonVersion: '0.1.0-dev.1',
  expectedExtensionVersion: '0.0.1',
  mcp: 'notImplemented',
  chatgpt: 'notImplemented',
  frpc: 'notImplemented',
} as const;
const state: ViewState = {
  system,
  authorized: true,
  busy: false,
  message: '',
  pairings: [
    {
      id: 'p',
      name: 'Chrome',
      code: '123456',
      origin: 'chrome-extension://test',
      expiresAt: 1000,
    },
  ],
  browsers: [
    profile,
    {
      id: 'b',
      name: 'Offline',
      connected: false,
      connectionId: null,
      tabs: [{ id: 2, title: 'STALE', url: 'https://secret.test' }],
    },
  ],
};

it('selects only supported guide and system language without asserting extension installation', () => {
  expect(language('zh-TW')).toBe('zh');
  expect(language('de')).toBe('en');
  expect(browserGuide('Edg/100 Chrome/100').address).toBe('edge://extensions');
  expect(browserGuide('Chrome/100').address).toBe('chrome://extensions');
  expect(browserGuide('Firefox')).toEqual({ name: 'Chromium', address: '' });
  expect(versionStatus()).toBe('unknown');
  expect(versionStatus('1')).toBe('unknown');
  expect(versionStatus('1', '1')).toBe('match');
  expect(versionStatus('1', '2')).toBe('mismatch');
});
it('renders welcome and honest local installation guidance in both languages', () => {
  const next = vi.fn();
  for (const locale of ['zh', 'en'] as const) {
    const welcome = Welcome({ locale, next });
    clickButtons(welcome);
    expect(renderToStaticMarkup(welcome)).toContain('Avru');
    for (const agent of ['Chrome/100', 'Edg/100', 'unknown']) {
      const install = Install({ locale, agent, next });
      clickButtons(install);
      const html = renderToStaticMarkup(install);
      expect(html).toContain('chrome-mv3');
      expect(html).toContain('npx');
    }
  }
  expect(next).toHaveBeenCalledTimes(8);
});
it('renders real pairing and version states, hides stale tabs and never invents MCP calls', () => {
  const approve = vi.fn();
  const reject = vi.fn();
  const revoke = vi.fn();
  for (const locale of ['zh', 'en'] as const) {
    const view = Dashboard({ state, locale, approve, reject, revoke });
    const html = renderToStaticMarkup(view);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('123456');
    expect(html).toContain('https://example.com');
    expect(html).not.toContain('STALE');
    expect(html).not.toContain('<a');
    clickButtons(view);
  }
  expect(approve).toHaveBeenCalledWith('p');
  expect(reject).toHaveBeenCalledWith('p');
  expect(revoke).toHaveBeenCalledTimes(4);
  const metadata = {
    browserName: 'Chrome',
    browserVersion: '150.0.1',
    versionSource: 'clientHints',
    extensionVersion: '0.0.1',
  } as const;
  for (const version of ['0.0.1', '0.0.2']) {
    const html = renderToStaticMarkup(
      createElement(Dashboard, {
        state: {
          ...state,
          system,
          browsers: [
            {
              ...profile,
              metadata: {
                ...metadata,
                extensionVersion: version,
                versionSource: 'userAgent',
              },
            },
          ],
        },
        approve,
        reject,
        revoke,
      }),
    );
    expect(html).toContain('150.0.1');
    expect(html).toContain(version);
    expect(html).toContain('期望');
  }
  expect(
    renderToStaticMarkup(
      createElement(Dashboard, {
        state: { ...state, browsers: [], pairings: [], busy: true },
        approve,
        reject,
        revoke,
      }),
    ),
  ).toContain('尚未连接浏览器');
});
it('starts and stops controller, preserves welcome entry and routes without pretending current browser detection', () => {
  const controller = createController({ key: null, clear: vi.fn() });
  const start = vi.spyOn(controller, 'start');
  const stop = vi.spyOn(controller, 'stop');
  page = 'welcome';
  const first = App({
    controller,
    preferredLanguage: 'zh-CN',
    agent: 'Chrome/100',
  });
  expect(renderToStaticMarkup(first)).toContain('请重新打开');
  expect(start).toHaveBeenCalled();
  expect(stop).toHaveBeenCalled();
  clickButtons(first);
  expect(setPage).toHaveBeenCalledWith('install');
  expect(setPage).toHaveBeenCalledWith('overview');
  const authorized = {
    ...controller,
    snapshot: () => ({ ...state, message: 'error' }),
  };
  for (const selected of ['install', 'overview']) {
    page = selected;
    for (const preferredLanguage of ['zh', 'en']) {
      const view = App({
        controller: authorized,
        preferredLanguage,
        agent: 'Chrome/100',
      });
      expect(renderToStaticMarkup(view)).toContain('123456');
      clickButtons(view);
    }
  }
  page = 'overview';
  expect(renderToStaticMarkup(App({ controller }))).not.toContain('123456');
});

function metadataView(
  locale: 'zh' | 'en',
  browser: typeof profile & {
    metadata: {
      browserName: string;
      browserVersion: string;
      versionSource: 'unknown' | 'userAgent' | 'clientHints';
      extensionVersion: string;
    };
  },
) {
  return renderToStaticMarkup(
    createElement(Dashboard, {
      approve: vi.fn(),
      reject: vi.fn(),
      revoke: vi.fn(),
      locale,
      state: { ...state, pairings: [], system, browsers: [browser] },
    }),
  );
}
it('localizes unknown metadata and accurately labels client hints', () => {
  for (const locale of ['zh', 'en'] as const) {
    const unknown = metadataView(locale, {
      ...profile,
      metadata: {
        browserName: 'Unknown',
        browserVersion: 'Unknown',
        versionSource: 'unknown',
        extensionVersion: '0.0.1',
      },
    });
    expect(unknown).toContain(
      locale === 'zh' ? '未取得版本信息' : 'Version information unavailable',
    );
    if (locale === 'zh') expect(unknown).not.toContain('Unknown');
    const known = metadataView(locale, {
      ...profile,
      metadata: {
        browserName: 'Microsoft Edge',
        browserVersion: '150.1',
        versionSource: 'clientHints',
        extensionVersion: '0.0.1',
      },
    });
    expect(known).toContain('Microsoft Edge');
    expect(known).toContain('150.1');
  }
});
it('keeps offline metadata unknown even if a stale value is supplied', () => {
  for (const locale of ['zh', 'en'] as const) {
    const html = metadataView(locale, {
      ...profile,
      connected: false,
      metadata: {
        browserName: 'StaleBrowser',
        browserVersion: '140.1',
        versionSource: 'userAgent',
        extensionVersion: '0.0.1',
      },
    });
    expect(html).not.toContain('StaleBrowser');
    expect(html).not.toContain('140.1');
    expect(html).toContain(locale === 'zh' ? '未知' : 'Unknown');
  }
});

it('distinguishes unavailable browser state from a verified empty list', () => {
  for (const locale of ['zh', 'en'] as const) {
    const html = renderToStaticMarkup(
      createElement(Dashboard, {
        approve: vi.fn(),
        reject: vi.fn(),
        revoke: vi.fn(),
        locale,
        state: { ...state, system: null, browsers: [], pairings: [] },
      }),
    );
    expect(html).not.toContain('0 / 0');
    expect(html).toContain(
      locale === 'zh'
        ? '暂无法取得浏览器状态'
        : 'Browser status is unavailable',
    );
    expect(html).not.toContain(
      locale === 'zh' ? '尚未连接浏览器' : 'No paired browsers',
    );
    expect(html).toContain(
      locale === 'zh' ? '状态未确认' : 'Status not confirmed',
    );
  }
});
