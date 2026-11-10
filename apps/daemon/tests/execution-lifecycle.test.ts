import { describe, expect, it, vi } from 'vitest';
import type { Connections } from '../src/connections';
import { createExecutionEntry } from '../src/execution-types';
import type { Entry } from '../src/execution-types';
import {
  interruptExecution,
  notifyExecutionVisual,
} from '../src/execution-lifecycle';

function fixture() {
  const target = { browserId: 'browser-a', tabId: 7, generation: 3 };
  const entry = createExecutionEntry({
    owner: 'owner-a',
    source: 'return 1',
    target,
    timeoutMs: 60_000,
    limits: { maxOutputBytes: 64_000, maxBridgeCalls: 30 },
  });
  const cancel = vi.fn();
  entry.runner = { cancel } as unknown as NonNullable<Entry['runner']>;
  const sendAction = vi.fn<Connections['sendAction']>(() =>
    Promise.resolve({ ok: true as const }),
  );
  const connections = { sendAction } as unknown as Connections;
  return { target, entry, cancel, sendAction, connections };
}

describe('debugger cancellation is bounded to the selected task', () => {
  it('ignores absent or already settled executions', () => {
    const h = fixture();
    interruptExecution(null, 'browser-a', 7);
    h.entry.settled = true;
    interruptExecution(h.entry, 'browser-a', 7);
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it('does not cross browser profile or tab identity boundaries', () => {
    const h = fixture();
    interruptExecution(h.entry, 'other-profile', 7);
    interruptExecution(h.entry, 'browser-a', 8);
    expect(h.cancel).not.toHaveBeenCalled();
    h.entry.target = undefined;
    interruptExecution(h.entry, 'browser-a', 7);
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it('cancels an idle-running execution with an explicit user-stop cause', () => {
    const h = fixture();
    interruptExecution(h.entry, 'browser-a', 7);
    expect(h.entry.cancelReason).toBe('USER_STOPPED');
    expect(h.entry.uncertainEffect).toBeUndefined();
    expect(h.cancel).toHaveBeenCalledExactlyOnceWith();
  });

  it('preserves an unknown effect if browser work was in flight', () => {
    const h = fixture();
    h.entry.inFlight = 2;
    interruptExecution(h.entry, 'browser-a', 7);
    expect(h.entry.uncertainEffect).toBe(true);
    expect(h.entry.cancelReason).toBe('USER_STOPPED');
    expect(h.cancel).toHaveBeenCalledOnce();
  });

  it('does not require a runner if the task has not started', () => {
    const h = fixture();
    delete h.entry.runner;
    expect(() => {
      interruptExecution(h.entry, 'browser-a', 7);
    }).not.toThrow();
    expect(h.entry.cancelReason).toBe('USER_STOPPED');
  });
});

describe('asynchronous cosmetic task lifecycle', () => {
  it('emits start and finish signals against the exact task target and generation', () => {
    const h = fixture();
    h.entry.taskName = 'Research';
    notifyExecutionVisual(h.connections, h.entry, 'start');
    expect(h.sendAction).toHaveBeenCalledWith({
      ...h.target,
      method: 'tab.execution.start',
      args: [h.entry.id, 'Research'],
    });
    h.entry.state = 'succeeded';
    notifyExecutionVisual(h.connections, h.entry, 'finish');
    expect(h.sendAction).toHaveBeenLastCalledWith({
      ...h.target,
      method: 'tab.execution.finish',
      args: [h.entry.id, 'succeeded'],
    });
  });

  it('uses a stable default name and never sends private script source', () => {
    const h = fixture();
    h.entry.source = 'secret source that should never be sent';
    notifyExecutionVisual(h.connections, h.entry, 'start');
    const call = h.sendAction.mock.calls[0]?.[0] as unknown as Record<
      string,
      unknown
    >;
    expect(call).toMatchObject({ args: [h.entry.id, 'Avru'] });
    expect(JSON.stringify(call)).not.toContain('secret source');
  });

  it('does not dispatch when no tab is selected or no sendAction port exists', () => {
    const h = fixture();
    h.entry.target = undefined;
    notifyExecutionVisual(h.connections, h.entry, 'start');
    expect(h.sendAction).not.toHaveBeenCalled();
    h.entry.target = h.target;
    notifyExecutionVisual({} as Connections, h.entry, 'start');
    expect(h.sendAction).not.toHaveBeenCalled();
  });

  it('does not elevate a disconnected visual overlay to a failed execution', async () => {
    const h = fixture();
    h.sendAction.mockRejectedValueOnce(new Error('extension unavailable'));
    notifyExecutionVisual(h.connections, h.entry, 'start');
    await Promise.resolve();
    await Promise.resolve();
    expect(h.entry.cancelReason).toBeUndefined();
    expect(h.cancel).not.toHaveBeenCalled();
  });
});
