import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { attachWorker } from '../src/worker.js';
import { SDK_CAPABILITIES } from '../src/sdk.js';
import type { IpcMessage } from '../src/protocol.js';

interface Harness {
  listener: (message: unknown) => void;
  sent: IpcMessage[];
  send: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
  run: (code: string, timeoutMs?: number, target?: unknown) => string;
  bridgeResult: (
    taskId: string,
    seq: number,
    callId: number,
    outcome:
      | { ok: true; value?: unknown }
      | { ok: false; error: { code: string; message: string } },
  ) => void;
}

function harness(): Harness {
  let listener: (message: unknown) => void = () => undefined;
  const sent: IpcMessage[] = [];
  const send = vi.fn((message: IpcMessage) => {
    sent.push(message);
  });
  const stop = vi.fn();
  const log = vi.fn();
  attachWorker(
    {
      onMessage: (cb) => {
        listener = cb;
      },
      send,
      stop,
    },
    log,
  );
  const run = (code: string, timeoutMs = 5000, target?: unknown) => {
    const id = randomUUID();
    const message: Record<string, unknown> = {
      v: 1,
      type: 'run_task',
      taskId: id,
      seq: 1,
      script: code,
      limits: { timeoutMs, maxOutputBytes: 65536, maxBridgeCalls: 32 },
    };
    if (target !== undefined) message.target = target;
    listener(message);
    return id;
  };
  const bridgeResult = (
    taskId: string,
    seq: number,
    callId: number,
    outcome:
      | { ok: true; value?: unknown }
      | { ok: false; error: { code: string; message: string } },
  ) => {
    listener(
      outcome.ok
        ? {
            v: 1,
            type: 'bridge_result',
            taskId,
            seq,
            callId,
            ok: true,
            value: outcome.value,
          }
        : {
            v: 1,
            type: 'bridge_result',
            taskId,
            seq,
            callId,
            ok: false,
            error: outcome.error,
          },
    );
  };
  return {
    get listener() {
      return listener;
    },
    sent,
    send,
    stop,
    log,
    run,
    bridgeResult,
  };
}

const tabs = [
  {
    browserId: 'b1',
    tabId: 't1',
    generation: 1,
    title: 'Example',
    url: 'https://example.test/',
    active: true,
    claimed: true,
  },
];

async function answerTabs(h: Harness, taskId: string) {
  await vi.waitFor(() => {
    expect(
      h.sent.filter((message) => message.type === 'bridge_call'),
    ).toHaveLength(1);
  });
  const call = h.sent.find((message) => message.type === 'bridge_call');
  if (call?.type !== 'bridge_call') throw new Error('missing bridge_call');
  expect(call.method).toBe('tabs.list');
  expect(call.args).toEqual([]);
  h.bridgeResult(taskId, 2, call.callId, { ok: true, value: tabs });
  await vi.waitFor(() => {
    expect(
      h.sent.filter((message) => message.type === 'bridge_call'),
    ).toHaveLength(2);
  });
  const second = h.sent.filter((message) => message.type === 'bridge_call')[1];
  if (second?.type !== 'bridge_call') throw new Error('missing bridge_call');
  expect(second.method).toBe('tab.title');
  expect(second.args).toEqual([]);
  h.bridgeResult(taskId, 3, second.callId, { ok: true, value: 'Example' });
}

it('runs the M1 acceptance script through tabs.list and tab.title', async () => {
  const h = harness();
  const id = h.run(
    'return { tabs: await browser.tabs.list(), title: await browser.tab.title() };',
  );
  await answerTabs(h, id);
  await vi.waitFor(() => {
    expect(
      h.sent.filter((message) => message.type === 'task_result'),
    ).toHaveLength(1);
  });
  expect(h.sent.at(-1)).toEqual({
    v: 1,
    type: 'task_result',
    taskId: id,
    seq: 3,
    state: 'succeeded',
    result: { tabs, title: 'Example' },
  });
  expect(h.stop).not.toHaveBeenCalled();
});

