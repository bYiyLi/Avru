import type * as ChildProcessModule from 'node:child_process';
import { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { describe, it, expect, vi } from 'vitest';
import { Runner } from '../src/supervisor.js';
import { limits } from '../src/protocol.js';

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcessModule>()),
  spawn: vi.fn(),
}));

interface FakeChild extends ChildProcess {
  lines: () => string[];
  emitLine: (value: unknown) => void;
  emitRaw: (line: string) => void;
  toChild: PassThrough;
  fromChild: PassThrough;
}

function makeFakeChild(): FakeChild {
  const child = new ChildProcess() as unknown as FakeChild;
  const toChild = new PassThrough();
  const fromChild = new PassThrough();
  // Swallow stream errors in the fixture; the supervisor observes write
  // failures through the write callback, not the stream error event.
  toChild.on('error', () => undefined);
  fromChild.on('error', () => undefined);
  const written: string[] = [];
  let buffer = '';
  toChild.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      written.push(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf('\n');
    }
  });
  (child as unknown as { stdio: unknown[] }).stdio = [
    null,
    null,
    null,
    toChild,
    fromChild,
  ];
  child.kill = vi.fn(() => {
    queueMicrotask(() => child.emit('close', null));
    return true;
  });
  child.lines = () => written;
  child.emitLine = (value: unknown) => {
    fromChild.write(`${JSON.stringify(value)}\n`);
  };
  child.emitRaw = (line: string) => {
    fromChild.write(line);
  };
  child.toChild = toChild;
  child.fromChild = fromChild;
  return child;
}

function fixture() {
  const children: FakeChild[] = [];
  const factory = () => {
    const child = makeFakeChild();
    children.push(child);
    return child as unknown as ChildProcess;
  };
  const log = vi.fn();
  const runner = new Runner(factory, log);
  return {
    runner,
    log,
    children,
    child: () => {
      const child = children.at(-1);
      if (!child) throw new Error('missing child');
      return child;
    },
  };
}

