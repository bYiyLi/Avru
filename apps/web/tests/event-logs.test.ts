import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { CallHistory, CallSpan, CallTrace } from '../src/call-types.js';
import {
  buildEventLogsJson,
  buildLogRows,
  filterLogRows,
  logMessage,
} from '../src/LogEvents.js';
import { EventLogsPage } from '../src/EventLogs.js';

const now = Date.parse('2026-11-10T00:00:00.000Z');

function span(
  name: CallSpan['name'],
  status: CallSpan['status'],
  startedAt: number,
  events: CallSpan['events'],
): CallSpan {
  return {
    spanId: `${name}-span`,
    parentSpanId: name === 'request' ? null : 'request-span',
    name,
    startedAt,
    durationMs: status === 'unknown' ? 0 : 11,
    status,
    events,
  };
}

function call(
  traceId: string,
  status: CallTrace['status'],
  startedAt: number,
  spans: CallSpan[],
): CallTrace {
  return {
    traceId,
    requestId: `request-${traceId}`,
    startedAt,
    durationMs: status === 'unknown' ? 0 : 24,
    status,
    method: 'tools/call',
    tool: 'browser_list',
    spans,
  };
}

const calls: CallTrace[] = [
  call('trace-completed', 'succeeded', now - 1000, [
    span('request', 'succeeded', now - 1000, [
      { at: now - 500, code: 'completed' },
    ]),
    span('authorization', 'succeeded', now - 950, [
      { at: now - 940, code: 'authorized' },
    ]),
    span('dispatch', 'succeeded', now - 800, []),
  ]),
  call('trace-interrupted', 'unknown', now - 2 * 60 * 60 * 1000, [
    span('request', 'unknown', now - 2 * 60 * 60 * 1000, []),
  ]),
];

const history: CallHistory = {
  calls,
  retention: { limit: 200, persistent: true },
};

it('only renders events and spans supplied by the daemon, with stable chronology', () => {
  const rows = buildLogRows(calls);
  expect(rows).toHaveLength(4);
  expect(rows.map((row) => row.span.name)).toEqual([
    'request',
    'dispatch',
    'authorization',
    'request',
  ]);
  expect(rows.filter((row) => row.event === null)).toHaveLength(2);
  expect(rows[0]?.event?.code).toBe('completed');
  expect(rows[3]?.call.status).toBe('unknown');
  const [completed, dispatched] = rows;
  if (!completed || !dispatched) throw new Error('Invalid call test fixture');
  expect(logMessage(completed, 'zh')).toContain('服务端已完成');
  expect(logMessage(dispatched, 'zh')).toContain('分派');
  expect(
    rows.every(
      (row) => !['sdk', 'extension', 'execution'].includes(row.span.name),
    ),
  ).toBe(true);
});

it('filters status-independent event rows by code, stage, time and known identifiers', () => {
  const rows = buildLogRows(calls);
  const filters = {
    event: 'all',
    stage: 'all' as const,
    query: '',
    timeRange: 'all' as const,
  };
  expect(filterLogRows(rows, filters, 'zh', now)).toHaveLength(4);
  expect(
    filterLogRows(rows, { ...filters, event: 'authorized' }, 'zh', now),
  ).toHaveLength(1);
  expect(
    filterLogRows(rows, { ...filters, stage: 'dispatch' }, 'zh', now),
  ).toHaveLength(1);
  expect(
    filterLogRows(
      rows,
      { ...filters, query: 'request-trace-interrupted' },
      'zh',
      now,
    ),
  ).toHaveLength(1);
  expect(
    filterLogRows(rows, { ...filters, query: '服务端已完成' }, 'zh', now),
  ).toHaveLength(1);
  expect(
    filterLogRows(rows, { ...filters, timeRange: '15m' }, 'zh', now),
  ).toHaveLength(3);
  expect(
    filterLogRows(rows, { ...filters, timeRange: '1h' }, 'zh', now),
  ).toHaveLength(3);
  expect(
    filterLogRows(rows, { ...filters, timeRange: '24h' }, 'zh', now),
  ).toHaveLength(4);
  expect(
    filterLogRows(rows, { ...filters, query: 'not-in-history' }, 'zh', now),
  ).toHaveLength(0);
});

