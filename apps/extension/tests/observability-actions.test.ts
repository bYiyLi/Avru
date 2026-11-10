import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CdpController } from '../utils/cdp';
import { dispatchObservabilityAction } from '../utils/observability-actions';

type Event = {
  sequence: number;
  method: string;
  params?: Record<string, unknown>;
};

function fixture(initial: Event[] = []) {
  let recorded = initial;
  const send = vi.fn(() => Promise.resolve({ ok: true }));
  const events = vi.fn(() =>
    Promise.resolve({
      events: recorded,
      nextCursor: String(recorded.at(-1)?.sequence ?? 0),
    }),
  );
  const cdp = { send, events } as unknown as Pick<
    CdpController,
    'send' | 'events'
  >;
  const call = (method: string, args: unknown[] = []) =>
    dispatchObservabilityAction(cdp, 7, method, args);
  const setEvents = (items: Event[]) => {
    recorded = items;
  };
  return { send, events, call, setEvents };
}

const e = (
  sequence: number,
  method: string,
  params?: Record<string, unknown>,
): Event => (params ? { sequence, method, params } : { sequence, method });

afterEach(() => {
  vi.useRealTimers();
});

describe('CDP buffered event observation', () => {
  it('supports the default cursor and returns a capped batch of events', async () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      e(i + 1, 'Page.frameNavigated'),
    );
    const h = fixture(items);
    expect(await h.call('cdp.readEvents', [{ cursor: '3', limit: 2 }])).toEqual(
      {
        events: items.slice(0, 2),
        nextCursor: '2',
        hasMore: true,
      },
    );
    expect(h.events).toHaveBeenCalledWith(7, '3');
    expect(await h.call('cdp.readEvents')).toEqual({
      events: items,
      nextCursor: '6',
      hasMore: false,
    });
    expect(h.events).toHaveBeenLastCalledWith(7, undefined);
  });

  it('preserves empty-event cursor and rejects malformed options', async () => {
    const h = fixture();
    expect(await h.call('cdp.readEvents', [{ cursor: '21' }])).toEqual({
      events: [],
      nextCursor: '21',
      hasMore: false,
    });
    for (const args of [
      [null],
      [1],
      [[]],
      [{}, {}],
      [{ cursor: '-1' }],
      [{ cursor: 1 }],
      [{ cursor: '01' }],
      [{ cursor: '' }],
      [{ limit: 0 }],
      [{ limit: 201 }],
      [{ limit: 1.2 }],
      [{ limit: '20' }],
    ])
      await expect(h.call('cdp.readEvents', args)).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
  });

  it('supports a cursor supplied with a one-event page batch', async () => {
    const h = fixture([e(22, 'Network.requestWillBeSent')]);
    expect(await h.call('cdp.readEvents', [{ limit: 1 }])).toEqual({
      events: [e(22, 'Network.requestWillBeSent')],
      nextCursor: '22',
      hasMore: false,
    });
  });
});

