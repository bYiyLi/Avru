import { createElement, isValidElement } from 'react';
import type * as React from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LogsPage } from '../src/Logs.js';
import {
  buildDiagnosticsSummary,
  buildLogsJson,
  copyText,
  downloadTextFile,
  failurePoint,
  filterCalls,
  lastTraceEvent,
  spanLabel,
} from '../src/Calls.js';
import type { CallHistory, CallSpan, CallTrace } from '../src/call-types.js';
import type { LogFilters } from '../src/Calls.js';
import { shortBrowserId } from '../src/Overview.js';
const setState = vi.fn();
let mockCopy: { id: string; ok: boolean } | null = null;
let noticeOverride: string | null = null;
const occurrences = new Map<string, number>();
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useState: (initial: unknown) => {
    const key = `${typeof initial}:${String(initial)}`;
    const count = occurrences.get(key) ?? 0;
    occurrences.set(key, count + 1);
    let value: unknown = initial;
    if (initial === null) value = mockCopy;
    if (initial === '' && count === 1 && noticeOverride !== null)
      value = noticeOverride;
    return [value, setState];
  },
}));
function resetMocks() {
  occurrences.clear();
  setState.mockClear();
  mockCopy = null;
  noticeOverride = null;
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
function manyCalls(count: number): CallHistory {
  return {
    retention: { limit: 200, persistent: true },
    calls: Array.from({ length: count }, (_, index) =>
      makeCall({
        traceId: `trace-${String(index + 1).padStart(2, '0')}`,
        startedAt: 1000 + index,
        status: 'succeeded',
        tool: 'browsers_list',
        spans: [
          makeSpan({
            spanId: 'root',
            name: 'request',
            startedAt: 1000 + index,
            status: 'succeeded',
            events: [],
          }),
        ],
      }),
    ),
  };
}
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
function allFilters(): LogFilters {
  return { outcome: 'all', tool: 'all', event: 'all', query: '' };
}
it('filters by outcome, tool, event and free text without inventing records', () => {
  const calls = history.calls;
  const traces = (filters: Partial<LogFilters>) =>
    filterCalls(calls, { ...allFilters(), ...filters }).map(
      (call) => call.traceId,
    );
  expect(traces({})).toHaveLength(4);
  expect(traces({ outcome: 'failed' })).toEqual(['trace-b']);
  expect(traces({ tool: 'browsers_list' })).toEqual(['trace-a', 'trace-d']);
  expect(traces({ tool: '' })).toEqual(['trace-c']);
  expect(traces({ event: 'dispatch.failed' })).toEqual(['trace-b']);
  expect(traces({ query: 'TRACE-B' })).toEqual(['trace-b']);
  expect(traces({ query: 'request-trace-c' })).toEqual(['trace-c']);
  expect(traces({ query: 'tabs_claim' })).toEqual(['trace-b']);
  expect(traces({ query: 'dispatch.failed' })).toEqual(['trace-b']);
  expect(traces({ query: 'no-such-call' })).toHaveLength(0);
});
it('filters retained time windows and sorts without changing the source or treating unknown as elapsed', () => {
  const now = Date.now();
  const [first, second, , unknown] = history.calls;
  if (!first || !second || !unknown) throw new Error('Missing fixtures');
  const calls = [
    { ...first, startedAt: now - 15 * 60_000, durationMs: 400 },
    { ...second, startedAt: now - 2 * 60 * 60_000, durationMs: 800 },
    {
      ...unknown,
      startedAt: now - 25 * 60 * 60_000,
      durationMs: 9000,
    },
  ];
  const traceIds = (filters: Partial<LogFilters>) =>
    filterCalls(calls, { ...allFilters(), ...filters }).map(
      (call) => call.traceId,
    );
  expect(traceIds({ period: 'hour' })).toEqual(['trace-a']);
  expect(traceIds({ period: 'day' })).toEqual(['trace-a', 'trace-b']);
  expect(traceIds({ sort: 'newest' })).toEqual([
    'trace-a',
    'trace-b',
    'trace-d',
  ]);
  expect(traceIds({ sort: 'oldest' })).toEqual([
    'trace-d',
    'trace-b',
    'trace-a',
  ]);
  expect(traceIds({ sort: 'slowest' })).toEqual([
    'trace-b',
    'trace-a',
    'trace-d',
  ]);
  expect(calls[0]?.traceId).toBe('trace-a');
  expect(lastTraceEvent(first)).toBe('dispatch.completed');
  expect(lastTraceEvent(unknown)).toBeNull();
});
it('exports filtered calls as JSON and summarizes outcomes per locale', () => {
  const exported = JSON.parse(buildLogsJson(history.calls)) as {
    count: number;
    exportedAt: string;
    calls: CallTrace[];
  };
  expect(exported.count).toBe(4);
  expect(exported.calls).toHaveLength(4);
  expect(typeof exported.exportedAt).toBe('string');
  expect(buildDiagnosticsSummary(history.calls, 'zh')).toBe(
    '调用 4 条 · 已完成 1 · 已拒绝 1 · 失败 1 · 未知 1',
  );
  expect(buildDiagnosticsSummary(history.calls, 'en')).toBe(
    'Calls: 4 · Completed: 1 · Rejected: 1 · Failed: 1 · Unknown: 1',
  );
  expect(buildDiagnosticsSummary([], 'en')).toBe(
    'Calls: 0 · Completed: 0 · Rejected: 0 · Failed: 0 · Unknown: 0',
  );
});
it('locates the failing span and its last event code without inventing steps', () => {
  const calls = history.calls;
  const failed = calls[1];
  const rejected = calls[2];
  const succeeded = calls[0];
  if (!failed || !rejected || !succeeded) throw new Error('missing fixture');
  expect(failurePoint(failed)).toEqual({
    step: 'dispatch',
    code: 'dispatch.failed',
  });
  expect(failurePoint(rejected)).toEqual({
    step: 'authorization',
    code: 'authorization.denied',
  });
  expect(failurePoint(succeeded)).toBeNull();
  const silent = makeCall({
    traceId: 'trace-silent',
    startedAt: 5000,
    status: 'failed',
    tool: null,
    spans: [
      makeSpan({
        spanId: 'dispatch-x',
        name: 'dispatch',
        startedAt: 5000,
        status: 'failed',
        events: [],
      }),
    ],
  });
  expect(failurePoint(silent)).toEqual({ step: 'dispatch', code: '—' });
  expect(spanLabel('request', 'zh')).toBe('请求');
  expect(spanLabel('authorization', 'en')).toBe('Authorization');
  expect(spanLabel('dispatch', 'en')).toBe('Dispatch');
});
it('shortens long browser ids to a recognizable prefix and suffix', () => {
  expect(shortBrowserId('abc')).toBe('abc');
  expect(shortBrowserId('123456789012')).toBe('123456789012');
  expect(shortBrowserId('browser-abcdef-1234567890')).toBe('browser-…7890');
});
it('copies through the clipboard and falls back without leaking the value', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  await expect(copyText('browser-1')).resolves.toBe(true);
  expect(writeText).toHaveBeenCalledWith('browser-1');
  const area = {
    value: '',
    style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    select: vi.fn(),
    remove: vi.fn(),
  };
  const appendChild = vi.fn();
  vi.stubGlobal('navigator', {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
  });
  vi.stubGlobal('document', {
    createElement: () => area,
    body: { appendChild },
    execCommand: () => true,
  });
  await expect(copyText('browser-1')).resolves.toBe(true);
  expect(appendChild).toHaveBeenCalledWith(area);
  expect(area.value).toBe('browser-1');
  vi.stubGlobal('document', {
    createElement: () => area,
    body: { appendChild },
    execCommand: () => false,
  });
  await expect(copyText('browser-1')).resolves.toBe(false);
  vi.stubGlobal('navigator', {});
  vi.unstubAllGlobals();
  await expect(copyText('browser-1')).resolves.toBe(false);
});
it('downloads the log file through an object URL and releases it', () => {
  const click = vi.fn();
  const createObjectURL = vi.fn(() => 'blob:fake');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('document', {
    createElement: () => ({ href: '', download: '', click }),
  });
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  downloadTextFile('avru-call-logs.json', '{"count":0}', 'application/json');
  expect(createObjectURL).toHaveBeenCalledTimes(1);
  expect(click).toHaveBeenCalledTimes(1);
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
});
function assertLogsPage(html: string, locale: 'zh' | 'en'): void {
  expect(html).toContain(locale === 'zh' ? '调用记录' : 'Call history');
  expect(html).toContain(locale === 'zh' ? '结果' : 'Outcome');
  expect(html).toContain(locale === 'zh' ? '工具' : 'Tool');
  expect(html).toContain(locale === 'zh' ? '事件' : 'Event');
  expect(html).toContain('browsers_list');
  expect(html).toContain('tabs_claim');
  expect(html).toContain(locale === 'zh' ? '无工具' : 'No tool');
  expect(html).toContain('dispatch.failed');
  expect(html).toContain('authorization.denied');
  expect(html).toContain(locale === 'zh' ? '下载 JSON' : 'Download JSON');
  expect(html).toContain(
    locale === 'zh' ? '复制诊断摘要' : 'Copy diagnostics summary',
  );
  expect(html).toContain(
    locale === 'zh' ? '共 4 条，显示 4 条' : 'Showing 4 of 4 records',
  );
  expect(html).toContain(locale === 'zh' ? '第 1 / 1 页' : 'Page 1 of 1');
  for (const traceId of ['trace-a', 'trace-b', 'trace-c', 'trace-d'])
    expect(html).toContain(traceId);
}

