import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachWorker } from '../src/worker.js';
import type { IpcMessage } from '../src/protocol.js';

function fixture() {
  let receive: (message: unknown) => void = () => undefined;
  const sent: IpcMessage[] = [];
  const stop = vi.fn();
  const log = vi.fn();
  const send = vi.fn((message: IpcMessage) => {
    sent.push(message);
  });
  attachWorker(
    {
      onMessage: (listener) => {
        receive = listener;
      },
      send,
      stop,
    },
    log,
  );
  const run = (script: string) => {
    const taskId = randomUUID();
    receive({
      v: 1,
      type: 'run_task',
      taskId,
      seq: 1,
      script,
      limits: { timeoutMs: 5000, maxOutputBytes: 65536, maxBridgeCalls: 32 },
    });
    return taskId;
  };
  const result = (
    taskId: string,
    seq: number,
    callId: number,
    value: unknown,
  ) => {
    receive({
      v: 1,
      type: 'bridge_result',
      taskId,
      seq,
      callId,
      ok: true,
      value,
    });
  };
  const bridgeCalls = () =>
    sent.filter((message) => message.type === 'bridge_call');
  const taskResults = () =>
    sent.filter((message) => message.type === 'task_result');
  return {
    get receive() {
      return receive;
    },
    run,
    result,
    sent,
    stop,
    log,
    send,
    bridgeCalls,
    taskResults,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('worker IPC and cancellation edge cases', () => {
  it('ignores repeated or out-of-sequence ping before answering the valid next ping', () => {
    const h = fixture();
    h.receive({ v: 1, type: 'ping', taskId: '', seq: 3 });
    h.receive({ v: 1, type: 'ping', taskId: '', seq: 1 });
    h.receive({ v: 1, type: 'ping', taskId: '', seq: 1 });
    h.receive({ v: 1, type: 'ping', taskId: '', seq: 2 });
    expect(h.sent.filter((message) => message.type === 'pong')).toEqual([
      { v: 1, type: 'pong', taskId: '', seq: 1 },
      { v: 1, type: 'pong', taskId: '', seq: 2 },
    ]);
    expect(h.log).toHaveBeenCalledTimes(2);
    expect(h.stop).not.toHaveBeenCalled();
  });

  it('ignores cancellation for an unknown task instead of stopping the worker', () => {
    const h = fixture();
    h.receive({
      v: 1,
      type: 'cancel_task',
      taskId: randomUUID(),
      seq: 1,
    });
    expect(h.log).toHaveBeenCalledWith(
      'worker: ignored cancel_task for unknown or finished task',
    );
    expect(h.stop).not.toHaveBeenCalled();
  });

  it('rejects a cancel_task with wrong seq then accepts the next in-order cancellation', async () => {
    const h = fixture();
    const taskId = h.run('return await browser.tabs.list();');
    await vi.waitFor(() => {
      expect(h.bridgeCalls()).toHaveLength(1);
    });
    h.receive({ v: 1, type: 'cancel_task', taskId, seq: 8 });
    expect(h.taskResults()).toHaveLength(0);
    expect(
      h.log.mock.calls.some((args) =>
        String(args[0]).includes('unexpected seq'),
      ),
    ).toBe(true);
    h.receive({ v: 1, type: 'cancel_task', taskId, seq: 2 });
    await vi.waitFor(() => {
      expect(h.taskResults()).toHaveLength(1);
    });
    expect(h.taskResults()[0]).toMatchObject({
      state: 'cancelled',
      taskId,
    });
    expect(h.stop).not.toHaveBeenCalled();
  });

  it('ignores a forged bridge_result from another task while preserving the active guest', async () => {
    const h = fixture();
    const taskId = h.run('return await browser.tabs.list();');
    await vi.waitFor(() => {
      expect(h.bridgeCalls()).toHaveLength(1);
    });
    h.result(randomUUID(), 2, 1, ['forged']);
    expect(h.log).toHaveBeenCalledWith('worker: dropped late bridge_result');
    expect(h.taskResults()).toHaveLength(0);
    h.result(taskId, 2, 1, ['valid']);
    await vi.waitFor(() => {
      expect(h.taskResults()).toHaveLength(1);
    });
    expect(h.taskResults()[0]).toMatchObject({
      state: 'succeeded',
      result: ['valid'],
    });
  });

  it('drops an out-of-order bridge_result and accepts a correctly sequenced result', async () => {
    const h = fixture();
    const taskId = h.run('return await browser.tabs.list();');
    await vi.waitFor(() => {
      expect(h.bridgeCalls()).toHaveLength(1);
    });
    h.result(taskId, 3, 1, ['out of order']);
    expect(
      h.log.mock.calls.some((args) =>
        String(args[0]).includes('bridge_result with unexpected seq'),
      ),
    ).toBe(true);
    h.result(taskId, 2, 1, ['in order']);
    await vi.waitFor(() => {
      expect(h.taskResults()).toHaveLength(1);
    });
    expect(h.taskResults()[0]).toMatchObject({
      state: 'succeeded',
      result: ['in order'],
    });
  });

  it('drops an unknown callId without delivering a value to another guest call', async () => {
    const h = fixture();
    const taskId = h.run('return await browser.tabs.list();');
    await vi.waitFor(() => {
      expect(h.bridgeCalls()).toHaveLength(1);
    });
    h.result(taskId, 2, 99, ['wrong']);
    expect(h.log).toHaveBeenCalledWith(
      'worker: dropped bridge_result for unknown call 99',
    );
    expect(h.taskResults()).toHaveLength(0);
    h.result(taskId, 3, 1, ['ok']);
    await vi.waitFor(() => {
      expect(h.taskResults()).toHaveLength(1);
    });
    expect(h.taskResults()[0]).toMatchObject({
      state: 'succeeded',
      result: ['ok'],
    });
  });

  it('fails closed when an unrecognized IPC message arrives', () => {
    const h = fixture();
    h.receive({ v: 1, type: 'surprise', taskId: randomUUID(), seq: 1 });
    expect(h.log).toHaveBeenCalledWith('worker: rejected unknown IPC message');
    expect(h.stop).toHaveBeenCalledOnce();
  });

  it('can use the default logger without invoking a browser action', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let receive: (value: unknown) => void = () => undefined;
    const stop = vi.fn();
    attachWorker({
      onMessage: (listener) => {
        receive = listener;
      },
      send: vi.fn(),
      stop,
    });
    receive({ v: 1, type: 'not_valid', taskId: '', seq: 1 });
    expect(stop).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith('worker: rejected unknown IPC message');
  });

  it('stops if sending the terminal task result fails', async () => {
    let receive: (value: unknown) => void = () => undefined;
    const stop = vi.fn();
    const send = vi.fn((message: IpcMessage) => {
      expect(message.type).toBe('task_result');
      throw new Error('write to private pipe failed');
    });
    attachWorker(
      {
        onMessage: (listener) => {
          receive = listener;
        },
        send,
        stop,
      },
      vi.fn(),
    );
    receive({
      v: 1,
      type: 'run_task',
      taskId: randomUUID(),
      seq: 1,
      script: 'return true;',
      limits: { timeoutMs: 5000, maxOutputBytes: 65536, maxBridgeCalls: 32 },
    });
    await vi.waitFor(() => {
      expect(stop).toHaveBeenCalledOnce();
    });
  });

  it('does not advertise a malformed engine JSON result as a successful task', async () => {
    const engine = await import('../src/engine.js');
    vi.spyOn(engine, 'execute').mockResolvedValueOnce({
      status: 'completed',
      json: '{broken json',
    });
    const h = fixture();
    h.run('return 1;');
    await vi.waitFor(() => {
      expect(h.taskResults()).toHaveLength(1);
    });
    expect(h.taskResults()[0]).toMatchObject({
      state: 'failed',
      reason: 'protocol',
    });
  });

  it('maps an impossible in-process engine crash result to protocol failure', async () => {
    const engine = await import('../src/engine.js');
    vi.spyOn(engine, 'execute').mockResolvedValueOnce({ status: 'crashed' });
    const h = fixture();
    h.run('return 1;');
    await vi.waitFor(() => {
      expect(h.taskResults()).toHaveLength(1);
    });
    expect(h.taskResults()[0]).toMatchObject({
      state: 'failed',
      reason: 'protocol',
    });
  });
});
