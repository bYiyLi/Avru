import { afterEach, describe, expect, it, vi } from 'vitest';
import { saved, setup } from './connection-fixture';

afterEach(() => {
  vi.useRealTimers();
});

type Harness = ReturnType<typeof setup>;

async function connected(): Promise<Harness> {
  const h = setup(saved);
  await h.connection.start();
  await h.receive({
    v: 1,
    type: 'ready',
    browserId: saved.browserId,
    connectionId: 'c',
  });
  expect(h.connection.status()).toEqual({ code: 'connected' });
  vi.mocked(h.current().send).mockClear();
  return h;
}

function sentResults(h: Harness): Record<string, unknown>[] {
  return vi
    .mocked(h.current().send)
    .mock.calls.map(([data]) => JSON.parse(data) as Record<string, unknown>)
    .filter(
      (message) => message.type === 'action_result' || message.type === 'chunk',
    );
}

it('reports debugger cancellation only over an authenticated connection', async () => {
  const h = setup(saved);
  h.connection.interrupt(7);
  await h.connection.start();
  await h.receive({
    v: 1,
    type: 'ready',
    browserId: saved.browserId,
    connectionId: 'c',
  });
  vi.mocked(h.current().send).mockClear();
  h.connection.interrupt(7);
  h.connection.interrupt(-1);
  h.connection.interrupt(Number.NaN);
  expect(
    vi
      .mocked(h.current().send)
      .mock.calls.map(([raw]) => JSON.parse(raw) as Record<string, unknown>),
  ).toEqual([{ v: 1, type: 'control-interrupted', tabId: 7 }]);
  await h.connection.disconnect();
});

describe('extension action dispatch', () => {
  it('forwards window and tab organization operations to the browser port', async () => {
    const h = await connected();
    const windows = [{ id: '42', focused: true }];
    h.ports.action = vi.fn().mockResolvedValue(windows);
    await h.receive({
      v: 1,
      type: 'action',
      requestId: 'req-windows',
      tabId: 1,
      generation: 1,
      method: 'windows.list',
      args: [],
    });
    expect(h.ports.action).toHaveBeenCalledWith(1, 'windows.list', []);
    expect(sentResults(h)).toEqual([
      {
        v: 1,
        type: 'action_result',
        requestId: 'req-windows',
        ok: true,
        value: windows,
      },
    ]);
    await h.receive({
      v: 1,
      type: 'action',
      requestId: 'req-move',
      tabId: 1,
      generation: 1,
      method: 'tabs.move',
      args: ['7', { index: 0 }],
    });
    expect(h.ports.action).toHaveBeenCalledWith(1, 'tabs.move', [
      '7',
      { index: 0 },
    ]);
    await h.connection.disconnect();
  });
});

describe('extension action dispatch remainder', () => {
  it('passes browser history options to its connected profile only', async () => {
    const h = await connected();
    const opts = { limit: 2, queries: ['news'] };
    const result = [
      { url: 'https://example.test', dateVisited: '2026-11-09T00:00:00.000Z' },
    ];
    h.ports.action = vi.fn().mockResolvedValue(result);
    await h.receive({
      v: 1,
      type: 'action',
      requestId: 'req-history',
      tabId: 1,
      generation: 1,
      method: 'history.search',
      args: [opts],
    });
    expect(h.ports.action).toHaveBeenCalledWith(1, 'history.search', [opts]);
    expect(sentResults(h)).toEqual([
      {
        v: 1,
        type: 'action_result',
        requestId: 'req-history',
        ok: true,
        value: result,
      },
    ]);
    await h.connection.disconnect();
  });
  it('forwards background tab content options through the action channel', async () => {
    const h = await connected();
    const options = { contentType: 'text', urls: ['https://example.test/'] };
    const result = [
      { url: 'https://example.test/', title: 'Example', content: 'Hello' },
    ];
    h.ports.action = vi.fn().mockResolvedValue(result);
    await h.receive({
      v: 1,
      type: 'action',
      requestId: 'req-tabs-content',
      tabId: 1,
      generation: 1,
      method: 'tabs.content',
      args: [options],
    });
    expect(h.ports.action).toHaveBeenCalledWith(1, 'tabs.content', [options]);
    expect(sentResults(h)).toEqual([
      {
        v: 1,
        type: 'action_result',
        requestId: 'req-tabs-content',
        ok: true,
        value: result,
      },
    ]);
    await h.connection.disconnect();
  });
  it('executes tabs.list and returns redacted tabs', async () => {
    const h = await connected();
    await h.receive({
      v: 1,
      type: 'action',
      requestId: 'req-1',
      tabId: 1,
      generation: 1,
      method: 'browser.tabs.list',
      args: [],
    });
    expect(sentResults(h)).toEqual([
      {
        v: 1,
        type: 'action_result',
        requestId: 'req-1',
        ok: true,
        value: [
          { id: 1, title: '', url: 'https://example.com/', active: false },
        ],
      },
    ]);
    expect(h.connection.status()).toEqual({ code: 'connected' });
    await h.connection.disconnect();
  });
});