describe('browser console log read', () => {
  it('reads CDP console messages, resource URLs, and log entries', async () => {
    const h = fixture([
      e(1, 'Runtime.consoleAPICalled', {
        type: 'warning',
        timestamp: 1_000,
        args: [
          { value: 'warn-1' },
          { description: 'description' },
          { type: 'object' },
        ],
        stackTrace: { callFrames: [{ url: 'https://example.test/app.js' }] },
      }),
      e(2, 'Log.entryAdded', {
        entry: {
          level: 'error',
          text: 'network issue',
          timestamp: 1_700_000_000_000,
          url: 'https://example.test/api',
        },
      }),
      e(3, 'Page.frameNavigated'),
    ]);
    const result = (await h.call('tab.dev.logs')) as {
      level: string;
      message: string;
      timestamp: string;
      url?: string;
    }[];
    expect(result).toEqual([
      {
        level: 'warn',
        message: 'warn-1 description object',
        timestamp: '1970-01-01T00:16:40.000Z',
        url: 'https://example.test/app.js',
      },
      {
        level: 'error',
        message: 'network issue',
        timestamp: '2023-11-14T22:13:20.000Z',
        url: 'https://example.test/api',
      },
    ]);
    expect(h.send).toHaveBeenNthCalledWith(1, 7, 'Runtime.enable', {});
    expect(h.send).toHaveBeenNthCalledWith(2, 7, 'Log.enable', {});
  });

  it('filters by level, message, timestamp and limits the returned results', async () => {
    const h = fixture([
      e(1, 'Runtime.consoleAPICalled', {
        type: 'warn',
        args: [{ value: 'match-1' }],
        timestamp: 100,
      }),
      e(2, 'Runtime.consoleAPICalled', {
        type: 'error',
        args: [{ value: 'match-2' }],
        timestamp: 100,
      }),
      e(3, 'Runtime.consoleAPICalled', {
        type: 'assert',
        args: [{ value: 'match-3' }],
        timestamp: 101,
      }),
      e(4, 'Runtime.consoleAPICalled', {
        type: 'warn',
        args: [{ value: 'match-4' }],
        timestamp: 102,
      }),
      e(5, 'Runtime.consoleAPICalled', {
        type: 'warn',
        args: [{ value: 'ignored' }],
        timestamp: 103,
      }),
    ]);
    expect(
      await h.call('tab.dev.logs', [
        { levels: ['warning'], filter: 'match', since: 100_000, limit: 1 },
      ]),
    ).toMatchObject([{ level: 'warn', message: 'match-4' }]);
    expect(await h.call('tab.dev.logs', [{ levels: ['error'] }])).toMatchObject(
      [
        { level: 'error', message: 'match-2' },
        { level: 'error', message: 'match-3' },
      ],
    );
  });

  it('renders null, booleans, numbers, arrays and fallback descriptions safely', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-09T12:00:00.000Z'));
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const h = fixture([
      e(1, 'Runtime.consoleAPICalled', {
        type: 'log',
        args: [
          null,
          { value: null, type: 'object' },
          { value: true },
          { value: 0 },
          { value: [1, 2] },
          { value: cyclic },
        ],
      }),
      e(2, 'Log.entryAdded', {
        entry: { level: 'custom', text: null, timestamp: -1 },
      }),
      e(3, 'Log.entryAdded', { entry: { level: 'log', text: { ok: true } } }),
    ]);
    const result = (await h.call('tab.dev.logs')) as {
      message: string;
      level: string;
      timestamp: string;
    }[];
    expect(result).toHaveLength(3);
    expect(result[0]?.message).toContain('true');
    expect(result[0]?.message).toContain('[1,2]');
    expect(result[0]?.message).toContain('[object]');
    expect(result[1]).toMatchObject({
      level: 'log',
      message: 'null',
      timestamp: '2026-11-09T12:00:00.000Z',
    });
    expect(result[2]?.message).toBe('{"ok":true}');
  });

  it('bounds message and URL sizes and handles empty console event params', async () => {
    const h = fixture([
      e(1, 'Runtime.consoleAPICalled'),
      e(2, 'Runtime.consoleAPICalled', {
        args: [{ value: 'a'.repeat(2000) }],
        stackTrace: { callFrames: [{ url: 'x'.repeat(1000) }] },
      }),
      e(3, 'Log.entryAdded', {
        entry: { text: 'b'.repeat(2000), url: 'y'.repeat(1000) },
      }),
    ]);
    const result = (await h.call('tab.dev.logs')) as {
      message: string;
      url?: string;
    }[];
    expect(result).toHaveLength(3);
    expect(result[0]?.message).toBe('');
    expect(result[1]?.message.length).toBe(1024);
    expect(result[1]?.url?.length).toBe(512);
    expect(result[2]?.message.length).toBe(1024);
    expect(result[2]?.url?.length).toBe(512);
  });

  it('validates each dev log filter and enforces bounded result sizes', async () => {
    const h = fixture();
    for (const args of [
      [null],
      [1],
      [[]],
      [{}, {}],
      [{ limit: 0 }],
      [{ limit: 26 }],
      [{ limit: '4' }],
      [{ limit: 1.2 }],
      [{ filter: null }],
      [{ levels: null }],
      [{ levels: ['verbose'] }],
      [{ levels: [1] }],
      [{ since: -1 }],
      [{ since: 'yesterday' }],
      [{ since: Number.POSITIVE_INFINITY }],
    ])
      await expect(h.call('tab.dev.logs', args)).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    expect(h.send).not.toHaveBeenCalled();
  });
});

describe('JavaScript dialogs without blocking CDP', () => {
  it('detects only currently active page dialogs from the existing event stream', async () => {
    const h = fixture([
      e(1, 'Page.javascriptDialogOpening', { type: 'alert', message: 'One' }),
      e(2, 'Page.javascriptDialogClosed'),
      e(3, 'Page.javascriptDialogOpening', { type: 'confirm', message: 'Two' }),
    ]);
    expect(await h.call('tab.getJsDialog')).toEqual({
      type: 'confirm',
      message: 'Two',
    });
    expect(h.send).not.toHaveBeenCalled();
    h.setEvents([
      e(4, 'Page.javascriptDialogOpening', { type: 'prompt' }),
      e(5, 'Page.javascriptDialogClosed'),
    ]);
    expect(await h.call('tab.getJsDialog')).toBe(null);
    h.setEvents([
      e(6, 'Page.javascriptDialogOpening', { type: 'beforeunload' }),
    ]);
    expect(await h.call('tab.getJsDialog')).toEqual({
      type: 'beforeunload',
      message: '',
    });
    h.setEvents([
      e(7, 'Page.javascriptDialogOpening', { type: 'not-a-dialog' }),
    ]);
    expect(await h.call('tab.getJsDialog')).toBe(null);
  });

  it('sends native accept and dismiss CDP commands', async () => {
    const h = fixture();
    expect(await h.call('tab.dialogAccept')).toEqual({
      ok: true,
      tabId: '7',
      changed: true,
    });
    expect(await h.call('tab.dialogAccept', ['hello'])).toEqual({
      ok: true,
      tabId: '7',
      changed: true,
    });
    expect(await h.call('tab.dialogDismiss')).toEqual({
      ok: true,
      tabId: '7',
      changed: true,
    });
    expect(h.send).toHaveBeenNthCalledWith(
      1,
      7,
      'Page.handleJavaScriptDialog',
      { accept: true },
    );
    expect(h.send).toHaveBeenNthCalledWith(
      2,
      7,
      'Page.handleJavaScriptDialog',
      { accept: true, promptText: 'hello' },
    );
    expect(h.send).toHaveBeenNthCalledWith(
      3,
      7,
      'Page.handleJavaScriptDialog',
      { accept: false },
    );
  });

  it('rejects unsolicited dialog arguments and unknown bridge operations', async () => {
    const h = fixture();
    for (const args of [[null], [4], ['hello', 'world']])
      await expect(h.call('tab.dialogAccept', args)).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    for (const method of ['tab.getJsDialog', 'tab.dialogDismiss'])
      await expect(h.call(method, ['extra'])).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    await expect(h.call('unknown')).rejects.toThrow('CAPABILITY_NOT_ALLOWED');
    expect(h.events).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });
});
