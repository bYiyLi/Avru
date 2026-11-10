import { afterEach, describe, expect, it, vi } from 'vitest';
import { Executions } from '../src/executions';
import type { Connections } from '../src/connections';
import type { ExecutionAudit } from '../src/execution-audit';
import type { Entry } from '../src/execution-types';
import type { Result } from '../../../packages/runner/src/protocol';

const worker = vi.hoisted(() => ({
  run: vi.fn(),
  close: vi.fn(),
}));
vi.mock('../../../packages/runner/dist/supervisor.js', () => ({
  Runner: class {
    run(...args: unknown[]) {
      return worker.run(...args) as {
        result: Promise<Result>;
        cancel: () => void;
      };
    }
    close() {
      worker.close();
    }
  },
}));

interface PendingTask {
  complete: (result: Result) => void;
  cancel: ReturnType<typeof vi.fn>;
}
const managers: Executions[] = [];
function fixture(audit?: ExecutionAudit) {
  worker.run.mockReset();
  const pending: PendingTask[] = [];
  worker.run.mockImplementation(() => {
    let complete!: (result: Result) => void;
    const result = new Promise<Result>((resolve) => {
      complete = resolve;
    });
    const task = { complete, cancel: vi.fn() };
    pending.push(task);
    return { result, cancel: task.cancel };
  });
  const tabs = [
    { id: 7, title: 'Task', url: 'https://example.test/', active: true },
  ];
  const sendAction = vi.fn(() => Promise.resolve({ ok: true }));
  const connections = {
    browsers: () => [{ id: 'browser-a', connected: true, tabs }],
    generation: () => 1,
    sendAction,
  } as unknown as Connections;
  const manager = new Executions(connections, audit);
  managers.push(manager);
  const internal = manager as unknown as {
    entries: Map<string, Entry>;
    watchTargets: () => void;
    backstop: (entry: Entry) => void;
    settle: (entry: Entry, result: Result) => void;
  };
  return { manager, pending, internal, tabs, sendAction };
}
const step = () => ({
  stepId: 's1',
  action: 'tabs.list',
  durationMs: 3,
  result: 'ok',
});
const wait = async () => {
  await new Promise<void>((resolve) => setImmediate(resolve));
};
afterEach(() => {
  vi.useRealTimers();
  for (const manager of managers.splice(0)) manager.close();
  worker.run.mockReset();
  worker.close.mockReset();
});

describe('execution record snapshots and cancellation races', () => {
  it('stops the matching task when the debugger is cancelled and signals its visual lifecycle', async () => {
    const h = fixture();
    const target = { browserId: 'browser-a', tabId: 7 };
    const task = h.manager.run('owner', 'return 1;', target);
    expect(h.sendAction).toHaveBeenCalledWith(
      expect.objectContaining({
        ...target,
        method: 'tab.execution.start',
        args: [task.executionId, 'Avru'],
      }),
    );
    h.manager.interruptByUser('other-profile', 7);
    h.manager.interruptByUser('browser-a', 8);
    expect(h.pending[0]?.cancel).not.toHaveBeenCalled();
    h.manager.interruptByUser('browser-a', 7);
    expect(h.pending[0]?.cancel).toHaveBeenCalledOnce();
    h.pending[0]?.complete({ status: 'cancelled' });
    await wait();
    expect(h.manager.get('owner', task.executionId)).toMatchObject({
      state: 'cancelled',
      error: { code: 'USER_STOPPED' },
    });
    expect(h.sendAction).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'tab.execution.finish',
        args: [task.executionId, 'cancelled'],
      }),
    );
    h.manager.interruptByUser('browser-a', 7);
    expect(h.pending[0]?.cancel).toHaveBeenCalledOnce();
  });

  it('preserves an unknown outcome when debugger cancellation interrupted an in-flight call', async () => {
    const h = fixture();
    const task = h.manager.run('owner', 'return 1;', {
      browserId: 'browser-a',
      tabId: 7,
    });
    const entry = h.internal.entries.get(task.executionId);
    if (!entry) throw new Error('missing task');
    entry.inFlight = 1;
    h.manager.interruptByUser('browser-a', 7);
    h.pending[0]?.complete({ status: 'cancelled' });
    await wait();
    expect(h.manager.get('owner', task.executionId)).toMatchObject({
      state: 'unknown',
      error: { code: 'UNKNOWN_RESULT' },
    });
  });
  it('keeps completed steps in an immediate cancellation of a queued entry', async () => {
    const h = fixture();
    h.manager.run('owner', 'return 1;');
    const next = h.manager.run('owner', 'return 2;');
    const entry = h.internal.entries.get(next.executionId);
    if (!entry) throw new Error('missing queued task');
    entry.steps.push(step());
    expect(await h.manager.cancel('owner', next.executionId)).toMatchObject({
      state: 'cancelled',
      pendingStepsCancelled: 0,
      completedSteps: [step()],
    });
    expect(h.manager.get('owner', next.executionId).steps).toEqual([step()]);
  });

  it('reports completed steps when cancel arrives during a running execution', async () => {
    const h = fixture();
    const task = h.manager.run('owner', 'return 1;');
    const entry = h.internal.entries.get(task.executionId);
    if (!entry) throw new Error('missing running task');
    entry.steps.push(step());
    h.pending[0]?.cancel.mockImplementation(() => {
      h.pending[0]?.complete({ status: 'cancelled' });
    });
    expect(await h.manager.cancel('owner', task.executionId)).toMatchObject({
      state: 'cancelled',
      completedSteps: [step()],
      pendingStepsCancelled: 0,
    });
  });

  it('preserves final steps when cancelling an already completed task', async () => {
    const h = fixture();
    const task = h.manager.run('owner', 'return 1;');
    const entry = h.internal.entries.get(task.executionId);
    if (!entry) throw new Error('missing running task');
    entry.steps.push(step());
    h.pending[0]?.complete({ status: 'completed', json: '1' });
    await wait();
    expect(await h.manager.cancel('owner', task.executionId)).toMatchObject({
      state: 'succeeded',
      completedSteps: [step()],
      pendingStepsCancelled: 0,
    });
    expect(h.manager.get('owner', task.executionId).result).toBe(1);
  });

  it('does not override a terminal result with duplicate late runner or backstop results', async () => {
    const h = fixture();
    const task = h.manager.run('owner', 'return 1;');
    const entry = h.internal.entries.get(task.executionId);
    if (!entry) throw new Error('missing running task');
    h.pending[0]?.complete({ status: 'completed', json: '1' });
    await wait();
    h.internal.settle(entry, { status: 'completed', json: '9000' });
    h.internal.backstop(entry);
    expect(h.manager.get('owner', task.executionId)).toMatchObject({
      state: 'succeeded',
      result: 1,
    });
  });

  it('backstops a non-cooperative runner using the daemon wall clock', async () => {
    vi.useFakeTimers();
    const h = fixture();
    const task = h.manager.run('owner', 'return 1;', undefined, {
      timeoutMs: 5,
    });
    await vi.advanceTimersByTimeAsync(5006);
    expect(h.manager.get('owner', task.executionId)).toMatchObject({
      state: 'unknown',
      error: { code: 'UNKNOWN_RESULT' },
    });
    expect(h.pending[0]?.cancel).toHaveBeenCalledOnce();
  });
});

