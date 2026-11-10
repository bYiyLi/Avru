import { createElement, isValidElement } from 'react';
import type * as React from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App, Dashboard } from '../src/App.js';
import { BrowsersPage } from '../src/Browsers.js';
import { Welcome } from '../src/Welcome.js';
import { Install } from '../src/Install.js';
import { createController } from '../src/controller.js';
import type { ViewState } from '../src/controller.js';
import { language, versionStatus } from '../src/presentation.js';
let page = 'welcome';
let initialPage = '';
beforeEach(() => {
  vi.stubGlobal('location', { hash: '' });
});
afterEach(() => {
  vi.unstubAllGlobals();
});
const setPage = vi.fn();
const openLogs = vi.fn();
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useState: (initial: string | (() => string)) => {
    if (typeof initial === 'function') initialPage = initial();
    return [typeof initial === 'function' ? page : initial, setPage];
  },
  useEffect: (effect: () => unknown) => {
    const cleanup = effect();
    if (typeof cleanup === 'function') (cleanup as () => void)();
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

it('opens the explicit toolbar route directly while plain entry retains welcome', () => {
  const controller = createController({ key: null, clear: vi.fn() });
  page = 'welcome';
  App({ controller, preferredLanguage: 'zh' });
  expect(initialPage).toBe('welcome');
  vi.stubGlobal('location', { hash: '#overview' });
  App({ controller, preferredLanguage: 'zh' });
  expect(initialPage).toBe('overview');
});
it('selects system language and compares reported versions', () => {
  expect(language('zh-TW')).toBe('zh');
  expect(language('de')).toBe('en');
  expect(versionStatus()).toBe('unknown');
  expect(versionStatus('1')).toBe('unknown');
  expect(versionStatus('1', '1')).toBe('match');
  expect(versionStatus('1', '2')).toBe('mismatch');
});
it('renders welcome and honest local installation guidance in both languages', () => {
  const next = vi.fn();
  for (const locale of ['zh', 'en'] as const) {
    const welcome = Welcome({
      locale,
      next,
      history: null,
      onOpenLogs: openLogs,
    });
    clickButtons(welcome);
    expect(renderToStaticMarkup(welcome)).toContain('Avru');
    for (let repeat = 0; repeat < 3; repeat++) {
      const install = Install({ locale, next });
      clickButtons(install);
      const html = renderToStaticMarkup(install);
      expect(html).toContain(
        locale === 'zh'
          ? '选择安装指引对应的浏览器'
          : 'Choose the browser for these instructions',
      );
    }
  }
  expect(next).toHaveBeenCalledTimes(4);
});
it('renders the localized welcome story, trustworthy connection guidance and real-log entry', () => {
  for (const locale of ['zh', 'en'] as const) {
    const next = vi.fn();
    const onOpenLogs = vi.fn();
    const welcome = Welcome({
      locale,
      next,
      history: null,
      onOpenLogs,
    });
    const html = renderToStaticMarkup(welcome);
    expect(html).toContain('class="welcome-story"');
    expect(html).toContain('class="welcome-assurance"');
    expect(html).toContain('class="welcome-trust"');
    expect(html).toContain('class="welcome-start"');
    expect(html).toContain(
      locale === 'zh'
        ? '本机已连接，不等于远程可用或 AI 已获授权。'
        : 'A local connection does not mean remote access or AI authorization.',
    );
    expect(html).toContain(
      locale === 'zh' ? '调用记录暂不可用' : 'Call history unavailable',
    );
    expect(html).not.toContain('示例调用');
    clickButtons(welcome);
    expect(next).toHaveBeenCalledTimes(2);
    expect(onOpenLogs).toHaveBeenCalledTimes(2);
  }
});
it('renders real pairing and version states, hides stale tabs and never invents MCP calls', () => {
  for (const locale of ['zh', 'en'] as const) {
    const view = BrowsersPage({ state, locale, onAddBrowser: openLogs });
    const html = renderToStaticMarkup(view);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('123456');
    expect(html).toContain('https://example.com');
    expect(html).not.toContain('STALE');
    expect(html).not.toContain('<a');
    clickButtons(view);
  }
  const metadata = {
    browserName: 'Chrome',
    browserVersion: '150.0.1',
    versionSource: 'clientHints',
    extensionVersion: '0.0.1',
  } as const;
  for (const version of ['0.0.1', '0.0.2']) {
    const html = renderToStaticMarkup(
      createElement(BrowsersPage, {
        locale: 'zh',
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
        onAddBrowser: openLogs,
      }),
    );
    expect(html).toContain('150.0.1');
    expect(html).toContain(version);
    expect(html).toContain('期望');
  }
  expect(
    renderToStaticMarkup(
      createElement(BrowsersPage, {
        locale: 'zh',
        state: { ...state, browsers: [], pairings: [], busy: true },
        onAddBrowser: openLogs,
      }),
    ),
  ).toContain('暂无浏览器连接');
});
it('starts and stops controller, preserves welcome entry and routes without pretending current browser detection', () => {
  const controller = createController({ key: null, clear: vi.fn() });
  const start = vi.spyOn(controller, 'start');
  const stop = vi.spyOn(controller, 'stop');
  page = 'welcome';
  const first = App({
    controller,
    preferredLanguage: 'zh-CN',
  });
  expect(renderToStaticMarkup(first)).toContain('进入 Avru');
  expect(start).toHaveBeenCalled();
  expect(stop).toHaveBeenCalled();
  clickButtons(first);
  expect(setPage).toHaveBeenCalledWith('logs');
  expect(setPage).toHaveBeenCalledWith('overview');
  const authorized = {
    ...controller,
    snapshot: () => ({ ...state, message: 'request.failed' as const }),
  };
  for (const selected of ['install', 'overview']) {
    page = selected;
    for (const preferredLanguage of ['zh', 'en']) {
      const view = App({
        controller: authorized,
        preferredLanguage,
      });
      expect(renderToStaticMarkup(view)).not.toContain('123456');
      clickButtons(view);
    }
  }
  page = 'overview';
  expect(renderToStaticMarkup(App({ controller }))).not.toContain('123456');
});

it('shows navigation on the welcome page and routes to the logs page', () => {
  const controller = createController({ key: null, clear: vi.fn() });
  setPage.mockClear();
  page = 'welcome';
  const first = App({ controller, preferredLanguage: 'zh' });
  const html = renderToStaticMarkup(first);
  expect(html).toContain('日志');
  expect(html).toContain('安装扩展');
  clickButtons(first);
  expect(setPage).toHaveBeenCalledWith('logs');
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
    createElement(BrowsersPage, {
      locale,
      state: { ...state, pairings: [], system, browsers: [browser] },
      onAddBrowser: openLogs,
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
      createElement(BrowsersPage, {
        locale,
        state: { ...state, system: null, browsers: [], pairings: [] },
        onAddBrowser: openLogs,
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
    const overviewHtml = renderToStaticMarkup(
      createElement(Dashboard, {
        locale,
        state: { ...state, system: null, browsers: [], pairings: [] },
        onOpenLogs: openLogs,
      }),
    );
    expect(overviewHtml).toContain(
      locale === 'zh' ? '状态未确认' : 'Status not confirmed',
    );
  }
});

it('does not misidentify unsupported browsers as Chromium', () => {
  const next = vi.fn();
  for (let repeat = 0; repeat < 2; repeat++) {
    const chinese = renderToStaticMarkup(Install({ locale: 'zh', next }));
    const english = renderToStaticMarkup(Install({ locale: 'en', next }));
    expect(chinese).toContain('chrome://extensions');
    expect(english).toContain('edge://extensions');
    expect(chinese).not.toContain('Chromium');
    expect(english).not.toContain('Chromium');
  }
});

it('renders distinct localized errors instead of generic English or raw exceptions', () => {
  page = 'welcome';
  const controller = createController({ key: null, clear: vi.fn() });
  const messages = [
    ['session.expired', '会话已失效', 'Session expired'],
    ['request.failed', '请求失败', 'Request failed'],
    ['connection.retrying', '正在重试', 'Retrying'],
  ] as const;
  for (const [message, chinese, english] of messages) {
    for (const preferredLanguage of ['zh', 'en']) {
      const html = renderToStaticMarkup(
        App({
          controller: {
            ...controller,
            snapshot: () => ({ ...state, message }),
          },
          preferredLanguage,
        }),
      );
      expect(html).toContain(preferredLanguage === 'zh' ? chinese : english);
      expect(html).not.toContain(message);
    }
  }
});

it('shows the real prepared directory without claiming browser installation', () => {
  const files = {
    directory: '/custom/Avru/dev/extension',
    version: '0.0.1',
    extensionId: 'cbjgomelhiahmdadpkeijpbkldblanei',
  };
  for (const locale of ['zh', 'en'] as const) {
    const html = renderToStaticMarkup(
      Install({ locale, files, next: vi.fn() }),
    );
    expect(html).toContain(
      locale === 'zh' ? '准备加载扩展' : 'Prepare to load',
    );
    expect(html).toContain('edge://extensions');
    expect(html).toContain('chrome://extensions');
    expect(html).toContain(
      locale === 'zh'
        ? 'Avru 不会自动安装扩展'
        : 'Avru does not automatically install',
    );
    expect(html).not.toContain(
      locale === 'zh' ? '未检测到已准备' : 'No prepared extension',
    );
  }
});

it('renders the call history route and the unauthorized notice without inventing state', () => {
  const controller = createController({ key: null, clear: vi.fn() });
  page = 'activity';
  const logs = renderToStaticMarkup(
    App({ controller, preferredLanguage: 'zh' }),
  );
  expect(logs).toContain('调用记录');
  expect(logs).toContain('暂不可用');
  const withHistory = {
    ...controller,
    snapshot: () => ({
      ...state,
      history: { calls: [], retention: { limit: 200, persistent: true } },
    }),
  };
  const empty = renderToStaticMarkup(
    App({ controller: withHistory, preferredLanguage: 'en' }),
  );
  expect(empty).toContain('Call history');
  expect(empty).toContain('No real call records');
  const noSystem = {
    ...controller,
    snapshot: () => ({ ...state, system: null }),
  };
  const unavailable = renderToStaticMarkup(
    App({ controller: noSystem, preferredLanguage: 'en' }),
  );
  expect(unavailable).toContain('Call history unavailable');
  const unauthorized = {
    ...controller,
    snapshot: () => ({ ...state, authorized: false }),
  };
  page = 'welcome';
  const denied = renderToStaticMarkup(
    App({ controller: unauthorized, preferredLanguage: 'zh' }),
  );
  expect(denied).toContain('role="alert"');
});