describe('extension action failure handling and session metadata', () => {
  it('rejects methods outside the M1 allowlist', async () => {
    const h = await connected();
    await h.receive({
      v: 1,
      type: 'action',
      requestId: 'req-2',
      tabId: 1,
      generation: 1,
      method: 'tab.navigate',
      args: [],
    });
    expect(sentResults(h)).toEqual([
      {
        v: 1,
        type: 'action_result',
        requestId: 'req-2',
        ok: false,
        error: {
          code: 'CAPABILITY_NOT_ALLOWED',
          message: 'Method tab.navigate is not supported in M1',
        },
      },
    ]);
    await h.connection.disconnect();
  });
  it('routes title and snapshot through the action hook', async () => {
    const h = await connected();
    h.ports.action = vi.fn().mockResolvedValue('Example');
    await h.receive({
      v: 1,
      type: 'action',
      requestId: 'req-3',
      tabId: 3,
      generation: 1,
      method: 'tab.title',
      args: [],
    });
    expect(h.ports.action).toHaveBeenCalledWith(3, 'tab.title', []);
    expect(sentResults(h)).toEqual([
      {
        v: 1,
        type: 'action_result',
        requestId: 'req-3',
        ok: true,
        value: 'Example',
      },
    ]);
    await h.connection.disconnect();
  });
  it('routes browser session naming through the action hook', async () => {
    const h = await connected();
    h.ports.action = vi.fn().mockResolvedValue({
      groupId: 42,
      title: 'Research',
      color: 'blue',
    });
    await h.receive({
      v: 1,
      type: 'action',
      requestId: 'req-session-name',
      tabId: 3,
      generation: 1,
      method: 'browser.nameSession',
      args: ['Research'],
    });
    expect(h.ports.action).toHaveBeenCalledWith(3, 'browser.nameSession', [
      'Research',
    ]);
    expect(sentResults(h)[0]).toMatchObject({
      type: 'action_result',
      requestId: 'req-session-name',
      ok: true,
      value: { groupId: 42, title: 'Research', color: 'blue' },
    });
    await h.connection.disconnect();
  });
  it('reports hook failures as structured errors without failing the connection', async () => {
    const h = await connected();
    h.ports.action = vi
      .fn()
      .mockRejectedValue(new Error('PAGE_NOT_ACCESSIBLE'));
    await h.receive({
      v: 1,
      type: 'action',
      requestId: 'req-4',
      tabId: 3,
      generation: 1,
      method: 'tab.snapshot',
      args: [],
    });
    expect(sentResults(h)).toEqual([
      {
        v: 1,
        type: 'action_result',
        requestId: 'req-4',
        ok: false,
        error: { code: 'PAGE_NOT_ACCESSIBLE', message: 'Action failed' },
      },
    ]);
    expect(h.connection.status()).toEqual({ code: 'connected' });
    await h.connection.disconnect();
  });
  it('refuses malformed actions and drops actions without a requestId', async () => {
    const h = await connected();
    await h.receive({
      v: 1,
      type: 'action',
      requestId: 'req-5',
      tabId: 1,
      generation: 1,
      method: 'browser.tabs.list',
      args: 'nope',
    });
    expect(sentResults(h)).toEqual([
      {
        v: 1,
        type: 'action_result',
        requestId: 'req-5',
        ok: false,
        error: { code: 'INVALID_ARGUMENT', message: 'Invalid action' },
      },
    ]);
    await h.receive({
      v: 1,
      type: 'action',
      tabId: 1,
      generation: 1,
      method: 'browser.tabs.list',
      args: [],
    });
    await h.receive({
      v: 1,
      type: 'action',
      requestId: 'req-6',
      tabId: 1,
      generation: 1,
      method: 'browser.tabs.list',
      args: ['extra'],
    });
    expect(sentResults(h)).toHaveLength(2);
    expect(sentResults(h)[1]).toEqual({
      v: 1,
      type: 'action_result',
      requestId: 'req-6',
      ok: false,
      error: { code: 'INVALID_ARGUMENT', message: 'tabs.list takes no args' },
    });
    expect(h.connection.status()).toEqual({ code: 'connected' });
    await h.connection.disconnect();
  });
});