describe('execution claim and registry cleanup boundaries', () => {
  it('validates claim fields before reservation without changing browser state', () => {
    const h = fixture();
    for (const title of [99, 'x'.repeat(257)]) {
      expect(() =>
        h.manager.claimTab('owner', 'browser-a', 7, {
          title: title as string,
        }),
      ).toThrow('INVALID_ARGUMENT');
    }
    expect(() =>
      h.manager.claimTab('owner', 'browser-a', 7, {
        url: 'not-a-URL',
      }),
    ).toThrow('INVALID_ARGUMENT');
    expect(() =>
      h.manager.claimTab('owner', 'browser-a', 7, {
        url: 42 as unknown as string,
      }),
    ).toThrow('INVALID_ARGUMENT');
    expect(() => h.manager.claimTab('owner', 'browser-a', 99)).toThrow(
      'INVALID_TARGET',
    );
    expect(h.manager.isClaimed('browser-a', 7)).toBe(false);
  });

  it('cancels a queued task when the watch detects the target tab is already gone', () => {
    const h = fixture();
    h.manager.run('owner', 'return 1;');
    const queued = h.manager.run('owner', 'return 2;', {
      browserId: 'browser-a',
      tabId: 7,
    });
    h.tabs.splice(0);
    h.internal.watchTargets();
    expect(h.manager.get('owner', queued.executionId)).toMatchObject({
      state: 'cancelled',
      error: { code: 'TAB_CLOSED' },
    });
  });

  it('distinguishes tab-closed cancellation from an explicit user cancellation', async () => {
    const h = fixture();
    const task = h.manager.run('owner', 'return 1;', {
      browserId: 'browser-a',
      tabId: 7,
    });
    h.tabs.splice(0);
    h.internal.watchTargets();
    h.pending[0]?.complete({ status: 'cancelled' });
    await wait();
    expect(h.manager.get('owner', task.executionId)).toMatchObject({
      state: 'cancelled',
      error: { code: 'TAB_CLOSED' },
    });
  });

  it('prunes old terminal entries while preserving a newly submitted task', async () => {
    const h = fixture();
    let oldest: string | undefined;
    for (let index = 0; index < 128; index++) {
      const task = h.manager.run('owner', 'return 1;');
      oldest ??= task.executionId;
      h.pending[index]?.complete({ status: 'completed', json: '1' });
      await wait();
    }
    const current = h.manager.run('owner', 'return 2;');
    expect(() => h.manager.get('owner', oldest ?? '')).toThrow(
      'EXECUTION_NOT_FOUND',
    );
    expect(h.manager.get('owner', current.executionId).state).toBe('running');
    h.pending[128]?.complete({ status: 'completed', json: '2' });
    await wait();
    expect(h.manager.get('owner', current.executionId).result).toBe(2);
  });

  it('does not silently accept a missing script', () => {
    const h = fixture();
    expect(() => h.manager.run('owner', ' \n ')).toThrow('INVALID_ARGUMENT');
    expect(worker.run).not.toHaveBeenCalled();
    expect(h.manager.browsers()).toHaveLength(1);
  });
});
