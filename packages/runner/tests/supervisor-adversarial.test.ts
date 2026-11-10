import { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Runner } from '../src/supervisor.js';
import { limits } from '../src/protocol.js';

type FakeChild = ChildProcess & {
  toChild: PassThrough;
  fromChild: PassThrough;
  written: () => Record<string, unknown>[];
  reply: (value: unknown) => void;
  raw: (value: string) => void;
  killSignals: () => (number | NodeJS.Signals | undefined)[];
};

function childFixture() {
  const child = new ChildProcess() as FakeChild;
  const toChild = new PassThrough();
  const fromChild = new PassThrough();
  const lines: Record<string, unknown>[] = [];
  let buffer = '';
  toChild.on('error', () => undefined);
  fromChild.on('error', () => undefined);
  toChild.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    for (
      let index = buffer.indexOf('\n');
      index >= 0;
      index = buffer.indexOf('\n')
    ) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      lines.push(JSON.parse(line) as Record<string, unknown>);
    }
  });
  (child as unknown as { stdio: unknown[] }).stdio = [
    null,
    null,
    null,
    toChild,
    fromChild,
  ];
  child.toChild = toChild;
  child.fromChild = fromChild;
  child.written = () => lines;
  child.reply = (value) => {
    fromChild.write(JSON.stringify(value) + '\n');
  };
  child.raw = (value) => {
    fromChild.write(value);
  };
  const kills: (number | NodeJS.Signals | undefined)[] = [];
  child.kill = vi.fn((signal?: number | NodeJS.Signals) => {
    kills.push(signal);
    queueMicrotask(() => child.emit('close', 1));
    return true;
  });
  child.killSignals = () => kills;
  return child;
}

const running: Runner[] = [];
function fixture() {
  const children: FakeChild[] = [];
  const log = vi.fn();
  const runner = new Runner(() => {
    const child = childFixture();
    children.push(child);
    return child;
  }, log);
  running.push(runner);
  const child = () => {
    const result = children.at(-1);
    if (!result) throw new Error('missing child');
    return result;
  };
  return { runner, log, children, child };
}
const finish = (
  taskId: string,
  state: string,
  extras: Record<string, unknown> = {},
  seq = 1,
) => ({
  v: 1,
  type: 'task_result',
  taskId,
  seq,
  state,
  ...extras,
});
const call = (taskId: string, callId: number, seq = 1) => ({
  v: 1,
  type: 'bridge_call',
  taskId,
  seq,
  callId,
  method: 'tabs.list',
  args: [],
});
const flush = async () => {
  await new Promise<void>((resolve) => setImmediate(resolve));
};
afterEach(() => {
  for (const runner of running.splice(0)) runner.close();
  vi.restoreAllMocks();
});

