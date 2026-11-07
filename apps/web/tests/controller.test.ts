import { afterEach, expect, it, vi } from 'vitest';
import { createController } from '../src/controller.js';
const profile = {
  id: 'one',
  name: 'Chrome',
  connected: true,
  connectionId: 'ws1',
  tabs: [],
};
const pending = {
  id: 'pending',
  name: 'Chrome',
  code: '123456',
  expiresAt: 100,
  origin: 'chrome-extension://test',
};
function setup() {
  const request = vi.fn<typeof fetch>().mockImplementation((input) =>
    Promise.resolve(
      Response.json(
        (input as string).endsWith('browsers')
          ? { browsers: [profile] }
          : (input as string).endsWith('pairings')
            ? { pairings: [pending] }
            : {
                daemonVersion: '0.1.0-dev.1',
                expectedExtensionVersion: '0.0.1',
                mcp: 'notImplemented',
                chatgpt: 'notImplemented',
                frpc: 'notImplemented',
              },
      ),
    ),
  );
  const clear = vi.fn();
  return {
    request,
    clear,
    controller: createController({ key: 'secret', clear }, request),
  };
}
afterEach(() => {
  vi.useRealTimers();
});
it('polls sequentially, stops and ignores stale results', async () => {
  vi.useFakeTimers();
  const { controller, request } = setup();
  const listener = vi.fn();
  const unsubscribe = controller.subscribe(listener);
  controller.start();
  controller.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(controller.snapshot().browsers).toEqual([profile]);
  expect(controller.snapshot().pairings).toEqual([pending]);
  expect(request).toHaveBeenCalledTimes(3);
  expect(request.mock.calls[0]?.[1]).toMatchObject({
    cache: 'no-store',
    headers: { Authorization: 'Bearer secret' },
  });
  await vi.advanceTimersByTimeAsync(2000);
  expect(request).toHaveBeenCalledTimes(6);
  unsubscribe();
  controller.stop();
  await vi.advanceTimersByTimeAsync(2000);
  expect(listener).toHaveBeenCalledTimes(2);
  controller.start();
  controller.stop();
  await vi.advanceTimersByTimeAsync(0);
  expect(request).toHaveBeenCalledTimes(9);
});
it('approves, rejects and revokes only through explicit actions', async () => {
  vi.useFakeTimers();
  const { controller, request } = setup();
  controller.start();
  await vi.advanceTimersByTimeAsync(0);
  controller.stop();
  request.mockResolvedValue(new Response(null, { status: 204 }));
  await controller.approve('pending');
  expect(controller.snapshot().pairings).toEqual([]);
  await controller.reject('pending');
  await controller.revoke('one');
  expect(controller.snapshot().browsers).toEqual([]);
  expect(request.mock.calls[3]).toEqual([
    '/api/pairings/pending/approve',
    expect.objectContaining({ method: 'POST', body: '{}' }),
  ]);
});
it('handles request errors and expired authorization without exposing data', async () => {
  vi.useFakeTimers();
  const { controller, request, clear } = setup();
  request.mockResolvedValue(new Response(null, { status: 503 }));
  controller.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(controller.snapshot().message).toContain('重试');
  await controller.approve('bad');
  expect(controller.snapshot().message).toContain('请求失败');
  request.mockRejectedValue('offline');
  await controller.reject('bad');
  expect(controller.snapshot().message).toBe('请求失败');
  request.mockResolvedValue(new Response(null, { status: 401 }));
  await vi.advanceTimersByTimeAsync(2000);
  expect(clear).toHaveBeenCalled();
  expect(controller.snapshot().authorized).toBe(false);
  const count = request.mock.calls.length;
  await controller.revoke('one');
  controller.stop();
  controller.start();
  expect(request).toHaveBeenCalledTimes(count);
});
it('does not overlap mutations or poll requests', async () => {
  vi.useFakeTimers();
  const { controller, request } = setup();
  let resolve: (value: Response) => void = () => {
    throw new Error('missing request');
  };
  request.mockImplementation(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  const action = controller.approve('one');
  await controller.reject('two');
  expect(request).toHaveBeenCalledTimes(1);
  resolve(new Response(null, { status: 204 }));
  await action;
  controller.start();
  await vi.advanceTimersByTimeAsync(6000);
  expect(request).toHaveBeenCalledTimes(2);
  controller.stop();
  resolve(Response.json({ browsers: [] }));
  await Promise.resolve();
});
it('does not restore a revoked profile from an earlier poll response', async () => {
  vi.useFakeTimers();
  const { controller, request } = setup();
  controller.start();
  await vi.advanceTimersByTimeAsync(0);
  let release: (value: Response) => void = () => {
    throw new Error('missing poll');
  };
  request.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  await vi.advanceTimersByTimeAsync(2000);
  request.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await controller.revoke('one');
  release(Response.json({ browsers: [profile] }));
  await vi.advanceTimersByTimeAsync(0);
  expect(controller.snapshot().browsers).toEqual([]);
  controller.stop();
});
