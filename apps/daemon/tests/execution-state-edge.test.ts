import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Connections } from '../src/connections';
import type { ExecutionAudit } from '../src/execution-audit';
import { Executions } from '../src/executions';
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

interface DeferredTask {
  complete: (result: Result) => void;
  fail: (reason: Error) => void;
  cancel: ReturnType<typeof vi.fn>;
}
const instances: Executions[] = [];
function fixture(audit?: ExecutionAudit) {
  worker.run.mockReset();
  const pending: DeferredTask[] = [];
  worker.run.mockImplementation(() => {
    let complete!: (result: Result) => void;
    let fail!: (reason: Error) => void;
    const result = new Promise<Result>((resolve, reject) => {
      complete = resolve;
      fail = reject;
    });
    const task = { complete, fail, cancel: vi.fn() };
    pending.push(task);
    return { result, cancel: task.cancel };
  });
  const connections = {
    browsers: () => [
      {
        id: 'a',
        connected: true,
        tabs: [
          { id: 7, title: 'Test', url: 'https://example.test/', active: true },
        ],
      },
    ],
    generation: () => 3,
  } as unknown as Connections;
  const executions = new Executions(connections, audit);
  instances.push(executions);
  return { executions, pending, connections };
}
async function settle(executions: Executions, id: string) {
  await vi.waitFor(
    () => {
      expect(executions.get('owner-a', id).state).not.toBe('running');
    },
    { timeout: 5_000 },
  );
  return executions.get('owner-a', id);
}
afterEach(() => {
  for (const instance of instances.splice(0)) instance.close();
  worker.run.mockReset();
  worker.close.mockReset();
});

describe('terminal states of the serialized browser execution manager', () => {
  const values: {
    result: Result;
    state: string;
    code?: string;
    output?: unknown;
  }[] = [
    {
      result: { status: 'completed', json: '{"answer":42}' },
      state: 'succeeded',
      output: { answer: 42 },
    },
    {
      result: { status: 'completed', json: '{broken' },
      state: 'failed',
      code: 'INVALID_RESULT',
    },
    {
      result: { status: 'failed', reason: 'script' },
      state: 'failed',
      code: 'SCRIPT_ERROR',
    },
    {
      result: { status: 'failed', reason: 'output' },
      state: 'failed',
      code: 'OUTPUT_LIMIT',
    },
    {
      result: { status: 'failed', reason: 'protocol' },
      state: 'failed',
      code: 'PROTOCOL_ERROR',
    },
    { result: { status: 'timeout' }, state: 'failed', code: 'TIMEOUT' },
    { result: { status: 'cancelled' }, state: 'cancelled', code: 'CANCELLED' },
    { result: { status: 'crashed' }, state: 'unknown', code: 'RUNNER_CRASHED' },
    { result: { status: 'unknown' }, state: 'unknown', code: 'UNKNOWN_RESULT' },
  ];
  for (const item of values) {
    it(`reports ${item.result.status} without inventing a safe result`, async () => {
      const h = fixture();
      const task = h.executions.run('owner-a', 'return 1;');
      expect(task.state).toBe('running');
      h.pending[0]?.complete(item.result);
      const final = await settle(h.executions, task.executionId);
      expect(final.state).toBe(item.state);
      if (item.code) expect(final.error?.code).toBe(item.code);
      if ('output' in item) expect(final.result).toEqual(item.output);
      else expect(final).not.toHaveProperty('result');
      expect(final.endedAt).toEqual(expect.any(Number));
    });
  }

  it('reports a rejected runner promise as an unknown outcome', async () => {
    const h = fixture();
    const task = h.executions.run('owner-a', 'return 1;');
    h.pending[0]?.fail(new Error('lost result'));
    const final = await settle(h.executions, task.executionId);
    expect(final).toMatchObject({
      state: 'unknown',
      error: { code: 'RUNNER_CRASHED' },
    });
    expect(JSON.stringify(final)).not.toContain('lost result');
  });

  it('marks a completed task unknown if final durable audit write failed', async () => {
    const audit = {
      begin: vi.fn(),
      start: vi.fn(),
      append: vi.fn(),
      finish: vi.fn(() => {
        throw new Error('audit storage failed');
      }),
    } as unknown as ExecutionAudit;
    const h = fixture(audit);
    const task = h.executions.run('owner-a', 'return 1;');
    h.pending[0]?.complete({ status: 'completed', json: '1' });
    const final = await settle(h.executions, task.executionId);
    expect(final).toMatchObject({
      state: 'unknown',
      error: { code: 'AUDIT_UNAVAILABLE' },
    });
    expect(final).not.toHaveProperty('result');
  });

  it('does not schedule a runner task if the durable audit refuses admission', () => {
    const audit = {
      begin: vi.fn(() => {
        throw new Error('cannot write');
      }),
    } as unknown as ExecutionAudit;
    const h = fixture(audit);
    expect(() =>
      h.executions.run('owner-a', 'return 1;', {
        browserId: 'a',
        tabId: 7,
      }),
    ).toThrow('AUDIT_UNAVAILABLE');
    expect(h.executions.isClaimed('a', 7)).toBe(false);
    expect(worker.run).not.toHaveBeenCalled();
  });

  it('rolls back an audit entry and releases the tab after a startup failure', () => {
    const remove = vi.fn();
    const audit = {
      begin: vi.fn(),
      start: vi.fn(() => {
        throw new Error('audit failed');
      }),
      remove,
    } as unknown as ExecutionAudit;
    const h = fixture(audit);
    expect(() =>
      h.executions.run('owner-a', 'return 1;', {
        browserId: 'a',
        tabId: 7,
      }),
    ).toThrow('audit failed');
    expect(h.executions.isClaimed('a', 7)).toBe(false);
    expect(remove).toHaveBeenCalledOnce();
    expect(worker.run).not.toHaveBeenCalled();
  });
});
