import { isValidElement } from 'react';
import type * as React from 'react';
import type { ReactNode } from 'react';
import type * as Calls from '../src/Calls.js';
import { afterEach, expect, it, vi } from 'vitest';
import type { CallHistory, CallSpan, CallTrace } from '../src/call-types.js';

const mocks = vi.hoisted(() => ({
  setState: vi.fn(),
  copyText: vi.fn(),
  downloadTextFile: vi.fn(),
}));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useState: (initial: unknown) => [initial, mocks.setState],
}));
vi.mock('../src/Calls.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Calls>()),
  copyText: mocks.copyText,
  downloadTextFile: mocks.downloadTextFile,
}));
import { EventLogsPage } from '../src/EventLogs.js';

const startedAt = Date.parse('2026-11-10T00:00:00.000Z');
const span: CallSpan = {
  spanId: 'dispatch-1',
  parentSpanId: 'root-1',
  name: 'dispatch',
  startedAt,
  durationMs: 5,
  status: 'succeeded',
  events: [{ at: startedAt + 1, code: 'dispatch.completed' }],
};
const call: CallTrace = {
  traceId: 'trace-1',
  requestId: 'request-1',
  startedAt,
  durationMs: 5,
  status: 'succeeded',
  method: 'tools/call',
  tool: 'browser.tabs.list',
  spans: [span],
};
const history: CallHistory = {
  calls: [call],
  retention: { limit: 200, persistent: false },
};

interface PageProps {
  children?: ReactNode;
  onChange?: (key: string, value: string) => void;
  onExport?: () => void;
  onCopy?: () => void;
  onPage?: (page: number) => void;
  available?: boolean;
  total?: number;
}

function componentProps(node: ReactNode): PageProps[] {
  if (Array.isArray(node)) return node.flatMap(componentProps);
  if (!isValidElement<PageProps>(node)) return [];
  const props = node.props;
  const child = props.children;
  if (typeof node.type === 'function')
    return [
      props,
      ...componentProps((node.type as (input: PageProps) => ReactNode)(props)),
    ];
  return [props, ...componentProps(child)];
}

afterEach(() => {
  vi.clearAllMocks();
});

it('filters, exports matching rows and handles successful clipboard copy', async () => {
  mocks.copyText.mockResolvedValueOnce(true);
  const view = EventLogsPage({ history, locale: 'en' });
  const props = componentProps(view);
  const filters = props.find((item) => typeof item.onChange === 'function');
  const footer = props.find((item) => typeof item.onExport === 'function');
  expect(filters).toBeDefined();
  expect(footer).toBeDefined();
  filters?.onChange?.('query', 'trace-1');
  expect(mocks.setState).toHaveBeenCalled();
  footer?.onExport?.();
  expect(mocks.downloadTextFile).toHaveBeenCalledWith(
    'avru-events.json',
    expect.stringContaining('dispatch.completed'),
    'application/json',
  );
  footer?.onCopy?.();
  await Promise.resolve();
  expect(mocks.copyText).toHaveBeenCalledOnce();
  expect(mocks.setState).toHaveBeenCalledWith('copied');
  footer?.onPage?.(2);
  expect(mocks.setState).toHaveBeenCalledWith(2);
});

it('reports clipboard false and rejected outcomes without exporting unavailable data', async () => {
  mocks.copyText.mockResolvedValueOnce(false);
  const view = EventLogsPage({ history, locale: 'zh' });
  const footer = componentProps(view).find(
    (item) => typeof item.onCopy === 'function',
  );
  footer?.onCopy?.();
  await Promise.resolve();
  expect(mocks.setState).toHaveBeenCalledWith('copyFailed');

  mocks.setState.mockClear();
  mocks.copyText.mockRejectedValueOnce(new Error('clipboard unavailable'));
  const next = EventLogsPage({ history, locale: 'zh' });
  const nextFooter = componentProps(next).find(
    (item) => typeof item.onCopy === 'function',
  );
  nextFooter?.onCopy?.();
  await Promise.resolve();
  await Promise.resolve();
  expect(mocks.setState).toHaveBeenCalledWith('copyFailed');

  const unavailable = EventLogsPage({ history: null, locale: 'en' });
  const unavailableFooter = componentProps(unavailable).find(
    (item) => typeof item.onExport === 'function',
  );
  expect(unavailableFooter?.available).toBe(false);
  expect(unavailableFooter?.total).toBe(0);
});