it('exports exactly the matching redacted rows, not hidden events', () => {
  const rows = filterLogRows(
    buildLogRows(calls),
    { query: '', stage: 'all', event: 'authorized', timeRange: 'all' },
    'zh',
    now,
  );
  const json = buildEventLogsJson(rows);
  const result = JSON.parse(json) as {
    count: number;
    exportedAt: string;
    events: Array<{
      code: string;
      stage: string;
      traceId: string;
      requestId: string;
      spanId: string;
    }>;
  };
  expect(result.count).toBe(1);
  expect(result.events).toEqual([
    expect.objectContaining({
      code: 'authorized',
      stage: 'authorization',
      traceId: 'trace-completed',
      requestId: 'request-trace-completed',
      spanId: 'authorization-span',
    }),
  ]);
  expect(Date.parse(result.exportedAt)).toBeGreaterThan(0);
  expect(json).not.toContain('trace-interrupted');
  expect(json).not.toContain('"completed"');
  expect(json).not.toContain('credentials');
});

it('shows a standalone searchable log table, real traces and localized empty states', () => {
  for (const locale of ['zh', 'en'] as const) {
    const markup = renderToStaticMarkup(
      createElement(EventLogsPage, { history, locale }),
    );
    expect(markup).toContain(locale === 'zh' ? '日志' : 'Logs');
    expect(markup).toContain(
      locale === 'zh' ? '消息 / 事件' : 'Message / event',
    );
    expect(markup).toContain(locale === 'zh' ? '时间范围' : 'Time range');
    expect(markup).toContain('trace-completed');
    expect(markup).toContain('trace-interrupted');
    expect(markup).toContain('request-trace-completed');
    expect(markup).toContain('authorization');
    expect(markup).toContain('completed');
    expect(markup).not.toContain('MCP_RESULT_RETURNED');
    expect(markup).not.toContain('EXTENSION_DISPATCHED');
    expect(markup).toContain(locale === 'zh' ? '本机记录' : 'Local records');
  }
  const unavailable = renderToStaticMarkup(
    createElement(EventLogsPage, { history: null, locale: 'zh' }),
  );
  expect(unavailable).toContain('调用记录暂不可用');
  expect(unavailable).toContain('未知');
  const empty = renderToStaticMarkup(
    createElement(EventLogsPage, {
      history: { ...history, calls: [] },
      locale: 'en',
    }),
  );
  expect(empty).toContain('No real call records');
  expect(empty).not.toContain('trace-completed');
});

it('keeps the table directly below filters and groups tools and paging in its footer', () => {
  const markup = renderToStaticMarkup(
    createElement(EventLogsPage, { history, locale: 'zh' }),
  );
  const filterStart = markup.indexOf('class="logs-filters"');
  const tableStart = markup.indexOf('class="logs-table-scroll"');
  const footerStart = markup.indexOf('class="logs-table-footer"');
  expect(filterStart).toBeGreaterThan(0);
  expect(tableStart).toBeGreaterThan(filterStart);
  expect(footerStart).toBeGreaterThan(tableStart);
  expect(markup.slice(filterStart, tableStart)).not.toContain('下载 JSON');
  expect(markup.slice(filterStart, tableStart)).not.toContain('第 1 / 1 页');
  expect(markup.slice(footerStart)).toContain('下载 JSON');
  expect(markup.slice(footerStart)).toContain('复制诊断摘要');
  expect(markup.slice(footerStart)).toContain('4 / 4 条事件');
  expect(markup.slice(footerStart)).toContain('第 1 / 1 页');
  expect(markup).not.toContain('class="logs-page-head"');
  expect(markup).not.toContain('class="logs-result-line"');
});