const taskResult = (
  id: string,
  seq: number,
  state: string,
  extra: Record<string, unknown> = {},
) => ({ v: 1, type: 'task_result', taskId: id, seq, state, ...extra });
const bridgeCall = (
  id: string,
  seq: number,
  callId: number,
  method = 'mock.echo',
) => ({
  v: 1,
  type: 'bridge_call',
  taskId: id,
  seq,
  callId,
  method,
  args: '1',
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const lastLine = (f: ReturnType<typeof fixture>) => {
  const lines = f.child().lines();
  const line = lines.at(-1);
  if (line === undefined) throw new Error('no lines written');
  return JSON.parse(line) as Record<string, unknown>;
};

describe('runner supervisor', () => {
  it('serializes, bounds queue, reuses healthy process, and cancels queued tasks', async () => {
    const f = fixture();
    const first = f.runner.run('return 1');
    const queued = Array.from({ length: limits.maxQueue }, () =>
      f.runner.run('return 2'),
    );
    expect(() => f.runner.run('')).toThrow('queue full');
    await tick();
    const lines = f.child().lines();
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      v: 1,
      type: 'ping',
      taskId: '',
      seq: 1,
    });
    expect(JSON.parse(lines[1] ?? '')).toEqual({
      v: 1,
      type: 'run_task',
      taskId: first.id,
      seq: 1,
      script: 'return 1',
      limits: {
        timeoutMs: limits.timeoutMs,
        maxOutputBytes: limits.valueBytes,
        maxBridgeCalls: limits.maxCalls,
      },
    });
    queued[0]?.cancel();
    expect(await queued[0]?.result).toEqual({ status: 'cancelled' });
    f.child().emitLine(taskResult(first.id, 1, 'succeeded', { result: 1 }));
    expect((await first.result).status).toBe('completed');
    expect(f.children).toHaveLength(1);
    f.runner.close();
    await Promise.all(queued.map((task) => task.result));
    expect(() => f.runner.run('')).toThrow('closed');
  });

  it('rejects invalid code and reports per-call bridge failures', async () => {
    const f = fixture();
    expect(() => f.runner.run('x'.repeat(limits.sourceBytes + 1))).toThrow(
      'source limit',
    );
    const task = f.runner.run('');
    f.child().emitLine(bridgeCall(task.id, 1, 1));
    await tick();
    expect(lastLine(f)).toEqual({
      v: 1,
      type: 'bridge_result',
      taskId: task.id,
      seq: 2,
      callId: 1,
      ok: false,
      error: { code: 'BRIDGE_REJECTED', message: 'denied' },
    });
    f.child().emitLine(taskResult(task.id, 2, 'failed', { reason: 'script' }));
    expect(await task.result).toEqual({ status: 'failed', reason: 'script' });
    f.runner.close();
  });

  it('checks IPC seq, duplicates, wrong tasks, and late results', async () => {
    const f = fixture();
    const invoke = vi.fn(() => Promise.resolve('1'));
    const task = f.runner.run('', invoke);
    f.child().emitLine(bridgeCall(task.id, 1, 1));
    await tick();
    expect(invoke).toHaveBeenCalledOnce();
    expect(lastLine(f)).toEqual({
      v: 1,
      type: 'bridge_result',
      taskId: task.id,
      seq: 2,
      callId: 1,
      ok: true,
      value: 1,
    });
    f.child().emitLine(bridgeCall(task.id, 1, 1));
    await tick();
    expect(invoke).toHaveBeenCalledOnce();
    expect(f.log).toHaveBeenCalled();
    f.child().emitLine(bridgeCall(randomUUID(), 1, 1));
    await tick();
    expect(invoke).toHaveBeenCalledOnce();
    f.child().emitLine(bridgeCall(task.id, 2, 2));
    await tick();
    expect(invoke).toHaveBeenCalledTimes(2);
    f.child().emitLine(taskResult(task.id, 3, 'succeeded', { result: 1 }));
    expect((await task.result).status).toBe('completed');
    const next = f.runner.run('');
    await tick();
    f.child().emitLine(taskResult(task.id, 4, 'succeeded', { result: 1 }));
    await tick();
    expect(f.log).toHaveBeenCalled();
    f.child().emitLine(taskResult(next.id, 1, 'succeeded', { result: 2 }));
    expect((await next.result).status).toBe('completed');
    f.runner.close();
  });

  it('sends cancel_task, aborts, and waits for exit before reuse', async () => {
    const f = fixture();
    let resolve: (value: string) => void = () => undefined;
    const task = f.runner.run(
      '',
      () =>
        new Promise((finish) => {
          resolve = finish;
        }),
    );
    f.child().emitLine(bridgeCall(task.id, 1, 1));
    await tick();
    task.cancel();
    task.cancel();
    const firstLines = f.child().lines();
    expect(JSON.parse(firstLines.at(-1) ?? '')).toEqual({
      v: 1,
      type: 'cancel_task',
      taskId: task.id,
      seq: 2,
      reason: 'cancelled',
    });
    const next = f.runner.run('');
    expect(f.children).toHaveLength(1);
    resolve('late');
    await tick();
    expect(await task.result).toEqual({ status: 'cancelled' });
    expect(f.children).toHaveLength(2);
    f.child().emitLine(taskResult(next.id, 1, 'succeeded', { result: 1 }));
    expect((await next.result).status).toBe('completed');
    f.runner.close();
  });

  it('recovers crashes without replay, and handles invalid/oversized replies', async () => {
    const f = fixture();
    const one = f.runner.run('');
    const two = f.runner.run('');
    f.child().emit('close', 1);
    expect(await one.result).toEqual({ status: 'crashed' });
    expect(f.children).toHaveLength(2);
    f.child().emitRaw('{invalid json\n');
    expect((await two.result).status).toBe('failed');
    await tick();
    const three = f.runner.run('', () =>
      Promise.resolve(JSON.stringify('x'.repeat(limits.valueBytes + 1))),
    );
    await tick();
    f.child().emitLine(bridgeCall(three.id, 1, 1));
    expect((await three.result).status).toBe('failed');
    f.runner.close();
  });

  it('cleans up startup errors, process errors, idle protocol violations, and close', async () => {
    const broken = new Runner(() => {
      throw new Error('spawn');
    });
    expect((await broken.run('').result).status).toBe('crashed');
    broken.close();
    const f = fixture();
    const task = f.runner.run('');
    f.child().emit('error', new Error('failed'));
    expect((await task.result).status).toBe('crashed');
    await tick();
    const next = f.runner.run('');
    f.child().emitLine(taskResult(next.id, 1, 'succeeded', { result: 1 }));
    await next.result;
    f.child().emitLine(taskResult(next.id, 1, 'succeeded', { result: 1 }));
    await tick();
    expect(f.log).toHaveBeenCalled();
    f.runner.close();
  });

  it('enforces production timeoutMs with clamping', async () => {
    vi.useFakeTimers();
    try {
      const base = fixture();
      const baseTask = base.runner.run('');
      await vi.advanceTimersByTimeAsync(limits.timeoutMs + 1);
      expect(await baseTask.result).toEqual({ status: 'timeout' });
      base.runner.close();

      const prod = fixture();
      const prodTask = prod.runner.run('', undefined, {
        timeoutMs: 60_000,
      });
      const prodSettledEarly = await Promise.race([
        prodTask.result.then(() => true),
        vi.advanceTimersByTimeAsync(limits.timeoutMs + 1).then(() => false),
      ]);
      expect(prodSettledEarly).toBe(false);
      await vi.advanceTimersByTimeAsync(55_000);
      expect(await prodTask.result).toEqual({ status: 'timeout' });
      prod.runner.close();

      const clamped = fixture();
      const clampedTask = clamped.runner.run('', undefined, {
        timeoutMs: 999_999,
      });
      const clampedSettledEarly = await Promise.race([
        clampedTask.result.then(() => true),
        vi.advanceTimersByTimeAsync(limits.maxTimeoutMs - 1).then(() => false),
      ]);
      expect(clampedSettledEarly).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(await clampedTask.result).toEqual({ status: 'timeout' });
      clamped.runner.close();
    } finally {
      vi.useRealTimers();
    }
  });
});

