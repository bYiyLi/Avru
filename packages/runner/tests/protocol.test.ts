import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { isRun, isReply, isCall, isDone, limits } from '../src/protocol.js';
it('rejects malformed, oversized and misdirected IPC envelopes', () => {
  const id = randomUUID();
  for (const bad of [
    null,
    [],
    '',
    3,
    {},
    { id: 'bad', type: 'run', code: '' },
  ]) {
    expect(isRun(bad)).toBe(false);
    expect(isReply(bad)).toBe(false);
    expect(isCall(bad)).toBe(false);
    expect(isDone(bad)).toBe(false);
  }
  expect(isRun({ type: 'run', id, code: '' })).toBe(true);
  expect(
    isRun({ type: 'run', id, code: 'x'.repeat(limits.sourceBytes + 1) }),
  ).toBe(false);
  expect(isReply({ type: 'reply', id, call: 1, json: 'null' })).toBe(true);
  expect(
    isCall({ type: 'call', id, call: 1, method: 'mock.echo', json: 'null' }),
  ).toBe(true);
  expect(
    isCall({ type: 'call', id, call: -1, method: 'mock.echo', json: 'null' }),
  ).toBe(false);
  expect(isDone({ type: 'done', id, result: { status: 'timeout' } })).toBe(
    true,
  );
  expect(
    isDone({
      type: 'done',
      id,
      result: { status: 'failed', reason: 'script' },
    }),
  ).toBe(true);
  expect(
    isDone({ type: 'done', id, result: { status: 'completed', json: '1' } }),
  ).toBe(true);
  expect(
    isDone({ type: 'done', id, result: { status: 'completed', json: 1 } }),
  ).toBe(false);
});
