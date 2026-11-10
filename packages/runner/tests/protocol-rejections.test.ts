import { describe, expect, it } from 'vitest';
import {
  isBridgeCall,
  isBridgeResult,
  isCancelTask,
  isRunTarget,
  isRunTask,
  isTaskResult,
  limits,
} from '../src/protocol';

const id = '11111111-1111-4111-8111-111111111111';
const task = {
  v: 1,
  type: 'run_task',
  taskId: id,
  seq: 1,
  script: 'return 1;',
  target: { browserId: 'browser-a', tabId: '7', generation: 1 },
  limits: { timeoutMs: 60_000, maxOutputBytes: 4_096, maxBridgeCalls: 16 },
};

describe('hostile runner protocol payloads', () => {
  it('rejects malformed target identities and generation values', () => {
    expect(isRunTarget(task.target)).toBe(true);
    for (const input of [
      null,
      [],
      {},
      { ...task.target, browserId: 123 },
      { ...task.target, browserId: '' },
      { ...task.target, tabId: 7 },
      { ...task.target, tabId: '' },
      { ...task.target, generation: '1' },
      { ...task.target, generation: NaN },
      { ...task.target, generation: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      expect(isRunTarget(input)).toBe(false);
    }
  });

  it('rejects malformed run-task envelopes and each numeric budget', () => {
    expect(isRunTask(task)).toBe(true);
    for (const input of [
      null,
      {},
      { ...task, taskId: '' },
      { ...task, seq: 0 },
      { ...task, seq: 1.5 },
      { ...task, target: { ...task.target, generation: -1 } },
      { ...task, target: { ...task.target, browserId: false } },
      { ...task, limits: [] },
      { ...task, limits: { ...task.limits, timeoutMs: NaN } },
      { ...task, limits: { ...task.limits, timeoutMs: Infinity } },
      {
        ...task,
        limits: { ...task.limits, maxOutputBytes: limits.valueBytes + 1 },
      },
      { ...task, limits: { ...task.limits, maxBridgeCalls: 0 } },
      { ...task, limits: { ...task.limits, maxBridgeCalls: 1.5 } },
    ]) {
      expect(isRunTask(input)).toBe(false);
    }
  });

  it('rejects hostile cancellation requests and invalid bridge call methods', () => {
    expect(
      isCancelTask({
        v: 1,
        type: 'cancel_task',
        taskId: id,
        seq: 2,
        reason: 'stop',
      }),
    ).toBe(true);
    for (const input of [
      { v: 1, type: 'cancel_task', taskId: id, seq: 2, reason: 12 },
      { v: 1, type: 'cancel_task', taskId: 'forged', seq: 2 },
      { v: 1, type: 'cancel_task', taskId: id, seq: 0 },
      { v: 1, type: 'cancel_task', taskId: id, seq: 1.4 },
    ])
      expect(isCancelTask(input)).toBe(false);
    const call = {
      v: 1,
      type: 'bridge_call',
      taskId: id,
      seq: 1,
      callId: 1,
      method: 'tabs.list',
      args: [],
    };
    expect(isBridgeCall(call)).toBe(true);
    for (const input of [
      { ...call, taskId: 'bad' },
      { ...call, callId: 0 },
      { ...call, callId: 1.5 },
      { ...call, callId: '1' },
      { ...call, method: 7 },
      { ...call, method: 'Runtime.evaluate' },
      { ...call, method: 'x'.repeat(65) },
      {
        v: 1,
        type: 'bridge_call',
        taskId: id,
        seq: 1,
        callId: 1,
        method: 'tabs.list',
      },
    ])
      expect(isBridgeCall(input)).toBe(false);
  });

  it('rejects malformed bridge results while accepting explicit null values', () => {
    const reply = {
      v: 1,
      type: 'bridge_result',
      taskId: id,
      seq: 2,
      callId: 1,
      ok: true,
      value: null,
    };
    expect(isBridgeResult(reply)).toBe(true);
    for (const input of [
      { ...reply, taskId: '' },
      { ...reply, seq: 0 },
      { ...reply, callId: '1' },
      { ...reply, callId: 0 },
      { ...reply, callId: NaN },
      { ...reply, ok: 'true' },
      { v: 1, type: 'bridge_result', taskId: id, seq: 2, callId: 1, ok: true },
      { ...reply, ok: false, error: null },
      { ...reply, ok: false, error: {} },
      { ...reply, ok: false, error: { code: 42, message: 'failure' } },
      { ...reply, ok: false, error: { code: 'FAILED', message: 42 } },
    ])
      expect(isBridgeResult(input)).toBe(false);
  });

  it('rejects invalid task terminal results without losing cancellation states', () => {
    const done = {
      v: 1,
      type: 'task_result',
      taskId: id,
      seq: 2,
      state: 'unknown',
    };
    expect(isTaskResult(done)).toBe(true);
    for (const input of [
      { ...done, taskId: 'bad' },
      { ...done, seq: 0 },
      { ...done, state: 'running' },
      { ...done, reason: 'timeout' },
      { ...done, error: null },
      { ...done, error: { code: 42, message: 'failed' } },
      { ...done, error: { code: 'FAILED', message: null } },
    ])
      expect(isTaskResult(input)).toBe(false);
  });
});
