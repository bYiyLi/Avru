import { afterEach, describe, expect, it, vi } from 'vitest';
import { Executions } from '../src/executions';
import type { Connections } from '../src/connections';
import type { ClaimRegistry } from '../src/claims';
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

interface Deferred {
  finish: (result: Result) => void;
  reject: (error: Error) => void;
  cancel: ReturnType<typeof vi.fn>;
}
const active: Executions[] = [];
function fixture() {
  const deferred: Deferred[] = [];
  const tabs = [
    { id: 7, title: 'Task', url: 'https://example.test/', active: true },
    { id: 8, title: 'Next', url: 'https://example.test/next', active: false },
  ];
  let generation = 1;
  let connected = true;
  let failDiscovery = false;
  worker.run.mockReset();
  worker.run.mockImplementation(() => {
    let finish!: (result: Result) => void;
    let reject!: (error: Error) => void;
    const result = new Promise<Result>((resolve, fail) => {
      finish = resolve;
      reject = fail;
    });
    const task = { finish, reject, cancel: vi.fn() };
    deferred.push(task);
    return { result, cancel: task.cancel };
  });
  const connections = {
    browsers: () => {
      if (failDiscovery) throw new Error('temporary browser metadata failure');
      return [{ id: 'browser-a', connected, tabs }];
    },
    generation: () => generation,
  } as unknown as Connections;
  const manager = new Executions(connections);
  active.push(manager);
  const internal = manager as unknown as {
    watcher: NodeJS.Timeout;
    entries: Map<string, Entry>;
    claims: ClaimRegistry;
    watchTargets: () => void;
    backstop: (entry: Entry) => void;
  };
  return {
    manager,
    worker,
    deferred,
    tabs,
    internal,
    disconnect: () => {
      connected = false;
    },
    setGeneration: (next: number) => {
      generation = next;
    },
    failDiscovery: () => {
      failDiscovery = true;
    },
  };
}
async function flush() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
afterEach(() => {
  for (const manager of active.splice(0)) manager.close();
  worker.run.mockReset();
  worker.close.mockReset();
});

