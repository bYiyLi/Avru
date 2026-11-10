import { createElement, isValidElement } from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { ViewState } from '../src/controller.js';
import {
  OverviewInsights,
  outcomeGradient,
  summarizeOverview,
} from '../src/OverviewInsights.js';

const system = {
  daemonVersion: '0.1.0-dev.1',
  expectedExtensionVersion: '1.0',
  mcp: 'oauthReadOnly',
  chatgpt: 'notVerified',
  frpc: 'managed',
} as const;
function profile(id: string, connected: boolean, version?: string) {
  return {
    id,
    name: id,
    connected,
    connectionId: connected ? `connection-${id}` : null,
    tabs: [],
    metadata: version
      ? {
          browserName: 'Chrome',
          browserVersion: '150',
          versionSource: 'clientHints' as const,
          extensionVersion: version,
        }
      : null,
  };
}
function state(): ViewState {
  return {
    system,
    authorized: true,
    message: '',
    busy: false,
    pairings: [],
    browsers: [
      profile('matched', true, '1.0'),
      profile('old', true, '0.9'),
      profile('unknown', true),
      profile('offline', false, '1.0'),
    ],
    connection: {
      state: 'registered',
      configured: true,
      issuer: null,
      mcpUrl: null,
      programVersion: '1.0',
      programAvailable: true,
      verification: { publicEntry: 'notVerified', chatgpt: 'notVerified' },
      events: [],
      retention: { limit: 10, persistent: true },
    },
    history: {
      calls: (['succeeded', 'failed', 'rejected', 'unknown'] as const).map(
        (status, index) => ({
          traceId: String(index),
          requestId: String(index),
          startedAt: 1000,
          durationMs: 0,
          method: 'tools/call',
          tool: 'avru',
          spans: [],
          status,
        }),
      ),
      retention: { limit: 200, persistent: true },
    },
  };
}
function clickAll(node: ReactNode): void {
  if (Array.isArray(node)) {
    node.forEach(clickAll);
    return;
  }
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node))
    return;
  if (typeof node.type === 'function') {
    clickAll((node.type as (props: unknown) => ReactNode)(node.props));
    return;
  }
  if (node.type === 'button') node.props.onClick?.();
  clickAll(node.props.children);
}

it('derives only measured browser, version, remote and retained call statistics', () => {
  const stats = summarizeOverview(state());
  expect(stats).toEqual({
    known: true,
    online: 3,
    totalBrowsers: 4,
    matching: 1,
    outdated: 1,
    versionUnknown: 1,
    remoteConfigured: true,
    calls: { succeeded: 1, failed: 1, rejected: 1, unknown: 1 },
  });
  const html = renderToStaticMarkup(
    createElement(OverviewInsights, {
      state: state(),
      locale: 'zh',
      onBrowsers: vi.fn(),
      onConnection: vi.fn(),
      onCalls: vi.fn(),
    }),
  );
  expect(html).toContain('在线浏览器');
  expect(html).toContain('运行概况');
  expect(html).toContain('版本未知');
  expect(html).toContain('已授权客户端');
  expect(html).toContain('暂未提供可信数量');
  expect(html).toContain('最近保留 4 次调用');
  expect(html).toContain('已拒绝');
  expect(html).not.toContain('演示数据');
});

it('navigates KPI and history controls to their intended destinations', () => {
  const onBrowsers = vi.fn();
  const onConnection = vi.fn();
  const onCalls = vi.fn();
  clickAll(
    OverviewInsights({
      state: state(),
      locale: 'zh',
      onBrowsers,
      onConnection,
      onCalls,
    }),
  );
  expect(onBrowsers).toHaveBeenCalledTimes(2);
  expect(onConnection).toHaveBeenCalledTimes(2);
  expect(onCalls).toHaveBeenCalledTimes(1);
});

it('keeps missing data unknown and does not reinterpret unavailable history as zero calls', () => {
  const missing = {
    ...state(),
    system: null,
    browsers: [],
    history: null,
    connection: null,
  };
  expect(summarizeOverview(missing)).toMatchObject({
    known: false,
    totalBrowsers: 0,
    online: 0,
    remoteConfigured: null,
    calls: null,
  });
  const html = renderToStaticMarkup(
    createElement(OverviewInsights, {
      state: missing,
      locale: 'en',
      onBrowsers: vi.fn(),
      onConnection: vi.fn(),
      onCalls: vi.fn(),
    }),
  );
  expect(html).toContain('Call history unavailable');
  expect(html).toContain('Status not confirmed');
  expect(html).toContain('Count not available');
  expect(html).not.toContain('0 retained calls');
});

it('separates an empty real history and an unconfigured or unsupported remote connection', () => {
  const initial = state();
  if (!initial.connection) throw new Error('Missing fixture connection');
  const empty = {
    ...initial,
    history: { calls: [], retention: { limit: 200, persistent: true } },
    connection: { ...initial.connection, configured: false },
  };
  expect(summarizeOverview(empty).remoteConfigured).toBe(false);
  const html = renderToStaticMarkup(
    createElement(OverviewInsights, {
      state: empty,
      locale: 'zh',
      onBrowsers: vi.fn(),
      onConnection: vi.fn(),
      onCalls: vi.fn(),
    }),
  );
  expect(html).toContain('暂无真实调用记录');
  expect(html).toContain('尚未配置');
  expect(html).toContain('最近保留 0 次调用');
  expect(
    summarizeOverview({
      ...empty,
      system: { ...system, frpc: 'notImplemented' },
    }).remoteConfigured,
  ).toBeNull();
  expect(
    summarizeOverview({ ...empty, connection: null }).remoteConfigured,
  ).toBeNull();
});

it('draws every real outcome independently and a neutral empty ring', () => {
  expect(
    outcomeGradient({ succeeded: 0, failed: 0, rejected: 0, unknown: 0 }),
  ).toBe('var(--console-track)');
  const gradient = outcomeGradient({
    succeeded: 1,
    failed: 1,
    rejected: 1,
    unknown: 1,
  });
  expect(gradient).toContain('var(--console-success) 0% 25%');
  expect(gradient).toContain('var(--console-failure) 25% 50%');
  expect(gradient).toContain('var(--console-rejected) 50% 75%');
  expect(gradient).toContain('var(--console-unknown) 75% 100%');
});
