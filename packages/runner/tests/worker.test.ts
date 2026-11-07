import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { attachWorker } from '../src/worker.js';
it('serves sequential isolated tasks, routes mock replies, rejects concurrent or stale messages', async () => {
  let listener: (message: unknown) => void = () => undefined;
  const stop = vi.fn();
  const sent: unknown[] = [];
  const send = vi.fn((message: unknown) => {
    sent.push(message);
  });
  attachWorker({
    onMessage: (cb) => {
      listener = cb;
    },
    send,
    stop,
  });
  const id = randomUUID();
  listener({
    type: 'run',
    id,
    code: 'return await __hostCall("mock.echo", "x");',
  });
  await vi.waitFor(() => {
    expect(send).toHaveBeenCalled();
  });
  listener({ type: 'run', id: randomUUID(), code: '' });
  expect(stop).toHaveBeenCalledOnce();
  listener({ type: 'reply', id, call: 1, json: 'ok' });
  await vi.waitFor(() => {
    expect(sent).toContainEqual({
      type: 'done',
      id,
      result: { status: 'completed', json: '"ok"' },
    });
  });
  listener({ type: 'reply', id, call: 1, json: 'late' });
  expect(stop).toHaveBeenCalledTimes(2);
  const next = randomUUID();
  listener({ type: 'run', id: next, code: 'return 2;' });
  await vi.waitFor(() => {
    expect(sent).toContainEqual({
      type: 'done',
      id: next,
      result: { status: 'completed', json: '2' },
    });
  });
});

it('fails closed if the engine itself cannot initialize', async () => {
  const engine = await import('../src/engine.js');
  const failure = vi
    .spyOn(engine, 'execute')
    .mockRejectedValueOnce(new Error('engine startup'));
  let listener: (message: unknown) => void = () => undefined;
  const stop = vi.fn();
  attachWorker({
    onMessage: (cb) => {
      listener = cb;
    },
    send: vi.fn(),
    stop,
  });
  listener({ type: 'run', id: randomUUID(), code: '' });
  await vi.waitFor(() => {
    expect(stop).toHaveBeenCalledOnce();
  });
  failure.mockRestore();
});