it('reports INVALID_ARGUMENT without sending anything to the bridge', async () => {
  const h = harness();
  const id = h.run(
    'try { await browser.tabs.get(42); return "sent"; } catch (e) { return e.code; }',
  );
  await vi.waitFor(() => {
    expect(
      h.sent.filter((message) => message.type === 'task_result'),
    ).toHaveLength(1);
  });
  expect(h.sent.at(-1)).toEqual({
    v: 1,
    type: 'task_result',
    taskId: id,
    seq: 1,
    state: 'succeeded',
    result: 'INVALID_ARGUMENT',
  });
  expect(h.sent.some((message) => message.type === 'bridge_call')).toBe(false);
  const next = h.run('return await browser.capabilities.get("tabs.list");');
  await vi.waitFor(() => {
    expect(
      h.sent.filter((message) => message.type === 'bridge_call'),
    ).toHaveLength(1);
  });
  const call = h.sent.find((message) => message.type === 'bridge_call');
  if (call?.type !== 'bridge_call') throw new Error('missing bridge_call');
  expect(call.method).toBe('capabilities.get');
  expect(call.args).toEqual(['tabs.list']);
  h.bridgeResult(next, 2, call.callId, {
    ok: true,
    value: SDK_CAPABILITIES[0],
  });
  await vi.waitFor(() => {
    expect(
      h.sent.filter((message) => message.type === 'task_result'),
    ).toHaveLength(2);
  });
  expect(h.sent.at(-1)).toEqual({
    v: 1,
    type: 'task_result',
    taskId: next,
    seq: 2,
    state: 'succeeded',
    result: SDK_CAPABILITIES[0],
  });
});

it('rejects a non-JSON __hostCall payload as INVALID_ARGUMENT', async () => {
  const h = harness();
  const id = h.run('return await __hostCall("mock.echo", "x");');
  await vi.waitFor(() => {
    expect(
      h.sent.filter((message) => message.type === 'task_result'),
    ).toHaveLength(1);
  });
  expect(h.sent.at(-1)).toEqual({
    v: 1,
    type: 'task_result',
    taskId: id,
    seq: 1,
    state: 'failed',
    reason: 'script',
  });
  expect(h.sent.some((message) => message.type === 'bridge_call')).toBe(false);
});

it('exposes browser control methods but no Node ambient process access', async () => {
  const h = harness();
  const id = h.run(
    'return [typeof browser.tab.click, typeof browser.tabs.new, typeof browser.tabs.close, typeof browser.tabs.select, typeof browser.tab.title, typeof require, typeof process];',
  );
  await vi.waitFor(() => {
    expect(
      h.sent.filter((message) => message.type === 'task_result'),
    ).toHaveLength(1);
  });
  expect(h.sent.at(-1)).toEqual({
    v: 1,
    type: 'task_result',
    taskId: id,
    seq: 1,
    state: 'succeeded',
    result: [
      'function',
      'function',
      'function',
      'function',
      'function',
      'undefined',
      'undefined',
    ],
  });
});

it('exposes the claimed target ids on browser.tab', async () => {
  const h = harness();
  const id = h.run(
    'return [browser.tab.browserId, browser.tab.tabId, browser.tab.generation];',
    5000,
    {
      browserId: 'b1',
      tabId: 't1',
      generation: 3,
    },
  );
  await vi.waitFor(() => {
    expect(
      h.sent.filter((message) => message.type === 'task_result'),
    ).toHaveLength(1);
  });
  expect(h.sent.at(-1)).toEqual({
    v: 1,
    type: 'task_result',
    taskId: id,
    seq: 1,
    state: 'succeeded',
    result: ['b1', 't1', 3],
  });
});

it('surfaces bridge error codes as SdkError codes', async () => {
  const h = harness();
  const id = h.run(
    'try { await browser.tabs.list(); return "ok"; } catch (e) { return e.code; }',
  );
  await vi.waitFor(() => {
    expect(
      h.sent.filter((message) => message.type === 'bridge_call'),
    ).toHaveLength(1);
  });
  const call = h.sent.find((message) => message.type === 'bridge_call');
  if (call?.type !== 'bridge_call') throw new Error('missing bridge_call');
  h.bridgeResult(id, 2, call.callId, {
    ok: false,
    error: { code: 'TARGET_GONE', message: 'target gone' },
  });
  await vi.waitFor(() => {
    expect(
      h.sent.filter((message) => message.type === 'task_result'),
    ).toHaveLength(1);
  });
  expect(h.sent.at(-1)).toEqual({
    v: 1,
    type: 'task_result',
    taskId: id,
    seq: 2,
    state: 'succeeded',
    result: 'TARGET_GONE',
  });
});

