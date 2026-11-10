import { describe, expect, it, vi } from 'vitest';
import { ClaimRegistry } from '../src/claims';
import type { Connections } from '../src/connections';
import { createExecutionEntry } from '../src/execution-types';
import { performTabAction } from '../src/execution-bridge-routes';

const target = { browserId: 'browser-a', tabId: 7, generation: 3 };
function fixture() {
  const entry = createExecutionEntry({
    owner: 'owner-a',
    source: 'return 1;',
    target,
    timeoutMs: 60_000,
    limits: { maxOutputBytes: 65_536, maxBridgeCalls: 32 },
  });
  const claims = new ClaimRegistry();
  const sendAction = vi.fn<Connections['sendAction']>(() =>
    Promise.resolve({ ok: true as const, value: { changed: true } }),
  );
  const liveTab = vi.fn(() => ({
    title: 'Current page',
    url: 'https://example.test/',
    generation: 3,
  }));
  const controller = new AbortController();
  const request = {
    entry,
    target,
    method: 'cdp.send',
    args: ['Page.navigate'] as unknown[],
    signal: controller.signal,
    acquireLock: true,
  };
  const deps = {
    connections: { sendAction } as unknown as Pick<Connections, 'sendAction'>,
    claims,
    liveTab,
  };
  const run = (changes: Partial<typeof request> = {}) =>
    performTabAction(deps, { ...request, ...changes });
  return { entry, claims, sendAction, liveTab, controller, request, run, deps };
}

describe('authenticated browser action forwarding and exact-generation locking', () => {
  it('forwards the full CDP action without a command allowlist and atomically acquires the tab', async () => {
    const h = fixture();
    await expect(
      h.run({ method: 'cdp.send', args: ['Network.enable', {}] }),
    ).resolves.toEqual({ changed: true });
    expect(h.liveTab).toHaveBeenCalledWith('browser-a', 7);
    expect(h.sendAction).toHaveBeenCalledWith({
      ...target,
      method: 'cdp.send',
      args: ['Network.enable', {}],
    });
    expect(h.claims.get('browser-a', 7)).toMatchObject({
      owner: 'owner-a',
      executionId: h.entry.id,
      generation: 3,
      title: 'Current page',
    });
  });

  it('reuses a claim owned by this execution rather than declaring a conflict', async () => {
    const h = fixture();
    await h.run();
    await h.run({ method: 'tab.snapshot', args: [] });
    expect(h.sendAction).toHaveBeenCalledTimes(2);
    expect(h.claims.size()).toBe(1);
  });

  it('binds a same-owner unconsumed claim to this execution on its first action', async () => {
    const h = fixture();
    h.claims.claim('owner-a', target);
    expect(h.claims.get('browser-a', 7)?.executionId).toBeUndefined();
    await h.run({ method: 'tab.title', args: [] });
    expect(h.claims.get('browser-a', 7)?.executionId).toBe(h.entry.id);
  });

  it('rejects other owners and different executions before dispatch', async () => {
    const h = fixture();
    h.claims.claim('other-owner', target);
    await expect(h.run()).rejects.toThrow('tab is in use');
    expect(h.sendAction).not.toHaveBeenCalled();
    h.claims.release('browser-a', 7);
    h.claims.claim('owner-a', target);
    h.claims.bind('other-task', 'owner-a', 'browser-a', 7);
    await expect(h.run()).rejects.toThrow('tab is in use');
    expect(h.sendAction).not.toHaveBeenCalled();
  });

  it('rejects stale existing claims even when the OAuth owner is the same', async () => {
    const h = fixture();
    h.claims.claim('owner-a', { ...target, generation: 2 });
    await expect(h.run()).rejects.toThrow('stale browser connection');
    expect(h.sendAction).not.toHaveBeenCalled();
  });

  it('can read public context without taking an ownership lock', async () => {
    const h = fixture();
    await h.run({ method: 'tab.snapshot', args: [], acquireLock: false });
    expect(h.claims.get('browser-a', 7)).toBeUndefined();
    expect(h.sendAction).toHaveBeenCalledOnce();
  });

  it('fails on a missing tab or changed connection generation', async () => {
    const h = fixture();
    h.liveTab.mockReturnValueOnce(undefined as never);
    await expect(h.run()).rejects.toThrow('unavailable or stale');
    h.liveTab.mockReturnValueOnce({
      title: 'New',
      url: 'https://example.test/',
      generation: 4,
    });
    await expect(h.run()).rejects.toThrow('unavailable or stale');
    expect(h.sendAction).not.toHaveBeenCalled();
    expect(h.claims.size()).toBe(0);
  });
});

describe('cancellation and unknown browser side effects', () => {
  it('aborts before resolving a target without sending any action', async () => {
    const h = fixture();
    h.controller.abort();
    await expect(h.run()).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(h.liveTab).not.toHaveBeenCalled();
    expect(h.sendAction).not.toHaveBeenCalled();
  });

  it('returns cancelled for a read that was interrupted after the response', async () => {
    const h = fixture();
    h.sendAction.mockImplementationOnce(() => {
      h.controller.abort();
      return Promise.resolve({ ok: true as const, value: { changed: true } });
    });
    await expect(h.run({ method: 'tab.snapshot' })).rejects.toMatchObject({
      code: 'CANCELLED',
    });
  });

  it('marks a write unknown when cancellation races with its acknowledged result', async () => {
    const h = fixture();
    h.sendAction.mockImplementationOnce(() => {
      h.controller.abort();
      return Promise.resolve({ ok: true as const, value: { changed: true } });
    });
    await expect(h.run()).rejects.toMatchObject({
      code: 'UNKNOWN_RESULT',
      message: 'action may have completed',
    });
  });

  it('classifies CDP and tab write transport timeouts as unknown', async () => {
    const h = fixture();
    h.sendAction.mockResolvedValueOnce({
      ok: false,
      error: { code: 'TIMEOUT', message: 'slow' },
    });
    await expect(h.run()).rejects.toMatchObject({ code: 'UNKNOWN_RESULT' });
    h.sendAction.mockResolvedValueOnce({
      ok: false,
      error: { code: 'EXTENSION_OFFLINE', message: 'gone' },
    });
    await expect(h.run({ method: 'tabs.close' })).rejects.toMatchObject({
      code: 'UNKNOWN_RESULT',
    });
  });

  it('keeps read-only transport failures as their precise codes', async () => {
    const h = fixture();
    h.sendAction.mockResolvedValueOnce({
      ok: false,
      error: { code: 'TIMEOUT', message: 'slow' },
    });
    await expect(h.run({ method: 'tab.snapshot' })).rejects.toMatchObject({
      code: 'TIMEOUT',
      message: 'slow',
    });
    h.sendAction.mockResolvedValueOnce({
      ok: false,
      error: { code: 'EXTENSION_OFFLINE', message: 'offline' },
    });
    await expect(h.run({ method: 'tab.getJsDialog' })).rejects.toMatchObject({
      code: 'EXTENSION_OFFLINE',
      message: 'offline',
    });
  });

  it('propagates explicit browser rejection without inventing side effects', async () => {
    const h = fixture();
    h.sendAction.mockResolvedValueOnce({
      ok: false,
      error: { code: 'PAGE_NOT_ACCESSIBLE', message: 'blocked' },
    });
    await expect(h.run()).rejects.toMatchObject({
      code: 'PAGE_NOT_ACCESSIBLE',
      message: 'blocked',
    });
  });
});