it('returns unknown when the deadline hits with a bridge call in flight', async () => {
  const f = fixture();
  const task = f.runner.run('', () => new Promise<string>(() => undefined), {
    timeoutMs: 50,
  });
  f.child().emitLine(bridgeCall(task.id, 1, 1));
  expect(await task.result).toEqual({ status: 'unknown' });
  const next = f.runner.run('return 2;');
  await tick();
  expect(f.children).toHaveLength(2);
  f.child().emitLine(taskResult(next.id, 1, 'succeeded', { result: 2 }));
  expect((await next.result).status).toBe('completed');
  f.runner.close();
});

it('accepts task_result unknown with a bridge call still in flight', async () => {
  const f = fixture();
  const task = f.runner.run('', () => new Promise<string>(() => undefined));
  f.child().emitLine(bridgeCall(task.id, 1, 1));
  await tick();
  f.child().emitLine(
    taskResult(task.id, 2, 'unknown', {
      error: { code: 'UNKNOWN_RESULT', message: 'unknown' },
    }),
  );
  expect(await task.result).toEqual({ status: 'unknown' });
  f.runner.close();
});

it('sends run_task with target and clamped limits', async () => {
  const f = fixture();
  const task = f.runner.run('return 1', undefined, {
    timeoutMs: 60_000,
    target: { browserId: 'b1', tabId: 't1', generation: 2 },
    limits: { maxOutputBytes: 1024, maxBridgeCalls: 4 },
  });
  await tick();
  const lines = f.child().lines();
  expect(JSON.parse(lines[1] ?? '')).toEqual({
    v: 1,
    type: 'run_task',
    taskId: task.id,
    seq: 1,
    script: 'return 1',
    target: { browserId: 'b1', tabId: 't1', generation: 2 },
    limits: { timeoutMs: 60_000, maxOutputBytes: 1024, maxBridgeCalls: 4 },
  });
  expect(() =>
    f.runner.run('', undefined, {
      target: { browserId: '', tabId: 't', generation: 0 },
    }),
  ).toThrow('invalid target');
  f.child().emitLine(taskResult(task.id, 1, 'succeeded', { result: 1 }));
  await task.result;
  f.runner.close();
});

