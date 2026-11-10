import { describe, expect, it, vi } from 'vitest';
import { CdpController, type CdpApi, type CdpTarget } from '../utils/cdp';

function fixture() {
  const onUserCancel = vi.fn();
  const events = new Set<
    (
      target: CdpTarget,
      method: string,
      params?: Record<string, unknown>,
    ) => void
  >();
  const detaches = new Set<(target: CdpTarget, reason: string) => void>();
  const attach = vi.fn(() => Promise.resolve());
  const detach = vi.fn(() => Promise.resolve());
  const sendCommand = vi.fn(() => Promise.resolve({ ok: true }));
  const api: CdpApi = {
    attach,
    detach,
    sendCommand,
    onEvent: {
      addListener: (listener) => {
        events.add(listener);
      },
      removeListener: (listener) => {
        events.delete(listener);
      },
    },
    onDetach: {
      addListener: (listener) => {
        detaches.add(listener);
      },
      removeListener: (listener) => {
        detaches.delete(listener);
      },
    },
  };
  const controller = new CdpController(api, onUserCancel);
  const emit = (tabId: number, method: string) => {
    for (const listener of events) listener({ tabId }, method);
  };
  const disconnect = (tabId: number, reason = 'canceled_by_user') => {
    for (const listener of detaches) listener({ tabId }, reason);
  };
  return {
    controller,
    attach,
    detach,
    sendCommand,
    emit,
    disconnect,
    events,
    detaches,
    onUserCancel,
  };
}
describe('unfiltered CDP transport', () => {
  it('exposes the entire CDP method namespace without a command allowlist', async () => {
    const h = fixture();
    for (const method of [
      'Runtime.evaluate',
      'Storage.getCookies',
      'Target.attachToTarget',
    ]) {
      await expect(
        h.controller.send(2, method, { expression: '1 + 1' }),
      ).resolves.toEqual({ ok: true });
    }
    expect(h.attach).toHaveBeenCalledOnce();
    expect(h.sendCommand).toHaveBeenCalledTimes(3);
    h.controller.close();
  });
  it('coalesces concurrent attaches for the same tab', async () => {
    const h = fixture();
    await Promise.all([
      h.controller.send(1, 'DOM.getDocument'),
      h.controller.send(1, 'Page.enable'),
    ]);
    expect(h.attach).toHaveBeenCalledOnce();
    h.controller.close();
  });
  it('releases an attachment that completes after shutdown', async () => {
    const h = fixture();
    let finishAttach: (() => void) | undefined;
    h.attach.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishAttach = resolve;
        }),
    );
    const pending = h.controller.send(9, 'Page.enable');
    h.controller.close();
    finishAttach?.();
    await expect(pending).rejects.toThrow('CDP_DISCONNECTED');
    expect(h.detach).toHaveBeenCalledWith({ tabId: 9 });
    expect(h.sendCommand).not.toHaveBeenCalled();
  });
  it('retries a failed attach and rejects invalid targets and methods', async () => {
    const h = fixture();
    h.attach.mockRejectedValueOnce(new Error('busy'));
    await expect(h.controller.send(1, 'Page.enable')).rejects.toThrow('busy');
    await expect(h.controller.send(1, 'Page.enable')).resolves.toEqual({
      ok: true,
    });
    await expect(h.controller.send(-1, 'Page.enable')).rejects.toThrow(
      'INVALID_TARGET',
    );
    await expect(h.controller.send(1, 'Not a valid method')).rejects.toThrow(
      'INVALID_ARGUMENT',
    );
    h.controller.close();
  });
  it('returns event cursors and signals when an old cursor has expired', async () => {
    const h = fixture();
    expect(await h.controller.cursor(3)).toBe('0');
    h.emit(3, 'Network.requestWillBeSent');
    expect(await h.controller.events(3, '0')).toEqual({
      events: [{ sequence: 1, method: 'Network.requestWillBeSent' }],
      nextCursor: '1',
    });
    for (let i = 0; i < 210; i++) h.emit(3, 'Network.dataReceived');
    await expect(h.controller.events(3, '0')).rejects.toThrow('STALE_REF');
    const recent = await h.controller.events(3);
    expect(recent.events).toHaveLength(200);
    expect(recent.events[0]?.sequence).toBe(12);
    expect(recent.nextCursor).toBe('211');
    await expect(h.controller.events(3, 'invalid')).rejects.toThrow(
      'INVALID_ARGUMENT',
    );
    h.controller.close();
  });
  it('invalidates event cursors after debugger disconnects', async () => {
    const h = fixture();
    expect(await h.controller.cursor(8)).toBe('0');
    h.emit(8, 'Page.frameNavigated');
    expect(await h.controller.cursor(8)).toBe('1');
    h.disconnect(8);
    expect(h.onUserCancel).toHaveBeenCalledWith(8);
    await expect(h.controller.cursor(8)).rejects.toThrow('CDP_DISCONNECTED');
    await expect(h.controller.events(8, '1')).rejects.toThrow(
      'CDP_DISCONNECTED',
    );
    h.controller.resume(8);
    expect(await h.controller.cursor(8)).toBe('0');
    await expect(h.controller.events(8, '1')).rejects.toThrow(
      'INVALID_ARGUMENT',
    );
    h.controller.close();
  });
  it('filters detached tab events and validates cursors and command parameters', async () => {
    const h = fixture();
    h.emit(12, 'Network.requestWillBeSent');
    expect(await h.controller.cursor(12)).toBe('0');
    for (const listener of h.events)
      listener({ tabId: 12 }, 'Network.requestWillBeSent', { requestId: 'x' });
    expect(await h.controller.events(12)).toEqual({
      events: [
        {
          sequence: 1,
          method: 'Network.requestWillBeSent',
          params: { requestId: 'x' },
        },
      ],
      nextCursor: '1',
    });
    await expect(
      h.controller.events(12, '999999999999999999999999'),
    ).rejects.toThrow('INVALID_ARGUMENT');
    await expect(h.controller.events(12, '2')).rejects.toThrow(
      'INVALID_ARGUMENT',
    );
    await expect(
      h.controller.send(
        12,
        'Page.enable',
        [] as unknown as Record<string, unknown>,
      ),
    ).rejects.toThrow('INVALID_ARGUMENT');
    h.controller.close();
  });
  it('handles repeated shutdown and detach of a tab without an active debugger', async () => {
    const h = fixture();
    await h.controller.detach(2);
    expect(h.detach).not.toHaveBeenCalled();
    await h.controller.send(2, 'Page.enable');
    h.detach.mockRejectedValueOnce(new Error('browser closed'));
    h.controller.close();
    h.controller.close();
    await Promise.resolve();
    expect(h.detach).toHaveBeenCalledOnce();
  });
  it('reattaches after browser-initiated detach and stops on close', async () => {
    const h = fixture();
    await h.controller.send(5, 'Page.enable');
    h.disconnect(5, 'target_closed');
    await h.controller.send(5, 'Page.enable');
    expect(h.attach).toHaveBeenCalledTimes(2);
    await h.controller.detach(5);
    expect(h.detach).toHaveBeenCalledOnce();
    h.controller.close();
    expect(h.events.size).toBe(0);
    expect(h.detaches.size).toBe(0);
    await expect(h.controller.send(5, 'Page.enable')).rejects.toThrow(
      'CDP_DISCONNECTED',
    );
  });
  it('prevents automatic reattachment after the user presses Cancel', async () => {
    const h = fixture();
    await h.controller.send(21, 'Page.enable');
    h.disconnect(21);
    await expect(
      h.controller.send(21, 'Input.dispatchMouseEvent'),
    ).rejects.toThrow('CDP_DISCONNECTED');
    expect(h.attach).toHaveBeenCalledOnce();
    h.controller.resume(21);
    await h.controller.send(21, 'Page.enable');
    expect(h.attach).toHaveBeenCalledTimes(2);
    h.disconnect(21, 'target_closed');
    expect(h.onUserCancel).toHaveBeenCalledExactlyOnceWith(21);
    expect(() => {
      h.controller.resume(-1);
    }).toThrow('INVALID_TARGET');
    h.controller.close();
    expect(() => {
      h.controller.resume(21);
    }).toThrow('CDP_DISCONNECTED');
  });
});