describe('extension action chunking', () => {
  it('reassembles chunked actions out of order', async () => {
    const h = await connected();
    const json = JSON.stringify({
      v: 1,
      type: 'action',
      requestId: 'req-7',
      tabId: 1,
      generation: 1,
      method: 'browser.tabs.list',
      args: [],
    });
    const mid = Math.ceil(json.length / 2);
    await h.receive({
      v: 1,
      type: 'chunk',
      requestId: 'req-7',
      index: 1,
      total: 2,
      payload: json.slice(mid),
    });
    expect(sentResults(h)).toEqual([]);
    await h.receive({
      v: 1,
      type: 'chunk',
      requestId: 'req-7',
      index: 0,
      total: 2,
      payload: json.slice(0, mid),
    });
    expect(sentResults(h)).toEqual([
      {
        v: 1,
        type: 'action_result',
        requestId: 'req-7',
        ok: true,
        value: [
          { id: 1, title: '', url: 'https://example.com/', active: false },
        ],
      },
    ]);
    await h.connection.disconnect();
  });
  it('drops malformed chunks and keeps the connection', async () => {
    const h = await connected();
    await h.receive({
      v: 1,
      type: 'chunk',
      requestId: 'req-8',
      index: 5,
      total: 2,
      payload: 'xx',
    });
    await h.receive({
      v: 1,
      type: 'chunk',
      requestId: 'req-8',
      index: 0,
      total: 2,
      payload: 'xx',
    });
    await h.receive({
      v: 1,
      type: 'chunk',
      requestId: 'req-8',
      index: 0,
      total: 2,
      payload: 'xx',
    });
    expect(sentResults(h)).toEqual([]);
    expect(h.connection.status()).toEqual({ code: 'connected' });
    await h.receive({
      v: 1,
      type: 'action',
      requestId: 'req-8',
      tabId: 1,
      generation: 1,
      method: 'browser.tabs.list',
      args: [],
    });
    expect(sentResults(h)).toHaveLength(1);
    await h.connection.disconnect();
  });
  it('chunks large results at the 1 MiB limit', async () => {
    const h = await connected();
    vi.mocked(h.ports.tabs).mockResolvedValueOnce(
      Array.from({ length: 500 }, (_, i) => ({
        id: i + 1,
        title: 't'.repeat(256),
        url: `https://example.com/${'p'.repeat(2000)}`,
      })),
    );
    await h.receive({
      v: 1,
      type: 'action',
      requestId: 'req-9',
      tabId: 1,
      generation: 1,
      method: 'browser.tabs.list',
      args: [],
    });
    const sends = vi
      .mocked(h.current().send)
      .mock.calls.map(([data]) => JSON.parse(data) as Record<string, unknown>);
    const chunks = sends.filter((message) => message.type === 'chunk');
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks)
      expect(
        new TextEncoder().encode(JSON.stringify(chunk)).length,
      ).toBeLessThanOrEqual(1_048_576);
    const reassembled = JSON.parse(
      chunks.map((chunk) => chunk.payload as string).join(''),
    ) as Record<string, unknown>;
    expect(reassembled.type).toBe('action_result');
    expect(reassembled.requestId).toBe('req-9');
    expect((reassembled.value as unknown[]).length).toBe(500);
    await h.connection.disconnect();
  });
  it('ignores actions before ready', async () => {
    const h = setup(saved);
    await h.connection.start();
    await h.receive({
      v: 1,
      type: 'action',
      requestId: 'req-0',
      tabId: 1,
      generation: 1,
      method: 'browser.tabs.list',
      args: [],
    });
    expect(sentResults(h)).toEqual([]);
    await h.receive({
      v: 1,
      type: 'ready',
      browserId: saved.browserId,
      connectionId: 'c',
    });
    expect(h.connection.status()).toEqual({ code: 'connected' });
    await h.connection.disconnect();
  });
});
