import { afterEach, expect, it, vi } from 'vitest';
import { createController } from '../src/controller.js';
import type { ConnectionStatus } from '../../../packages/protocol/connection.d.ts';
const status: ConnectionStatus = {
  state: 'unconfigured',
  configured: false,
  issuer: null,
  mcpUrl: null,
  programVersion: '0.72.0',
  programAvailable: true,
  events: [],
  retention: { limit: 200, persistent: true },
  verification: { publicEntry: 'notVerified', chatgpt: 'notVerified' },
};
function fixture() {
  const request = vi.fn<typeof fetch>().mockImplementation((path) => {
    const name = path as string;
    return Promise.resolve(
      Response.json(
        name.endsWith('/browsers')
          ? { browsers: [] }
          : name.endsWith('/pairings')
            ? { pairings: [] }
            : name.endsWith('/calls')
              ? { calls: [], retention: { limit: 200, persistent: true } }
              : name.endsWith('/status')
                ? {
                    frpc: 'managed',
                    mcp: 'notImplemented',
                    chatgpt: 'notVerified',
                  }
                : status,
      ),
    );
  });
  const clear = vi.fn();
  return {
    request,
    controller: createController({ key: 'key', clear }, request),
    clear,
  };
}
afterEach(() => {
  vi.useRealTimers();
});
it('imports through the authenticated API and clears stale connection status on failures', async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.controller.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.controller.snapshot().connection).toEqual(status);
  f.controller.stop();
  f.request.mockResolvedValueOnce(
    Response.json({ ...status, configured: true, state: 'connecting' }),
  );
  await f.controller.importConnection({ local: 'configuration' });
  expect(f.request).toHaveBeenLastCalledWith(
    '/api/connection/import',
    expect.objectContaining({
      method: 'POST',
      body: '{"local":"configuration"}',
    }),
  );
  expect(f.controller.snapshot().connection?.configured).toBe(true);
  f.request.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await f.controller.clearConnection();
  expect(f.controller.snapshot().connection).toBeNull();
  f.request.mockRejectedValueOnce(new Error('private credential text'));
  await expect(f.controller.importConnection({})).rejects.toThrow(
    'request.failed',
  );
  expect(JSON.stringify(f.controller.snapshot())).not.toContain('private');
  f.request.mockResolvedValueOnce(new Response(null, { status: 401 }));
  await expect(f.controller.clearConnection()).rejects.toThrow(
    'request.failed',
  );
  expect(f.clear).toHaveBeenCalled();
  await expect(f.controller.importConnection({})).rejects.toThrow(
    'request.failed',
  );
});
it('serializes connection changes and never reuses a connection snapshot after losing the service', async () => {
  vi.useFakeTimers();
  const f = fixture();
  let release: (response: Response) => void = () => {};
  f.request.mockImplementationOnce(
    () =>
      new Promise<Response>((done) => {
        release = done;
      }),
  );
  const importing = f.controller.importConnection({});
  await expect(f.controller.clearConnection()).rejects.toThrow(
    'request.failed',
  );
  release(Response.json(status));
  await importing;
  f.controller.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.controller.snapshot().connection).toEqual(status);
  f.request.mockRejectedValue(new Error('offline'));
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.controller.snapshot().connection).toBeNull();
  f.controller.stop();
});
