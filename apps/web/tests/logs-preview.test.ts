import { isValidElement } from 'react';
import type * as React from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CallHistory, CallSpan, CallTrace } from '../src/call-types.js';
import { RecentCalls } from '../src/Calls.js';
import { Overview } from '../src/Overview.js';
import type { ViewState } from '../src/controller.js';

const setState = vi.fn();
const overviewActions = {
  onOpenBrowsers: vi.fn(),
  onOpenActivity: vi.fn(),
  onOpenConnection: vi.fn(),
  onOpenInstall: vi.fn(),
  runDiagnostics: vi.fn().mockResolvedValue({ steps: [] }),
};
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useState: (initial: unknown) => [initial, setState],
}));
function resetMocks() {
  setState.mockClear();
  overviewActions.onOpenBrowsers.mockClear();
  overviewActions.onOpenActivity.mockClear();
  overviewActions.onOpenConnection.mockClear();
  overviewActions.onOpenInstall.mockClear();
  overviewActions.runDiagnostics.mockClear();
}
beforeEach(resetMocks);
afterEach(() => {
  vi.unstubAllGlobals();
});

function makeSpan(options: {
  spanId: string;
  name: CallSpan['name'];
  startedAt: number;
  status: CallSpan['status'];
  events: { at: number; code: string }[];
}): CallSpan {
  return {
    spanId: options.spanId,
    parentSpanId: options.spanId === 'root' ? null : 'root',
    name: options.name,
    startedAt: options.startedAt,
    durationMs: 1,
    status: options.status,
    events: options.events,
  };
}
function makeCall(options: {
  traceId: string;
  startedAt: number;
  status: CallTrace['status'];
  tool: string | null;
  spans: CallSpan[];
}): CallTrace {
  return {
    traceId: options.traceId,
    requestId: `request-${options.traceId}`,
    startedAt: options.startedAt,
    durationMs: 5,
    status: options.status,
    method: 'tools/call',
    tool: options.tool,
    spans: options.spans,
  };
}
const history: CallHistory = {
  retention: { limit: 200, persistent: true },
  calls: [
    makeCall({
      traceId: 'trace-a',
      startedAt: 3000,
      status: 'succeeded',
      tool: 'browsers_list',
      spans: [
        makeSpan({
          spanId: 'root-a',
          name: 'request',
          startedAt: 3000,
          status: 'succeeded',
          events: [],
        }),
        makeSpan({
          spanId: 'dispatch-a',
          name: 'dispatch',
          startedAt: 3001,
          status: 'succeeded',
          events: [{ at: 3002, code: 'dispatch.completed' }],
        }),
      ],
    }),
    makeCall({
      traceId: 'trace-b',
      startedAt: 2000,
      status: 'failed',
      tool: 'tabs_claim',
      spans: [
        makeSpan({
          spanId: 'root-b',
          name: 'request',
          startedAt: 2000,
          status: 'succeeded',
          events: [],
        }),
        makeSpan({
          spanId: 'dispatch-b',
          name: 'dispatch',
          startedAt: 2001,
          status: 'failed',
          events: [{ at: 2002, code: 'dispatch.failed' }],
        }),
      ],
    }),
    makeCall({
      traceId: 'trace-c',
      startedAt: 1000,
      status: 'rejected',
      tool: null,
      spans: [
        makeSpan({
          spanId: 'root-c',
          name: 'request',
          startedAt: 1000,
          status: 'succeeded',
          events: [],
        }),
        makeSpan({
          spanId: 'auth-c',
          name: 'authorization',
          startedAt: 1001,
          status: 'rejected',
          events: [{ at: 1002, code: 'authorization.denied' }],
        }),
      ],
    }),
    makeCall({
      traceId: 'trace-d',
      startedAt: 4000,
      status: 'unknown',
      tool: 'browsers_list',
      spans: [
        makeSpan({
          spanId: 'root-d',
          name: 'request',
          startedAt: 4000,
          status: 'unknown',
          events: [],
        }),
      ],
    }),
  ],
};

interface NodeProps {
  children?: ReactNode;
  onClick?: () => void;
  onChange?: (event: { currentTarget: { value: string } }) => void;
  disabled?: boolean;
}
function nodes(node: ReactNode): NodeProps[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<NodeProps>(node)) return [];
  if (typeof node.type === 'function')
    return nodes((node.type as (props: unknown) => ReactNode)(node.props));
  return [node.props, ...nodes(node.props.children)];
}

it('previews the three most recent calls and marks the failing step', () => {
  const openLogs = vi.fn();
  for (const locale of ['zh', 'en'] as const) {
    resetMocks();
    const html = renderToStaticMarkup(
      RecentCalls({ history, locale, onOpenLogs: openLogs }),
    );
    expect(html).toContain(locale === 'zh' ? '最近调用' : 'Recent calls');
    expect(html).toContain(locale === 'zh' ? '查看全部日志' : 'View all logs');
    expect(html).toContain('browsers_list');
    expect(html).toContain('tabs_claim');
    expect(html).not.toContain('authorization.denied');
    expect(html).not.toContain(locale === 'zh' ? '已拒绝' : 'Rejected');
    expect(html).toContain(
      locale === 'zh'
        ? '失败于分派 · dispatch.failed'
        : 'Failed at Dispatch · dispatch.failed',
    );
  }
  resetMocks();
  expect(
    renderToStaticMarkup(
      RecentCalls({ history: null, locale: 'zh', onOpenLogs: openLogs }),
    ),
  ).toContain('暂不可用');
  resetMocks();
  expect(
    renderToStaticMarkup(
      RecentCalls({
        history: { calls: [], retention: { limit: 200, persistent: true } },
        locale: 'en',
        onOpenLogs: openLogs,
      }),
    ),
  ).toContain('No real call records');
  resetMocks();
  const view = RecentCalls({ history, locale: 'en', onOpenLogs: openLogs });
  for (const item of nodes(view).filter((entry) => entry.onClick))
    item.onClick?.();
  expect(openLogs).toHaveBeenCalledTimes(4);
});
const overviewState: ViewState = {
  system: {
    daemonVersion: '0.1.0',
    expectedExtensionVersion: '0.0.1',
    mcp: 'notImplemented',
    chatgpt: 'notImplemented',
    frpc: 'notImplemented',
  },
  browsers: [
    {
      id: 'browser-abcdef-1234567890',
      name: 'Chrome',
      connected: true,
      connectionId: 'c1',
      tabs: [],
      metadata: {
        browserName: 'Chrome',
        browserVersion: '150.0.1',
        versionSource: 'clientHints',
        extensionVersion: '0.0.1',
      },
    },
    {
      id: 'short',
      name: 'Edge',
      connected: false,
      connectionId: null,
      tabs: [],
    },
  ],
  pairings: [],
  message: '',
  authorized: true,
  busy: false,
};
it('keeps the overview focused on aggregate browser health', () => {
  for (const locale of ['zh', 'en'] as const) {
    resetMocks();
    const html = renderToStaticMarkup(
      Overview({ state: overviewState, locale, ...overviewActions }),
    );
    expect(html).toContain(locale === 'zh' ? '在线浏览器' : 'Online browsers');
    expect(html).toContain('1 / 2');
    expect(html).not.toContain('browser-abcdef-1234567890');
  }
});