it('answers ping, cancels via cancel_task, and drops late bridge results', async () => {
  const h = harness();
  h.listener({ v: 1, type: 'ping', taskId: '', seq: 1 });
  expect(h.sent).toContainEqual({ v: 1, type: 'pong', taskId: '', seq: 1 });
  h.listener({ v: 1, type: 'ping', taskId: '', seq: 1 });
  expect(h.sent.filter((message) => message.type === 'pong')).toHaveLength(1);
  expect(h.log).toHaveBeenCalled();

  const id = h.run('return await __hostCall("mock.echo", \'"x"\');');
  await vi.waitFor(() => {
    expect(
      h.sent.filter((message) => message.type === 'bridge_call'),
    ).toHaveLength(1);
  });
  h.listener({ v: 1, type: 'cancel_task', taskId: id, seq: 2 });
  await vi.waitFor(() => {
    expect(
      h.sent.filter((message) => message.type === 'task_result'),
    ).toHaveLength(1);
  });
  expect(h.sent.at(-1)).toEqual({
    v: 1,
    type: 'task_result',
    taskId: id,
    seq: 2,
    state: 'cancelled',
  });
  // The cancelled call's late result must be dropped, not forwarded.
  h.bridgeResult(id, 3, 1, { ok: true, value: 'late' });
  expect(h.stop).not.toHaveBeenCalled();
  const next = h.run('return 2;');
  await vi.waitFor(() => {
    expect(
      h.sent.filter((message) => message.type === 'task_result'),
    ).toHaveLength(2);
  });
  expect(h.sent.at(-1)).toEqual({
    v: 1,
    type: 'task_result',
    taskId: next,
    seq: 1,
    state: 'succeeded',
    result: 2,
  });
});

it('maps pure-compute timeouts to TIMEOUT and bridge timeouts to unknown', async () => {
  const h = harness();
  const pure = h.run('while(true){}', 20);
  await vi.waitFor(() => {
    expect(
      h.sent.filter((message) => message.type === 'task_result'),
    ).toHaveLength(1);
  });
  expect(h.sent.at(-1)).toEqual({
    v: 1,
    type: 'task_result',
    taskId: pure,
    seq: 1,
    state: 'failed',
    error: { code: 'TIMEOUT', message: 'task timed out' },
  });
  const hanging = h.run('return await __hostCall("mock.echo", \'"x"\');', 20);
  await vi.waitFor(() => {
    expect(
      h.sent.filter((message) => message.type === 'task_result'),
    ).toHaveLength(2);
  });
  expect(h.sent.at(-1)).toEqual({
    v: 1,
    type: 'task_result',
    taskId: hanging,
    seq: 2,
    state: 'unknown',
    error: {
      code: 'UNKNOWN_RESULT',
      message: 'a bridge call may have executed; result unknown',
    },
  });
});

it('fails closed on concurrent or malformed run_task messages', async () => {
  const h = harness();
  const id = h.run('return await __hostCall("mock.echo", \'"x"\');');
  await vi.waitFor(() => {
    expect(
      h.sent.filter((message) => message.type === 'bridge_call'),
    ).toHaveLength(1);
  });
  h.listener({
    v: 1,
    type: 'run_task',
    taskId: randomUUID(),
    seq: 1,
    script: 'return 2;',
    limits: { timeoutMs: 5000, maxOutputBytes: 65536, maxBridgeCalls: 32 },
  });
  expect(h.stop).toHaveBeenCalledOnce();
  expect(h.log).toHaveBeenCalled();
  const h2 = harness();
  h2.listener({
    v: 1,
    type: 'run_task',
    taskId: 'invalid',
    seq: 1,
    script: '',
    limits: { timeoutMs: 5000, maxOutputBytes: 65536, maxBridgeCalls: 32 },
  });
  expect(h2.stop).toHaveBeenCalledOnce();
  expect(id).toBeTruthy();
});

it('fails closed if the engine itself cannot initialize', async () => {
  const engine = await import('../src/engine.js');
  const failure = vi
    .spyOn(engine, 'execute')
    .mockRejectedValueOnce(new Error('engine startup'));
  const h = harness();
  h.run('return 1;');
  await vi.waitFor(() => {
    expect(h.stop).toHaveBeenCalledOnce();
  });
  failure.mockRestore();
});
