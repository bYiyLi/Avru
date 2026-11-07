import type * as ChildProcessModule from 'node:child_process';
import { ChildProcess } from 'node:child_process';
import { describe, it, expect, vi } from 'vitest';
import { Runner } from '../src/supervisor.js';
import { limits } from '../src/protocol.js';
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcessModule>()),
  fork: vi.fn(),
}));
function fixture() {
  const children: ChildProcess[] = [];
  const sends: ReturnType<typeof vi.fn<ChildProcess['send']>>[] = [];
  const factory = () => {
    const child = new ChildProcess();
    const send = vi.fn<ChildProcess['send']>(() => true);
    child.send = send;
    sends.push(send);
    child.kill = vi.fn(() => {
      queueMicrotask(() => child.emit('close', null));
      return true;
    });
    children.push(child);
    return child;
  };
  const runner = new Runner(factory);
  return {
    runner,
    children,
    send: () => {
      const send = sends.at(-1);
      if (!send) throw new Error('missing send');
      return send;
    },
    child: () => {
      const child = children.at(-1);
      if (!child) throw new Error('missing child');
      return child;
    },
  };
}
const done = (id: string) => ({
  type: 'done',
  id,
  result: { status: 'completed', json: '1' },
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
describe('runner supervisor', () => {
  it('serializes, bounds queue, reuses healthy process, and cancels queued tasks', async () => {
    const f = fixture();
    const first = f.runner.run('return 1');
    const queued = Array.from({ length: limits.maxQueue }, () =>
      f.runner.run('return 2'),
    );
    expect(() => f.runner.run('')).toThrow('queue full');
    queued[0]?.cancel();
    expect(await queued[0]?.result).toEqual({ status: 'cancelled' });
    f.child().emit('message', done(first.id));
    expect((await first.result).status).toBe('completed');
    expect(f.children).toHaveLength(1);
    f.runner.close();
    await Promise.all(queued.map((task) => task.result));
    expect(() => f.runner.run('')).toThrow('closed');
  });
  it('rejects invalid code and defaults to no host authority', async () => {
    const f = fixture();
    expect(() => f.runner.run('x'.repeat(limits.sourceBytes + 1))).toThrow(
      'source limit',
    );
    const task = f.runner.run('');
    f.child().emit('message', {
      type: 'call',
      id: task.id,
      call: 1,
      method: 'mock.echo',
      json: '1',
    });
    expect(await task.result).toEqual({ status: 'failed', reason: 'script' });
    f.runner.close();
  });
  it('checks IPC generation, duplicates, values, and late results', async () => {
    const f = fixture();
    const invoke = vi.fn(() => Promise.resolve('1'));
    const task = f.runner.run('', invoke);
    const call = {
      type: 'call',
      id: task.id,
      call: 1,
      method: 'mock.echo',
      json: '1',
    };
    f.child().emit('message', call);
    await tick();
    expect(invoke).toHaveBeenCalledOnce();
    expect(f.send()).toHaveBeenLastCalledWith(
      { type: 'reply', id: task.id, call: 1, json: '1' },
      expect.any(Function),
    );
    f.child().emit('message', call);
    expect(await task.result).toEqual({ status: 'failed', reason: 'protocol' });
    await tick();
    const next = f.runner.run('');
    const old = f.children[0];
    old?.emit('message', done(next.id));
    f.child().emit('message', done(task.id));
    expect((await next.result).status).toBe('failed');
    f.runner.close();
  });
  it('ignores callbacks after cancellation and waits for exit before reuse', async () => {
    const f = fixture();
    let resolve: (value: string) => void = () => undefined;
    const task = f.runner.run(
      '',
      () =>
        new Promise((finish) => {
          resolve = finish;
        }),
    );
    f.child().emit('message', {
      type: 'call',
      id: task.id,
      call: 1,
      method: 'mock.echo',
      json: '1',
    });
    await tick();
    task.cancel();
    task.cancel();
    const next = f.runner.run('');
    expect(f.children).toHaveLength(1);
    resolve('late');
    await tick();
    expect(await task.result).toEqual({ status: 'cancelled' });
    expect(f.children).toHaveLength(2);
    f.child().emit('message', done(next.id));
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
    f.child().emit('message', { invalid: true });
    expect((await two.result).status).toBe('failed');
    await tick();
    const three = f.runner.run('', () =>
      Promise.resolve('x'.repeat(limits.valueBytes + 1)),
    );
    f.child().emit('message', {
      type: 'call',
      id: three.id,
      call: 1,
      method: 'mock.echo',
      json: '1',
    });
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
    f.child().emit('message', done(next.id));
    await next.result;
    f.child().emit('message', done(next.id));
    await tick();
    f.runner.close();
  });
  it('enforces wall deadline outside the child process', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const task = f.runner.run('');
    await vi.advanceTimersByTimeAsync(limits.timeoutMs + 1);
    expect(await task.result).toEqual({ status: 'timeout' });
    f.runner.close();
    vi.useRealTimers();
  });
});

it('handles outbound IPC errors and ignores failed callbacks from retired tasks', async () => {
  const f = fixture();
  const first = f.runner.run('');
  const send = f.send();
  const firstCallback = vi.mocked(send).mock.calls[0]?.[1];
  if (typeof firstCallback !== 'function') throw new Error('missing callback');
  firstCallback(new Error('broken pipe'));
  expect((await first.result).status).toBe('crashed');
  await tick();
  const next = f.runner.run('', () => Promise.resolve('1'));
  firstCallback(new Error('late error'));
  f.children[0]?.emit('error', new Error('retired'));
  f.child().emit('message', {
    type: 'call',
    id: next.id,
    call: 1,
    method: 'mock.echo',
    json: '1',
  });
  await tick();
  const replyCallback = f.send().mock.calls.at(-1)?.[1];
  if (typeof replyCallback !== 'function')
    throw new Error('missing reply callback');
  replyCallback(new Error('reply pipe'));
  expect((await next.result).status).toBe('crashed');
  await tick();
  f.runner.close();
});

it('spawns a credential-free child with fixed executable arguments', async () => {
  const childProcess = await import('node:child_process');
  const child = new ChildProcess();
  child.send = vi.fn(() => true);
  child.kill = vi.fn(() => true);
  const spawn = vi.mocked(childProcess.fork).mockReturnValue(child);
  const runner = new Runner();
  const task = runner.run('return 1');
  expect(spawn).toHaveBeenCalledWith(
    expect.stringContaining('worker.mjs'),
    [],
    {
      env: {},
      execArgv: ['--max-old-space-size=64'],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      serialization: 'json',
    },
  );
  child.emit('message', done(task.id));
  await task.result;
  runner.close();
  spawn.mockRestore();
});
it('does not invoke a host callback after synchronous cancellation', async () => {
  const f = fixture();
  const invoke = vi.fn(() => Promise.resolve('1'));
  const task = f.runner.run('', invoke);
  f.child().emit('message', {
    type: 'call',
    id: task.id,
    call: 1,
    method: 'mock.echo',
    json: '1',
  });
  task.cancel();
  await task.result;
  await tick();
  expect(invoke).not.toHaveBeenCalled();
  f.runner.close();
});
it('aborts pending host work and rejects early done', async () => {
  const f = fixture();
  let signal: AbortSignal | undefined;
  const task = f.runner.run('', (_method, _json, current) => {
    signal = current;
    return new Promise(() => undefined);
  });
  f.child().emit('message', {
    type: 'call',
    id: task.id,
    call: 1,
    method: 'mock.echo',
    json: '1',
  });
  await tick();
  f.child().emit('message', done(task.id));
  expect((await task.result).status).toBe('failed');
  expect(signal?.aborted).toBe(true);
  f.runner.close();
});
it('retains a global bound on non-cooperative bridges after cancellation', async () => {
  const f = fixture();
  const invoke = vi.fn(() => new Promise<string>(() => undefined));
  for (let index = 0; index < limits.maxCalls; index++) {
    const task = f.runner.run('', invoke);
    f.child().emit('message', {
      type: 'call',
      id: task.id,
      call: 1,
      method: 'mock.echo',
      json: '1',
    });
    await tick();
    task.cancel();
    await task.result;
    await tick();
  }
  const blocked = f.runner.run('', invoke);
  f.child().emit('message', {
    type: 'call',
    id: blocked.id,
    call: 1,
    method: 'mock.echo',
    json: '1',
  });
  expect((await blocked.result).status).toBe('failed');
  expect(invoke).toHaveBeenCalledTimes(limits.maxCalls);
  f.runner.close();
});
