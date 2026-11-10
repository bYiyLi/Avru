import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  clampInt,
  clampTimeoutMs,
  decodeLine,
  encodeMessage,
  isBridgeCall,
  isBridgeResult,
  isCancelTask,
  isPing,
  isPong,
  isRunTarget,
  isRunTask,
  isTaskResult,
  limits,
} from '../src/protocol.js';

const id = randomUUID();
const runTask = {
  v: 1,
  type: 'run_task',
  taskId: id,
  seq: 1,
  script: 'return 1;',
  target: { browserId: 'b1', tabId: 't1', generation: 2 },
  limits: { timeoutMs: 60_000, maxOutputBytes: 64 * 1024, maxBridgeCalls: 32 },
};

it('validates production run_task envelopes and rejects bad targets/limits', () => {
  expect(isRunTask(runTask)).toBe(true);
  expect(
    isRunTask({ ...runTask, target: undefined, limits: runTask.limits }),
  ).toBe(true);
  for (const bad of [
    { ...runTask, seq: 2 },
    { ...runTask, taskId: 'not-a-uuid' },
    { ...runTask, script: 'x'.repeat(limits.sourceBytes + 1) },
    { ...runTask, target: { browserId: '', tabId: 't', generation: 0 } },
    { ...runTask, target: { browserId: 'b', tabId: 't', generation: -1 } },
    { ...runTask, limits: { ...runTask.limits, timeoutMs: 300_001 } },
    { ...runTask, limits: { ...runTask.limits, timeoutMs: 0 } },
    { ...runTask, limits: { ...runTask.limits, maxBridgeCalls: 33 } },
    { ...runTask, limits: { ...runTask.limits, maxOutputBytes: 0 } },
    { ...runTask, v: 2 },
    null,
    'run_task',
  ])
    expect(isRunTask(bad)).toBe(false);
  expect(isRunTarget(runTask.target)).toBe(true);
  expect(isRunTarget({ browserId: 'b', tabId: 't', generation: 0 })).toBe(true);
});

it('validates cancel_task, ping/pong, bridge_call and bridge_result', () => {
  expect(isCancelTask({ v: 1, type: 'cancel_task', taskId: id, seq: 2 })).toBe(
    true,
  );
  expect(
    isCancelTask({
      v: 1,
      type: 'cancel_task',
      taskId: id,
      seq: 2,
      reason: 'cancelled',
    }),
  ).toBe(true);
  expect(isCancelTask({ v: 1, type: 'cancel_task', taskId: id, seq: 0 })).toBe(
    false,
  );
  expect(isPing({ v: 1, type: 'ping', taskId: '', seq: 1 })).toBe(true);
  expect(isPing({ v: 1, type: 'ping', taskId: id, seq: 1 })).toBe(false);
  expect(isPong({ v: 1, type: 'pong', taskId: '', seq: 1 })).toBe(true);
  expect(isPong({ v: 1, type: 'pong', taskId: '', seq: 0 })).toBe(false);
  expect(
    isBridgeCall({
      v: 1,
      type: 'bridge_call',
      taskId: id,
      seq: 1,
      callId: 1,
      method: 'tabs.list',
      args: [],
    }),
  ).toBe(true);
  expect(
    isBridgeCall({
      v: 1,
      type: 'bridge_call',
      taskId: id,
      seq: 1,
      callId: 1,
      method: 'tabs.list',
    }),
  ).toBe(false);
  expect(
    isBridgeCall({
      v: 1,
      type: 'bridge_call',
      taskId: id,
      seq: 1,
      callId: 33,
      method: 'tabs.list',
      args: [],
    }),
  ).toBe(false);
  expect(
    isBridgeResult({
      v: 1,
      type: 'bridge_result',
      taskId: id,
      seq: 2,
      callId: 1,
      ok: true,
      value: [1],
    }),
  ).toBe(true);
  expect(
    isBridgeResult({
      v: 1,
      type: 'bridge_result',
      taskId: id,
      seq: 2,
      callId: 1,
      ok: false,
      error: { code: 'TARGET_GONE', message: 'gone' },
    }),
  ).toBe(true);
  expect(
    isBridgeResult({
      v: 1,
      type: 'bridge_result',
      taskId: id,
      seq: 2,
      callId: 1,
      ok: false,
    }),
  ).toBe(false);
});

it('accepts every terminal Result status in task_result (isDone fix)', () => {
  // The old isDone accepted only completed/timeout/failed although Result
  // also contains cancelled/crashed/unknown; the fix allows them instead
  // of removing them from Result.
  for (const state of ['succeeded', 'failed', 'cancelled', 'unknown'])
    expect(
      isTaskResult({ v: 1, type: 'task_result', taskId: id, seq: 1, state }),
    ).toBe(true);
  expect(
    isTaskResult({
      v: 1,
      type: 'task_result',
      taskId: id,
      seq: 1,
      state: 'succeeded',
      result: { tabs: [] },
    }),
  ).toBe(true);
  expect(
    isTaskResult({
      v: 1,
      type: 'task_result',
      taskId: id,
      seq: 1,
      state: 'failed',
      error: { code: 'TIMEOUT', message: 'timed out' },
    }),
  ).toBe(true);
  expect(
    isTaskResult({
      v: 1,
      type: 'task_result',
      taskId: id,
      seq: 1,
      state: 'failed',
      reason: 'bogus',
    }),
  ).toBe(false);
  expect(
    isTaskResult({
      v: 1,
      type: 'task_result',
      taskId: id,
      seq: 1,
      state: 'queued',
    }),
  ).toBe(false);
});

it('clamps production timeoutMs and per-task budgets', () => {
  expect(clampTimeoutMs(undefined)).toBe(limits.timeoutMs);
  expect(clampTimeoutMs(60_000)).toBe(60_000);
  expect(clampTimeoutMs(999_999)).toBe(limits.maxTimeoutMs);
  expect(clampTimeoutMs(0)).toBe(1);
  expect(clampTimeoutMs(Number.NaN)).toBe(limits.defaultTimeoutMs);
  expect(clampInt(undefined, 32)).toBe(32);
  expect(clampInt(0, 32)).toBe(1);
  expect(clampInt(100, 32)).toBe(32);
});

it('frames NDJSON lines at 64 KiB', () => {
  const line = encodeMessage({
    v: 1,
    type: 'pong',
    taskId: '',
    seq: 1,
  });
  expect(line?.endsWith('\n')).toBe(true);
  expect(decodeLine(line?.trim() ?? '')).toEqual({
    v: 1,
    type: 'pong',
    taskId: '',
    seq: 1,
  });
  expect(decodeLine('not json')).toBe(null);
  expect(decodeLine('x'.repeat(limits.messageBytes + 1))).toBe(null);
  expect(
    encodeMessage({
      v: 1,
      type: 'run_task',
      taskId: id,
      seq: 1,
      script: 'x'.repeat(limits.sourceBytes),
      limits: {
        timeoutMs: 5000,
        maxOutputBytes: 65536,
        maxBridgeCalls: 32,
      },
    }),
  ).toBe(null);
});
