import { describe, expect, it, vi } from 'vitest';
import { ExecutionBridge } from '../src/execution-bridge';
import type { Entry } from '../src/execution-types';
import type { Connections } from '../src/connections';
import { ClaimRegistry } from '../src/claims';

function fixture() {
  const generation = vi.fn(() => 3);
  const sendAction = vi.fn((input: unknown) => {
    expect(input).toBeDefined();
    return Promise.resolve({
      ok: true as const,
      value: { tabId: '88', title: 'Created tab' },
    });
  });
  const connections = {
    generation,
    sendAction,
  } as unknown as Connections;
  const claims = new ClaimRegistry();
  const bridge = new ExecutionBridge(connections, claims);
  const entry = {
    id: 'task-a',
    state: 'running',
    target: { browserId: 'browser-a', tabId: 1, generation: 3 },
    inFlight: 0,
    steps: [],
  } as unknown as Entry;
  const signal = new AbortController().signal;
  const invoke = (method: string, args: unknown[], abort = signal) =>
    bridge.invoke(entry, method, JSON.stringify(args), abort);
  return { bridge, claims, connections, entry, sendAction, generation, invoke };
}

describe('daemon tab lifecycle bridge', () => {
  it('routes window listings and tab moves to one exact generation and checks locks', async () => {
    const h = fixture();
    await h.invoke('windows.list', []);
    await h.invoke('tabs.move', ['88', { index: 0, windowId: 7 }]);
    expect(h.sendAction.mock.calls.map(([request]) => request)).toEqual([
      expect.objectContaining({
        browserId: 'browser-a',
        generation: 3,
        method: 'windows.list',
        args: [],
      }),
      expect.objectContaining({
        browserId: 'browser-a',
        generation: 3,
        method: 'tabs.move',
        args: ['88', { index: 0, windowId: 7 }],
      }),
    ]);
    h.claims.claim('another-owner', {
      browserId: 'browser-a',
      tabId: 88,
      generation: 3,
    });
    h.claims.bind('another-task', 'another-owner', 'browser-a', 88);
    await expect(h.invoke('tabs.move', ['88', { index: 0 }])).rejects.toThrow(
      'tab is in use',
    );
    expect(h.sendAction).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid window and move arguments before dispatch', async () => {
    const h = fixture();
    for (const [method, args] of [
      ['windows.list', [1]],
      ['tabs.move', []],
      ['tabs.move', ['bad', { index: 0 }]],
      ['tabs.move', ['88', { index: -2 }]],
      ['tabs.move', ['88', { index: '0' }]],
      ['tabs.move', ['88', { index: 0, windowId: -1 }]],
    ] as const)
      await expect(h.invoke(method, [...args])).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
    expect(h.sendAction).not.toHaveBeenCalled();
  });
  it('creates a tab in the exact connected browser, without an approval', async () => {
    const h = fixture();
    expect(
      JSON.parse(
        await h.invoke('tabs.new', [
          'https://example.test/',
          { active: false },
        ]),
      ),
    ).toEqual({ tabId: '88', title: 'Created tab' });
    expect(h.sendAction).toHaveBeenCalledWith({
      browserId: 'browser-a',
      tabId: 1,
      generation: 3,
      method: 'tabs.new',
      args: ['https://example.test/', { active: false }],
    });
    expect(h.entry.steps).toEqual([
      expect.objectContaining({ action: 'tabs.new', result: 'ok' }),
    ]);
  });

  it('sends selecting, listing and closing to the target browser profile', async () => {
    const h = fixture();
    await h.invoke('tabs.select', ['88']);
    await h.invoke('tabs.selected', []);
    await h.invoke('tabs.close', ['88']);
    expect(h.sendAction.mock.calls).toHaveLength(3);
    expect(h.sendAction.mock.calls.map((args) => args[0])).toEqual([
      expect.objectContaining({
        browserId: 'browser-a',
        method: 'tabs.select',
        args: ['88'],
      }),
      expect.objectContaining({
        browserId: 'browser-a',
        method: 'tabs.selected',
        args: [],
      }),
      expect.objectContaining({
        browserId: 'browser-a',
        method: 'tabs.close',
        args: ['88'],
      }),
    ]);
  });

  it('rejects a stale browser connection before touching the target tab', async () => {
    const h = fixture();
    h.generation.mockReturnValue(4);
    await expect(h.invoke('tabs.close', ['88'])).rejects.toThrow(
      'stale browser connection',
    );
    expect(h.sendAction).not.toHaveBeenCalled();
    expect(h.entry.steps).toEqual([
      expect.objectContaining({ result: 'error:INVALID_TARGET' }),
    ]);
  });

  it('respects a concurrent task lock on the destination tab', async () => {
    const h = fixture();
    h.claims.claim('other-owner', {
      browserId: 'browser-a',
      tabId: 88,
      generation: 3,
    });
    h.claims.bind('another-task', 'other-owner', 'browser-a', 88);
    await expect(h.invoke('tabs.close', ['88'])).rejects.toThrow(
      'tab is in use',
    );
    expect(h.sendAction).not.toHaveBeenCalled();
  });

  it('does not dispatch malformed requests or requests without a target', async () => {
    const h = fixture();
    for (const [method, args] of [
      ['tabs.close', ['01']],
      ['tabs.select', ['-2']],
      ['tabs.new', []],
      ['tabs.new', ['https://example.test/', []]],
      ['tabs.selected', ['unexpected']],
    ] as const) {
      await expect(h.invoke(method, [...args])).rejects.toThrow();
    }
    h.entry.target = undefined;
    await expect(h.invoke('tabs.new', [null, {}])).rejects.toThrow(
      'task has no browser target',
    );
    expect(h.sendAction).not.toHaveBeenCalled();
  });

  it('reports uncertain side effects if cancelled after sending the action', async () => {
    const h = fixture();
    let finish: (() => void) | undefined;
    h.sendAction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => {
            resolve({
              ok: true,
              value: { tabId: '88', title: 'Created tab' },
            });
          };
        }),
    );
    const abort = new AbortController();
    const pending = h.invoke('tabs.close', ['88'], abort.signal);
    abort.abort();
    finish?.();
    await expect(pending).rejects.toThrow('action may have completed');
    expect(h.sendAction).toHaveBeenCalledOnce();
  });
});
