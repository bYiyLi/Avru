import { afterEach, expect, it, vi } from 'vitest';
import { createController } from '../src/controller.js';
import type { BrowserProfile } from '../src/controller.js';
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
        (input as string).endsWith('calls')
          ? { calls: [], retention: { limit: 200, persistent: false } }
          : (input as string).endsWith('browsers')
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
  expect(request).toHaveBeenCalledTimes(4);
  expect(request.mock.calls[0]?.[1]).toMatchObject({
    cache: 'no-store',
    headers: { Authorization: 'Bearer secret' },
  });
  await vi.advanceTimersByTimeAsync(2000);
  expect(request).toHaveBeenCalledTimes(8);
  unsubscribe();
  controller.stop();
  await vi.advanceTimersByTimeAsync(2000);
  expect(listener).toHaveBeenCalledTimes(2);
  controller.start();
  controller.stop();
  await vi.advanceTimersByTimeAsync(0);
  expect(request).toHaveBeenCalledTimes(12);
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
  expect(request.mock.calls[5]?.[1]).toMatchObject({
    method: 'DELETE',
    headers: { Authorization: 'Bearer secret' },
  });
  expect(request.mock.calls[5]?.[1]?.headers).not.toHaveProperty(
    'Content-Type',
  );
  expect(request.mock.calls[5]?.[1]?.body).toBeUndefined();
  await controller.revoke('one');
  expect(controller.snapshot().browsers).toEqual([]);
  expect(request.mock.calls[4]).toEqual([
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
  expect(controller.snapshot().message).toBe('connection.retrying');
  await controller.approve('bad');
  expect(controller.snapshot().message).toBe('request.failed');
  request.mockRejectedValue('offline');
  await controller.reject('bad');
  expect(controller.snapshot().message).toBe('request.failed');
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

it('keeps stable expired-session errors on actions and never exposes raw exceptions', async () => {
  const { controller, request } = setup();
  request.mockRejectedValue(new Error('sensitive internal failure'));
  await controller.approve('one');
  expect(controller.snapshot().message).toBe('request.failed');
  request.mockResolvedValue(new Response(null, { status: 401 }));
  await controller.revoke('one');
  expect(controller.snapshot().message).toBe('session.expired');
  expect(controller.snapshot().authorized).toBe(false);
});
function diagnosticsSetup(options: {
  health?: 'ok' | 'down' | 'throws';
  status?: 'ok' | 'expired' | 'down';
  mcp?: 'notImplemented' | 'oauthReadOnly';
  browsers?: BrowserProfile[] | 'down';
}) {
  const request = vi.fn<typeof fetch>().mockImplementation((input) => {
    const url = input as string;
    if (url === '/health') {
      if (options.health === 'throws')
        return Promise.reject(new Error('offline'));
      if (options.health === 'down')
        return Promise.resolve(new Response(null, { status: 503 }));
      return Promise.resolve(
        Response.json({
          service: 'avru',
          state: 'browser-connection',
          browserControl: false,
        }),
      );
    }
    if (url.endsWith('/api/status')) {
      if (options.status === 'expired')
        return Promise.resolve(new Response(null, { status: 401 }));
      if (options.status === 'down')
        return Promise.resolve(new Response(null, { status: 503 }));
      return Promise.resolve(
        Response.json({
          daemonVersion: '0.1.0-dev.1',
          expectedExtensionVersion: '0.0.1',
          mcp: options.mcp ?? 'notImplemented',
          chatgpt: 'notImplemented',
          frpc: 'notImplemented',
        }),
      );
    }
    if (url.endsWith('/api/browsers')) {
      if (options.browsers === 'down')
        return Promise.resolve(new Response(null, { status: 503 }));
      return Promise.resolve(
        Response.json({ browsers: options.browsers ?? [] }),
      );
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });
  const clear = vi.fn();
  const controller = createController({ key: 'secret', clear }, request);
  return { controller, request, clear };
}
const healthyBrowser: BrowserProfile = {
  id: 'one',
  name: 'Chrome',
  connected: true,
  connectionId: 'ws1',
  tabs: [],
  metadata: {
    browserName: 'Chrome',
    browserVersion: '150.0.1',
    versionSource: 'clientHints',
    extensionVersion: '0.0.1',
  },
};
it('diagnoses the call chain step by step without inventing causes', async () => {
  const healthy = diagnosticsSetup({
    mcp: 'oauthReadOnly',
    browsers: [healthyBrowser],
  });
  expect((await healthy.controller.runDiagnostics()).steps).toEqual([
    { id: 'daemon', status: 'passed' },
    { id: 'session', status: 'passed' },
    { id: 'extension', status: 'passed' },
    { id: 'mcp', status: 'passed' },
  ]);
  const down = diagnosticsSetup({ health: 'down' });
  expect((await down.controller.runDiagnostics()).steps).toEqual([
    { id: 'daemon', status: 'failed' },
    { id: 'session', status: 'unknown' },
    { id: 'extension', status: 'unknown' },
    { id: 'mcp', status: 'unknown' },
  ]);
  const offline = diagnosticsSetup({ health: 'throws' });
  expect((await offline.controller.runDiagnostics()).steps[0]).toEqual({
    id: 'daemon',
    status: 'failed',
  });
  const expired = diagnosticsSetup({ status: 'expired' });
  expect((await expired.controller.runDiagnostics()).steps).toEqual([
    { id: 'daemon', status: 'passed' },
    { id: 'session', status: 'failed' },
    { id: 'extension', status: 'unknown' },
    { id: 'mcp', status: 'unknown' },
  ]);
  expect(expired.clear).toHaveBeenCalled();
  expect(expired.controller.snapshot().authorized).toBe(false);
  const statusDown = diagnosticsSetup({ status: 'down' });
  expect((await statusDown.controller.runDiagnostics()).steps[1]).toEqual({
    id: 'session',
    status: 'failed',
  });
});
it('reports the observed extension breakpoint, not an install verdict', async () => {
  const none = diagnosticsSetup({});
  expect((await none.controller.runDiagnostics()).steps[2]).toEqual({
    id: 'extension',
    status: 'failed',
  });
  const browsersDown = diagnosticsSetup({ browsers: 'down' });
  expect((await browsersDown.controller.runDiagnostics()).steps[2]).toEqual({
    id: 'extension',
    status: 'failed',
  });
  const mismatch = diagnosticsSetup({
    mcp: 'oauthReadOnly',
    browsers: [
      {
        ...healthyBrowser,
        metadata: {
          browserName: 'Chrome',
          browserVersion: '150.0.1',
          versionSource: 'clientHints',
          extensionVersion: '0.0.2',
        },
      },
    ],
  });
  expect((await mismatch.controller.runDiagnostics()).steps).toEqual([
    { id: 'daemon', status: 'passed' },
    { id: 'session', status: 'passed' },
    { id: 'extension', status: 'failed' },
    { id: 'mcp', status: 'passed' },
  ]);
  const unknownVersion = diagnosticsSetup({
    mcp: 'oauthReadOnly',
    browsers: [{ ...healthyBrowser, metadata: null }],
  });
  expect((await unknownVersion.controller.runDiagnostics()).steps[2]).toEqual({
    id: 'extension',
    status: 'unknown',
  });
});