it('renders the standalone logs page with filters, search and pagination', () => {
  for (const locale of ['zh', 'en'] as const) {
    resetMocks();
    assertLogsPage(renderToStaticMarkup(LogsPage({ history, locale })), locale);
  }
  resetMocks();
  expect(
    renderToStaticMarkup(LogsPage({ history: null, locale: 'zh' })),
  ).toContain('暂不可用');
  resetMocks();
  expect(
    renderToStaticMarkup(
      LogsPage({
        history: { calls: [], retention: { limit: 200, persistent: true } },
        locale: 'zh',
      }),
    ),
  ).toContain('暂无真实调用记录');
  resetMocks();
  const many = renderToStaticMarkup(
    LogsPage({ history: manyCalls(25), locale: 'en' }),
  );
  expect(many).toContain('Page 1 of 2');
  expect(many).toContain('trace-25');
  expect(many).toContain('trace-06');
  expect(many).not.toContain('trace-05');
});
it('keeps unknown history unknown and reports an applied notice', () => {
  resetMocks();
  noticeOverride = 'logs.exported';
  const html = renderToStaticMarkup(LogsPage({ history, locale: 'zh' }));
  expect(html).toContain('日志文件已下载');
  resetMocks();
  const empty = renderToStaticMarkup(
    createElement(LogsPage, { history: null, locale: 'en' }),
  );
  expect(empty).toContain('Call history unavailable');
});
it('applies filters, search, export, summary copy and paging through controls', async () => {
  const click = vi.fn();
  vi.stubGlobal('document', {
    createElement: () => ({ href: '', download: '', click }),
  });
  vi.stubGlobal('URL', {
    createObjectURL: () => 'blob:fake',
    revokeObjectURL: vi.fn(),
  });
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  resetMocks();
  const view = LogsPage({ history: manyCalls(25), locale: 'en' });
  const props = nodes(view);
  const changes = props.filter((item) => item.onChange);
  expect(changes).toHaveLength(6);
  changes[0]?.onChange?.({ currentTarget: { value: 'failed' } });
  expect(setState).toHaveBeenCalledWith('failed');
  changes[1]?.onChange?.({ currentTarget: { value: 'tabs_claim' } });
  expect(setState).toHaveBeenCalledWith('tabs_claim');
  changes[2]?.onChange?.({ currentTarget: { value: 'dispatch.failed' } });
  expect(setState).toHaveBeenCalledWith('dispatch.failed');
  changes[3]?.onChange?.({ currentTarget: { value: 'trace-1' } });
  expect(setState).toHaveBeenCalledWith('trace-1');
  changes[4]?.onChange?.({ currentTarget: { value: 'hour' } });
  expect(setState).toHaveBeenCalledWith('hour');
  changes[5]?.onChange?.({ currentTarget: { value: 'slowest' } });
  expect(setState).toHaveBeenCalledWith('slowest');
  expect(setState).toHaveBeenCalledWith(1);
  const clicks = props.filter((item) => item.onClick);
  expect(clicks).toHaveLength(4);
  expect(clicks[2]?.disabled).toBe(true);
  expect(clicks[3]?.disabled).toBe(false);
  clicks[0]?.onClick?.();
  expect(click).toHaveBeenCalledTimes(1);
  expect(setState).toHaveBeenCalledWith('logs.exported');
  clicks[1]?.onClick?.();
  await vi.waitFor(() => {
    expect(setState).toHaveBeenCalledWith('logs.summaryCopied');
  });
  expect(writeText).toHaveBeenCalledWith(
    'Calls: 25 · Completed: 25 · Rejected: 0 · Failed: 0 · Unknown: 0',
  );
  clicks[2]?.onClick?.();
  expect(setState).toHaveBeenCalledWith(0);
  clicks[3]?.onClick?.();
  expect(setState).toHaveBeenCalledWith(2);
  vi.stubGlobal('navigator', {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
  });
  const area = {
    value: '',
    style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    select: vi.fn(),
    remove: vi.fn(),
  };
  vi.stubGlobal('document', {
    createElement: () => area,
    body: { appendChild: vi.fn() },
    execCommand: () => false,
  });
  clicks[1]?.onClick?.();
  await vi.waitFor(() => {
    expect(setState).toHaveBeenCalledWith('logs.copyFailed');
  });
});