describe('private NDJSON IPC rejection and outcome boundaries', () => {
  it('rejects oversized incomplete child output before JSON parsing', async () => {
    const f = fixture();
    const task = f.runner.run('return true;');
    f.child().raw('x'.repeat(limits.messageBytes + 1));
    expect(await task.result).toEqual({
      status: 'failed',
      reason: 'protocol',
    });
    expect(f.log).toHaveBeenCalledWith('runner: rejected oversized IPC line');
  });

  it('kills an idle child that emits an oversized incomplete IPC line', async () => {
    const f = fixture();
    const first = f.runner.run('return 1;');
    f.child().reply(finish(first.id, 'succeeded', { result: 1 }));
    expect(await first.result).toEqual({
      status: 'completed',
      json: '1',
    });
    const idleChild = f.child();
    idleChild.raw('x'.repeat(limits.messageBytes + 1));
    expect(idleChild.killSignals()).toEqual(['SIGKILL']);
  });

  it('rejects a malformed pong but retains the active task', async () => {
    const f = fixture();
    const task = f.runner.run('return 1;');
    f.child().reply({
      v: 1,
      type: 'pong',
      taskId: '',
      seq: 'invalid',
    });
    f.child().reply({
      v: 1,
      type: 'pong',
      taskId: '',
      seq: 3,
    });
    f.child().reply({
      v: 1,
      type: 'pong',
      taskId: '',
      seq: 1,
    });
    expect(f.log.mock.calls.map((args) => String(args[0]))).toEqual(
      expect.arrayContaining([
        'runner: rejected malformed pong',
        'runner: rejected pong with unexpected seq 3',
      ]),
    );
    f.child().reply(finish(task.id, 'succeeded', { result: 1 }));
    expect(await task.result).toEqual({ status: 'completed', json: '1' });
  });

  it('fails an active task on a wrong-version or unrecognized IPC envelope', async () => {
    const f = fixture();
    const task = f.runner.run('return true;');
    f.child().reply({ v: 2, type: 'task_result', taskId: task.id });
    expect(await task.result).toEqual({
      status: 'failed',
      reason: 'protocol',
    });
    const next = f.runner.run('return 2;');
    f.child().reply({
      v: 1,
      type: 'other',
      taskId: next.id,
      seq: 1,
    });
    expect(await next.result).toEqual({
      status: 'failed',
      reason: 'protocol',
    });
  });

  it('rejects malformed or out-of-order bridge call IDs before invoking a host', async () => {
    const f = fixture();
    const invoke = vi.fn(() => Promise.resolve('1'));
    const task = f.runner.run('return 1;', invoke);
    f.child().reply(call(task.id, 2));
    expect(await task.result).toEqual({
      status: 'failed',
      reason: 'protocol',
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects a malformed task_result that claims a success without validation', async () => {
    const f = fixture();
    const task = f.runner.run('return true;');
    f.child().reply(finish(task.id, 'not-a-valid-state'));
    expect(await task.result).toEqual({
      status: 'failed',
      reason: 'protocol',
    });
  });

  it('preserves worker timeout semantics and replaces a wedged child', async () => {
    const f = fixture();
    const task = f.runner.run('while(true){}');
    f.child().reply(
      finish(task.id, 'failed', {
        error: { code: 'TIMEOUT', message: 'guest timeout' },
      }),
    );
    expect(await task.result).toEqual({ status: 'timeout' });
    await flush();
    const next = f.runner.run('return 4;');
    expect(f.children).toHaveLength(2);
    f.child().reply(finish(next.id, 'succeeded', { result: 4 }));
    expect(await next.result).toEqual({ status: 'completed', json: '4' });
  });

  it('reports a worker-declared cancellation as cancelled, not successful', async () => {
    const f = fixture();
    const task = f.runner.run('return true;');
    f.child().reply(finish(task.id, 'cancelled'));
    expect(await task.result).toEqual({ status: 'cancelled' });
  });

  it('does not leak a malformed host return value to the guest', async () => {
    const f = fixture();
    const task = f.runner.run('return await browser.tabs.list();', () =>
      Promise.resolve('{broken json'),
    );
    f.child().reply(call(task.id, 1));
    expect(await task.result).toEqual({
      status: 'failed',
      reason: 'protocol',
    });
  });

  it('ignores messages for unrelated task IDs without retiring current execution', async () => {
    const f = fixture();
    const task = f.runner.run('return 1;');
    f.child().reply(
      finish('11111111-1111-4111-8111-111111111111', 'succeeded', {
        result: 9,
      }),
    );
    f.child().reply(finish(task.id, 'succeeded', { result: 1 }));
    expect(await task.result).toEqual({ status: 'completed', json: '1' });
    expect(
      f.log.mock.calls.some((args) => String(args[0]).includes('unknown task')),
    ).toBe(true);
  });
});

describe('NDJSON framing, startup and worker result boundaries', () => {
  it('rejects a script whose escaped JSON run envelope exceeds the IPC limit', () => {
    const f = fixture();
    expect(() => f.runner.run('"'.repeat(34_000))).toThrow('source limit');
    expect(f.children).toHaveLength(0);
  });

  it('does not emit a successfully delivered bridge result if its IPC envelope is too large', async () => {
    const f = fixture();
    const task = f.runner.run('return await browser.tabs.list();', () =>
      Promise.resolve(JSON.stringify('x'.repeat(65_450))),
    );
    f.child().reply(call(task.id, 1));
    expect(await task.result).toEqual({ status: 'crashed' });
    expect(
      f.log.mock.calls.some((args) =>
        String(args[0]).includes('refused oversized IPC message'),
      ),
    ).toBe(true);
  });

  it('rejects unavailable child input pipes rather than launching a phantom task', async () => {
    const log = vi.fn();
    const child = childFixture();
    (child as unknown as { stdio: unknown[] }).stdio = [
      null,
      null,
      null,
      null,
      null,
    ];
    const runner = new Runner(() => child, log);
    running.push(runner);
    const task = runner.run('return 1;');
    expect(await task.result).toEqual({ status: 'crashed' });
    expect(child.killSignals()).toEqual(['SIGKILL']);
  });

  it('does not claim a bridge reply succeeded if the child output pipe vanished', async () => {
    const f = fixture();
    const task = f.runner.run('return await browser.tabs.list();', () =>
      Promise.resolve('123'),
    );
    (f.child() as unknown as { stdio: unknown[] }).stdio[3] = null;
    f.child().reply(call(task.id, 1));
    expect(await task.result).toEqual({ status: 'crashed' });
  });

  it('ignores invalid replies while idle but reports them through default logging', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const child = childFixture();
    const runner = new Runner(() => child);
    running.push(runner);
    const task = runner.run('return true;');
    child.reply(finish(task.id, 'succeeded', { result: true }));
    expect(await task.result).toEqual({
      status: 'completed',
      json: 'true',
    });
    child.raw('{invalid json\n');
    child.reply({ v: 2, type: 'not-valid' });
    expect(error).toHaveBeenCalledWith('runner: rejected undecodable IPC line');
    expect(error).toHaveBeenCalledWith(
      'runner: rejected IPC message without v:1 envelope',
    );
  });

  it('reports failed script defaults and bounded worker success values precisely', async () => {
    const f = fixture();
    const failed = f.runner.run('return true;');
    f.child().reply(finish(failed.id, 'failed'));
    expect(await failed.result).toEqual({
      status: 'failed',
      reason: 'script',
    });
    const boundedResult = f.runner.run('return "large";', undefined, {
      limits: { maxOutputBytes: 100 },
    });
    f.child().reply(
      finish(boundedResult.id, 'succeeded', { result: 'x'.repeat(200) }),
    );
    expect(await boundedResult.result).toEqual({
      status: 'failed',
      reason: 'output',
    });
    const absentResult = f.runner.run('return undefined;');
    f.child().reply(finish(absentResult.id, 'succeeded'));
    expect(await absentResult.result).toEqual({
      status: 'completed',
      json: 'null',
    });
  });
});
