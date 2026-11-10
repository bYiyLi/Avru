import { describe, expect, it, vi } from 'vitest';
import { executeCdpAction, validCdpArguments } from '../src/cdp-bridge';
import type { Connections } from '../src/connections';

function fixture() {
  const generation = vi.fn(() => 3);
  const sendAction = vi.fn<() => Promise<{ ok: true; value: unknown }>>(() =>
    Promise.resolve({ ok: true, value: { cookies: [] } }),
  );
  const connections = { generation, sendAction } as unknown as Pick<
    Connections,
    'generation' | 'sendAction'
  >;
  const target = { browserId: 'browser-b', tabId: 7, generation: 3 };
  const signal = new AbortController().signal;
  return { connections, target, signal, generation, sendAction };
}
describe('CDP host bridge', () => {
  it('passes arbitrary CDP domains through without a command whitelist', async () => {
    const h = fixture();
    const result = await executeCdpAction(h.connections, {
      target: h.target,
      method: 'cdp.send',
      args: ['Storage.getCookies', { browserContextId: 'ctx' }],
      signal: h.signal,
    });
    expect(result).toEqual({ cookies: [] });
    expect(h.sendAction).toHaveBeenCalledWith({
      browserId: 'browser-b',
      tabId: 7,
      generation: 3,
      method: 'cdp.send',
      args: ['Storage.getCookies', { browserContextId: 'ctx' }],
    });
  });
  it('rejects stale targets without dispatching to a different connection', async () => {
    const h = fixture();
    h.generation.mockReturnValue(4);
    await expect(
      executeCdpAction(h.connections, {
        target: h.target,
        method: 'cdp.cursor',
        args: [],
        signal: h.signal,
      }),
    ).rejects.toThrow('INVALID_TARGET');
    expect(h.sendAction).not.toHaveBeenCalled();
  });
  it('does not issue new commands after cancellation', async () => {
    const h = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      executeCdpAction(h.connections, {
        target: h.target,
        method: 'cdp.cursor',
        args: [],
        signal: controller.signal,
      }),
    ).rejects.toThrow('CANCELLED');
    expect(h.sendAction).not.toHaveBeenCalled();
  });
  it('does not silently retry failed commands', async () => {
    const h = fixture();
    h.sendAction.mockResolvedValueOnce({
      ok: false as const,
      error: { code: 'CDP_DISCONNECTED', message: 'debugger closed' },
    } as never);
    await expect(
      executeCdpAction(h.connections, {
        target: h.target,
        method: 'cdp.send',
        args: ['Page.reload'],
        signal: h.signal,
      }),
    ).rejects.toThrow('CDP_DISCONNECTED');
    expect(h.sendAction).toHaveBeenCalledTimes(1);
  });
  it('validates only argument shape, not CDP method identity', () => {
    expect(
      validCdpArguments('cdp.send', ['Experimental.unknownCommand', {}]),
    ).toBe(true);
    expect(validCdpArguments('cdp.send', ['', {}])).toBe(false);
    expect(validCdpArguments('cdp.events', ['1'])).toBe(true);
    expect(validCdpArguments('cdp.events', ['not-a-cursor'])).toBe(false);
    expect(validCdpArguments('cdp.cursor', [1])).toBe(false);
  });
  it('rejects missing targets and malformed command arguments without dispatching', async () => {
    const h = fixture();
    await expect(
      executeCdpAction(h.connections, {
        method: 'cdp.send',
        args: ['Page.reload'],
        signal: h.signal,
      }),
    ).rejects.toThrow('INVALID_TARGET');
    await expect(
      executeCdpAction(h.connections, {
        target: h.target,
        method: 'cdp.send',
        args: [['bad']],
        signal: h.signal,
      }),
    ).rejects.toThrow('INVALID_ARGUMENT');
    expect(h.sendAction).not.toHaveBeenCalled();
  });
  it('classifies cancellation after a command was dispatched as unknown', async () => {
    const h = fixture();
    let finish: ((value: { ok: true; value: unknown }) => void) | undefined;
    h.sendAction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new AbortController();
    const pending = executeCdpAction(h.connections, {
      target: h.target,
      method: 'cdp.send',
      args: ['Page.reload'],
      signal: controller.signal,
    });
    controller.abort();
    finish?.({ ok: true, value: { done: true } });
    await expect(pending).rejects.toThrow('UNKNOWN_RESULT');
    expect(h.sendAction).toHaveBeenCalledOnce();
  });
  it('covers both event cursor forms and malformed CDP parameter shapes', () => {
    expect(validCdpArguments('cdp.events', [])).toBe(true);
    expect(validCdpArguments('cdp.events', ['0', 'extra'])).toBe(false);
    expect(validCdpArguments('cdp.send', ['Page.reload', null])).toBe(false);
    expect(validCdpArguments('cdp.send', ['Page.reload', []])).toBe(false);
    expect(validCdpArguments('cdp.send', ['Page.reload', {}])).toBe(true);
    expect(validCdpArguments('cdp.send', ['Page.reload', {}, 3])).toBe(false);
    expect(validCdpArguments('cdp.send', ['Not a command'])).toBe(false);
    expect(validCdpArguments('cdp.send', [])).toBe(false);
  });
});