it('handles outbound IPC errors and ignores failed callbacks from retired tasks', async () => {
  const f = fixture();
  const first = f.runner.run('');
  f.child().emitLine(bridgeCall(first.id, 1, 1));
  f.child().toChild.destroy(new Error('broken pipe'));
  expect((await first.result).status).toBe('crashed');
  await tick();
  const next = f.runner.run('', () => Promise.resolve('1'));
  f.children[0]?.emit('error', new Error('retired'));
  f.child().emitLine(bridgeCall(next.id, 1, 1));
  await tick();
  expect(lastLine(f)).toEqual({
    v: 1,
    type: 'bridge_result',
    taskId: next.id,
    seq: 2,
    callId: 1,
    ok: true,
    value: 1,
  });
  f.child().emitLine(taskResult(next.id, 2, 'succeeded', { result: 1 }));
  expect((await next.result).status).toBe('completed');
  f.runner.close();
});

it('spawns a credential-free child with fixed executable arguments', async () => {
  const childProcess = await import('node:child_process');
  const child = makeFakeChild();
  const spawn = vi.mocked(childProcess.spawn);
  spawn.mockReturnValue(child);
  try {
    const runner = new Runner();
    const task = runner.run('return 1');
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      ['--max-old-space-size=64', expect.stringContaining('worker.mjs')],
      { env: {}, stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
    );
    child.emitLine(taskResult(task.id, 1, 'succeeded', { result: 1 }));
    await task.result;
    runner.close();
  } finally {
    spawn.mockRestore();
  }
});

it('does not invoke a host callback after synchronous cancellation', async () => {
  const f = fixture();
  const invoke = vi.fn(() => Promise.resolve('1'));
  const task = f.runner.run('', invoke);
  f.child().emitLine(bridgeCall(task.id, 1, 1));
  task.cancel();
  await task.result;
  await tick();
  expect(invoke).not.toHaveBeenCalled();
  f.runner.close();
});

it('aborts pending host work and rejects early task_result', async () => {
  const f = fixture();
  let signal: AbortSignal | undefined;
  const task = f.runner.run('', (_method, _json, current) => {
    signal = current;
    return new Promise(() => undefined);
  });
  f.child().emitLine(bridgeCall(task.id, 1, 1));
  await tick();
  f.child().emitLine(taskResult(task.id, 2, 'succeeded', { result: 1 }));
  expect((await task.result).status).toBe('failed');
  expect(signal?.aborted).toBe(true);
  f.runner.close();
});

it('retains a global bound on non-cooperative bridges after cancellation', async () => {
  const f = fixture();
  const invoke = vi.fn(() => new Promise<string>(() => undefined));
  for (let index = 0; index < limits.maxCalls; index++) {
    const task = f.runner.run('', invoke);
    f.child().emitLine(bridgeCall(task.id, 1, 1));
    await tick();
    task.cancel();
    await task.result;
    await tick();
  }
  const blocked = f.runner.run('', invoke);
  f.child().emitLine(bridgeCall(blocked.id, 1, 1));
  await tick();
  expect(lastLine(f)).toEqual({
    v: 1,
    type: 'bridge_result',
    taskId: blocked.id,
    seq: 2,
    callId: 1,
    ok: false,
    error: { code: 'BRIDGE_REJECTED', message: 'bridge busy' },
  });
  f.child().emitLine(taskResult(blocked.id, 2, 'failed', { reason: 'script' }));
  expect((await blocked.result).status).toBe('failed');
  expect(invoke).toHaveBeenCalledTimes(limits.maxCalls);
  f.runner.close();
});