describe('serialized execution queue and target races', () => {
  it('fails a queued tab whose browser disappeared before it starts', async () => {
    const h = fixture();
    const first = h.manager.run('owner', 'return true;');
    const waiting = h.manager.run(
      'owner',
      'return await browser.tab.title();',
      { browserId: 'browser-a', tabId: 7 },
    );
    h.disconnect();
    h.deferred[0]?.finish({ status: 'completed', json: 'true' });
    await flush();
    expect(h.manager.get('owner', first.executionId).state).toBe('succeeded');
    expect(h.manager.get('owner', waiting.executionId)).toMatchObject({
      state: 'cancelled',
      error: { code: 'TAB_CLOSED' },
    });
    expect(worker.run).toHaveBeenCalledOnce();
    expect(h.manager.isClaimed('browser-a', 7)).toBe(false);
  });

  it('fails a queued task if its browser reconnects with another generation', async () => {
    const h = fixture();
    h.manager.run('owner', 'return true;');
    const waiting = h.manager.run(
      'owner',
      'return await browser.tab.title();',
      { browserId: 'browser-a', tabId: 7 },
    );
    h.setGeneration(2);
    h.deferred[0]?.finish({ status: 'completed', json: 'true' });
    await flush();
    expect(h.manager.get('owner', waiting.executionId)).toMatchObject({
      state: 'failed',
      error: { code: 'INVALID_TARGET' },
    });
    expect(worker.run).toHaveBeenCalledOnce();
  });

  it('does not execute a queued task if its execution claim is lost', async () => {
    const h = fixture();
    h.manager.run('owner', 'return true;');
    const waiting = h.manager.run(
      'owner',
      'return await browser.tab.title();',
      { browserId: 'browser-a', tabId: 7 },
    );
    h.internal.claims.releaseByExecution(waiting.executionId);
    h.deferred[0]?.finish({ status: 'completed', json: 'true' });
    await flush();
    expect(h.manager.get('owner', waiting.executionId)).toMatchObject({
      state: 'failed',
      error: { code: 'TAB_NOT_CLAIMED' },
    });
    expect(worker.run).toHaveBeenCalledOnce();
  });

  it('continues to the next queued task after a target mismatch', async () => {
    const h = fixture();
    h.manager.run('owner', 'return true;');
    const rejected = h.manager.run('owner', 'return 7;', {
      browserId: 'browser-a',
      tabId: 7,
    });
    const ready = h.manager.run('owner', 'return 42;');
    h.internal.claims.releaseByExecution(rejected.executionId);
    h.deferred[0]?.finish({ status: 'completed', json: 'true' });
    await flush();
    expect(h.manager.get('owner', rejected.executionId).state).toBe('failed');
    expect(h.manager.get('owner', ready.executionId).state).toBe('running');
    h.deferred[1]?.finish({ status: 'completed', json: '42' });
    await flush();
    expect(h.manager.get('owner', ready.executionId)).toMatchObject({
      state: 'succeeded',
      result: 42,
    });
  });

  it('recovers queue progress after a runner cannot launch the next task', async () => {
    const h = fixture();
    h.manager.run('owner', 'return true;');
    const failed = h.manager.run('owner', 'return 2;');
    const next = h.manager.run('owner', 'return 3;');
    worker.run.mockImplementationOnce(() => {
      throw new Error('queue full');
    });
    h.deferred[0]?.finish({ status: 'completed', json: 'true' });
    await flush();
    expect(h.manager.get('owner', failed.executionId)).toMatchObject({
      state: 'failed',
      error: { code: 'QUEUE_FULL' },
    });
    expect(h.manager.get('owner', next.executionId).state).toBe('running');
    h.deferred[1]?.finish({ status: 'completed', json: '3' });
    await flush();
    expect(h.manager.get('owner', next.executionId).result).toBe(3);
  });

  it('marks a running task unknown if the backstop fires before a runner result', () => {
    const h = fixture();
    const task = h.manager.run('owner', 'return true;');
    const entry = h.internal.entries.get(task.executionId);
    if (!entry) throw new Error('missing task entry');
    h.internal.backstop(entry);
    expect(h.manager.get('owner', task.executionId)).toMatchObject({
      state: 'unknown',
      error: { code: 'UNKNOWN_RESULT' },
    });
    expect(h.deferred[0]?.cancel).toHaveBeenCalledOnce();
    h.deferred[0]?.finish({ status: 'completed', json: 'true' });
  });

  it('handles a browser closing while a running task awaits the host', async () => {
    const h = fixture();
    const task = h.manager.run('owner', 'return await browser.tab.title();', {
      browserId: 'browser-a',
      tabId: 7,
    });
    const entry = h.internal.entries.get(task.executionId);
    if (!entry) throw new Error('missing task entry');
    entry.inFlight = 1;
    h.tabs.splice(0, 1);
    h.internal.watchTargets();
    expect(h.deferred[0]?.cancel).toHaveBeenCalledOnce();
    h.deferred[0]?.finish({ status: 'cancelled' });
    await flush();
    expect(h.manager.get('owner', task.executionId)).toMatchObject({
      state: 'unknown',
      error: { code: 'UNKNOWN_RESULT' },
    });
  });

  it('does not let browser metadata failures crash the target watcher', () => {
    const h = fixture();
    h.manager.run('owner', 'return await browser.tab.title();', {
      browserId: 'browser-a',
      tabId: 7,
    });
    h.failDiscovery();
    expect(() => {
      h.internal.watchTargets();
    }).not.toThrow();
    expect(h.deferred[0]?.cancel).not.toHaveBeenCalled();
  });

  it('rejects invalid claims and preserves owner isolation on cancel/get', async () => {
    const h = fixture();
    for (const [browserId, tabId, url] of [
      ['', 7, undefined],
      ['browser-a', -1, undefined],
      ['browser-a', 7, 'not an URL'],
    ] as const) {
      expect(() =>
        h.manager.claimTab('owner', browserId, tabId, {
          ...(url ? { url } : {}),
        }),
      ).toThrow();
    }
    const task = h.manager.run('owner', 'return 42;');
    expect(() => h.manager.get('another', task.executionId)).toThrow(
      'EXECUTION_NOT_FOUND',
    );
    await expect(h.manager.cancel('another', task.executionId)).rejects.toThrow(
      'EXECUTION_NOT_FOUND',
    );
    h.deferred[0]?.finish({ status: 'completed', json: '42' });
    await flush();
    expect(await h.manager.cancel('owner', task.executionId)).toMatchObject({
      state: 'succeeded',
      pendingStepsCancelled: 0,
    });
  });
});
