import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { BrowsersPage, browserSummary } from '../src/Browsers.js';
import type { ViewState } from '../src/controller.js';

const system = {
  daemonVersion: '0.1.0',
  expectedExtensionVersion: '0.1.0',
  mcp: 'oauthReadOnly',
  chatgpt: 'notVerified',
  frpc: 'managed',
} as const;
const base: ViewState = {
  browsers: [],
  pairings: [],
  authorized: true,
  busy: false,
  message: '',
  system,
};
const browsers: ViewState['browsers'] = [
  {
    id: 'c1',
    name: 'Personal profile',
    connected: true,
    connectionId: 'session1',
    tabs: [{ id: 1, title: 'My tab', url: 'https://example.com/path' }],
    metadata: {
      browserName: 'Chrome',
      browserVersion: '142.0',
      extensionVersion: '0.1.0',
      versionSource: 'clientHints',
    },
  },
  {
    id: 'edge1',
    name: 'Work profile',
    connected: true,
    connectionId: 'session2',
    tabs: [],
    metadata: {
      browserName: 'Microsoft Edge',
      browserVersion: '142.1',
      extensionVersion: '0.0.9',
      versionSource: 'userAgent',
    },
  },
  {
    id: 'offline',
    name: 'Offline profile',
    connected: false,
    connectionId: null,
    tabs: [{ id: 2, title: 'STALE TAB', url: 'https://secret.test' }],
    metadata: {
      browserName: 'STALE BROWSER',
      browserVersion: '999',
      extensionVersion: '0.1.0',
      versionSource: 'clientHints',
    },
  },
];

function renderBrowsers(state: ViewState, locale: 'zh' | 'en') {
  return renderToStaticMarkup(
    createElement(BrowsersPage, {
      state,
      locale,
      onAddBrowser: vi.fn(),
    }),
  );
}

it('uses only connected metadata for actual versions and handles mismatches independently', () => {
  const state: ViewState = { ...base, browsers };
  expect(browserSummary(state)).toEqual({ total: 3, online: 2 });
  const html = renderBrowsers(state, 'zh');
  expect(html).toContain('3 个已对接 · 2 个在线');
  expect(html).toContain('Microsoft Edge');
  expect(html).toContain('142.0');
  expect(html).toContain('0.0.9');
  expect(html).toContain('建议更新');
  expect(html).toContain('一致');
  expect(html).toContain('离线');
  expect(html).toContain('My tab');
  expect(html).not.toContain('STALE TAB');
  expect(html).not.toContain('STALE BROWSER');
  expect(html).not.toContain('999');
  expect(html).not.toContain('https://secret.test');
  expect(html).toContain('最后响应');
  expect(html).toContain('未知');
  expect(html).not.toContain('演示数据');
});

it('keeps unknown, zero, and missing extension metadata separate in both languages', () => {
  for (const locale of ['zh', 'en'] as const) {
    expect(browserSummary({ ...base, system: null })).toBeNull();
    const unavailable = renderBrowsers(
      { ...base, system: null, browsers },
      locale,
    );
    expect(unavailable).not.toContain('Chrome');
    expect(unavailable).not.toContain('142.0');
    expect(unavailable).toContain(
      locale === 'zh' ? '连接数量未知' : 'counts unknown',
    );
    const empty = renderBrowsers(base, locale);
    expect(empty).toContain(
      locale === 'zh' ? '暂无浏览器连接' : 'No browser connections',
    );
    expect(empty).not.toContain('Microsoft Edge');
    const missing = renderBrowsers(
      {
        ...base,
        browsers: [
          {
            id: 'new-profile',
            name: 'New profile',
            connected: true,
            connectionId: 'session3',
            tabs: [],
            metadata: null,
          },
        ],
      },
      locale,
    );
    expect(missing).toContain(locale === 'zh' ? '待确认' : 'Unconfirmed');
    expect(missing).toContain(locale === 'zh' ? '1 个已对接' : '1 profiles');
  }
});

it('escapes profile and tab titles as text rather than HTML', () => {
  const html = renderBrowsers(
    {
      ...base,
      browsers: [
        {
          id: 'safe',
          name: '<img src=x onerror=alert(1)>',
          connected: true,
          connectionId: 'session',
          tabs: [],
          metadata: null,
        },
      ],
    },
    'en',
  );
  expect(html).toContain('&lt;img');
  expect(html).not.toContain('<img');
});
