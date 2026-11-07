import { afterEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../utils/connection';
import type { Ports, Socket } from '../utils/connection';
const saved = {
  endpoint: 'http://127.0.0.1:43821',
  profileId: 'profile',
  name: 'Work',
  browserId: 'browser',
  token: 'secret',
};
function setup(initial?: unknown, channel?: 'dev' | 'prod') {
  const sockets: Socket[] = [];
  const ports: Ports = {
    ...(channel ? { channel } : {}),
    read: vi.fn().mockResolvedValue(initial),
    save: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    tabs: vi
      .fn()
      .mockResolvedValue([{ id: 1, url: 'https://example.com/?secret=1' }]),
    uuid: () => 'profile',
    socket: () => {
      const socket: Socket = {
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        send: vi.fn(),
        close: vi.fn(),
      };
      sockets.push(socket);
      return socket;
    },
    later: (cb, delay) => setTimeout(cb, delay),
    cancel: (timer) => {
      clearTimeout(timer);
    },
  };
  const connection = new Connection(ports);
  const current = () => {
    const value = sockets.at(-1);
    if (!value) throw new Error('missing socket');
    return value;
  };
  const receive = async (message: unknown) => {
    current().onmessage?.(
      new MessageEvent('message', { data: JSON.stringify(message) }),
    );
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return { connection, ports, sockets, current, receive };
}
afterEach(() => {
  vi.useRealTimers();
});
describe('browser connection lifecycle', () => {
  it('pairs after visual confirmation, persists internal credentials and publishes redacted tabs', async () => {
    vi.useFakeTimers();
    const h = setup();
    await h.connection.start();
    expect(h.connection.status()).toBe('未配对');
    await h.connection.publish();
    await h.connection.pair({ endpoint: saved.endpoint, name: 'Work' });
    h.current().onopen?.(new Event('open'));
    expect(h.current().send).toHaveBeenCalledWith(
      JSON.stringify({
        v: 1,
        type: 'pair',
        profileId: 'profile',
        name: 'Work',
      }),
    );
    await h.receive({ v: 1, type: 'pairing', code: '123456' });
    expect(h.connection.status()).toContain('123456');
    await h.receive({
      v: 1,
      type: 'paired',
      browserId: 'browser',
      token: 'secret',
    });
    expect(h.ports.save).toHaveBeenCalledWith(saved);
    await h.receive({
      v: 1,
      type: 'ready',
      browserId: 'browser',
      connectionId: 'connection',
    });
    expect(h.connection.status()).toBe('已连接');
    expect(h.current().send).toHaveBeenCalledWith(
      JSON.stringify({
        v: 1,
        type: 'tabs',
        tabs: [{ id: 1, title: '', url: 'https://example.com/' }],
      }),
    );
    await vi.advanceTimersByTimeAsync(20000);
    expect(h.current().send).toHaveBeenCalledWith('{"v":1,"type":"ping"}');
    await h.receive({ v: 1, type: 'pong' });
    await h.connection.disconnect();
    expect(h.connection.status()).toBe('未配对');
  });
  it('restores credentials, backs off reconnects, ignores obsolete sockets and stops on rejection', async () => {
    vi.useFakeTimers();
    const h = setup(saved);
    await h.connection.start();
    const old = h.current();
    old.onopen?.(new Event('open'));
    expect(old.send).toHaveBeenCalledWith(
      '{"v":1,"type":"authenticate","browserId":"browser","token":"secret"}',
    );
    old.onclose?.(new Event('close') as CloseEvent);
    expect(h.connection.status()).toContain('重连');
    await vi.advanceTimersByTimeAsync(1000);
    old.onopen?.(new Event('open'));
    old.onclose?.(new Event('close') as CloseEvent);
    old.onerror?.(new Event('error'));
    old.onmessage?.(new MessageEvent('message', { data: '{' }));
    expect(h.sockets).toHaveLength(2);
    h.current().onerror?.(new Event('error'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.sockets).toHaveLength(3);
    await h.receive({ v: 1, type: 'error', code: 'revoked' });
    expect(h.connection.status()).toContain('重新配对');
    h.connection.reconnect();
    expect(h.sockets).toHaveLength(3);
    expect(h.ports.clear).toHaveBeenCalled();
  });
  it('fails closed for malformed messages and pairing timeout without credentials', async () => {
    const h = setup();
    await h.connection.pair({ endpoint: saved.endpoint, name: 'Work' });
    h.current().onclose?.(new Event('close') as CloseEvent);
    h.connection.reconnect();
    // A pairing is never retried with an empty credential.
    await h.connection.disconnect();
    for (const raw of [
      42,
      'x'.repeat(8193),
      '{}',
      '{',
      '{"v":1,"type":"paired"}',
    ]) {
      await h.connection.pair({ endpoint: saved.endpoint, name: 'Work' });
      h.current().onmessage?.(new MessageEvent('message', { data: raw }));
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(h.connection.status()).toContain('协议错误');
    }
  });
});

it('rejects unsolicited ready and expired pairing; recovers a silent heartbeat failure', async () => {
  vi.useFakeTimers();
  const h = setup(saved);
  await h.connection.start();
  for (const message of [
    { v: 1, type: 'ready', browserId: 'wrong', connectionId: 'c' },
    { v: 1, type: 'ready', browserId: 'browser' },
    { v: 1, type: 'ready', browserId: 'browser', connectionId: '' },
  ]) {
    await h.connection.start();
    await h.receive(message);
    expect(h.connection.status()).toContain('协议错误');
    await h.connection.pair({ endpoint: saved.endpoint, name: 'Work' });
    await h.receive({
      v: 1,
      type: 'paired',
      browserId: 'browser',
      token: 'secret',
    });
  }
  await h.receive({
    v: 1,
    type: 'ready',
    browserId: 'browser',
    connectionId: 'c',
  });
  await vi.advanceTimersByTimeAsync(40000);
  expect(h.connection.status()).toContain('重连');
  await vi.advanceTimersByTimeAsync(1000);
  await h.receive({ v: 1, type: 'error', code: 'expired' });
  expect(h.connection.status()).toContain('过期');
  await h.connection.pair({ endpoint: saved.endpoint, name: 'Work' });
  await h.receive({
    v: 1,
    type: 'ready',
    browserId: 'browser',
    connectionId: 'c',
  });
  expect(h.connection.status()).toContain('协议错误');
});
it('serializes credential writes behind disconnect and ignores obsolete async continuations', async () => {
  const h = setup(saved);
  await h.connection.start();
  let finish: (() => void) | undefined;
  vi.mocked(h.ports.save).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await h.receive({ v: 1, type: 'paired', browserId: 'browser', token: 'new' });
  const disconnect = h.connection.disconnect();
  finish?.();
  await disconnect;
  expect(h.ports.clear).toHaveBeenCalled();
  expect(h.connection.status()).toBe('未配对');
  const delayed = setup();
  let read: ((value: unknown) => void) | undefined;
  vi.mocked(delayed.ports.read).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        read = resolve;
      }),
  );
  const start = delayed.connection.start();
  await delayed.connection.disconnect();
  read?.(saved);
  await start;
  expect(delayed.sockets).toHaveLength(0);
  const second = setup(saved);
  await second.connection.start();
  let tabs: ((value: []) => void) | undefined;
  vi.mocked(second.ports.tabs).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        tabs = resolve;
      }),
  );
  await second.receive({
    v: 1,
    type: 'ready',
    browserId: 'browser',
    connectionId: 'c',
  });
  await second.connection.disconnect();
  tabs?.([]);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(second.current().send).not.toHaveBeenCalled();
});
it('retries transient timeout and rejects old tab snapshots from the same connection', async () => {
  vi.useFakeTimers();
  const h = setup(saved);
  await h.connection.start();
  await h.receive({
    v: 1,
    type: 'ready',
    browserId: 'browser',
    connectionId: 'c',
  });
  let finish: ((tabs: { id: number; url: string }[]) => void) | undefined;
  vi.mocked(h.ports.tabs).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const older = h.connection.publish();
  vi.mocked(h.ports.tabs).mockResolvedValueOnce([
    { id: 2, url: 'https://new.test/' },
  ]);
  await h.connection.publish();
  finish?.([{ id: 3, url: 'https://old.test/' }]);
  await older;
  expect(h.current().send).not.toHaveBeenCalledWith(
    expect.stringContaining('old.test'),
  );
  for (const code of ['timeout', 'busy']) {
    await h.receive({ v: 1, type: 'error', code });
    expect(h.connection.status()).toContain('重连');
    await vi.advanceTimersByTimeAsync(30000);
  }
  await h.connection.disconnect();
});
it('recovers when a socket closes between readiness and send', async () => {
  vi.useFakeTimers();
  const h = setup(saved);
  await h.connection.start();
  vi.mocked(h.current().send).mockImplementationOnce(() => {
    throw new Error('closed');
  });
  h.current().onopen?.(new Event('open'));
  expect(h.connection.status()).toContain('重连');
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.sockets).toHaveLength(2);
  await h.connection.disconnect();
});

it('sends metadata only after negotiated ready and ignores a superseded collection', async () => {
  vi.useFakeTimers();
  const h = setup(saved);
  const metadata = {
    browserName: 'Chrome',
    browserVersion: '140',
    versionSource: 'userAgent' as const,
    extensionVersion: '0.0.1',
  };
  h.ports.metadata = vi.fn().mockResolvedValue(metadata);
  await h.connection.start();
  await h.receive({
    v: 1,
    type: 'ready',
    browserId: 'browser',
    connectionId: 'c',
    metadataSupported: true,
  });
  expect(h.current().send).toHaveBeenCalledWith(
    JSON.stringify({ v: 1, type: 'metadata', metadata }),
  );
  let resolve: ((value: typeof metadata) => void) | undefined;
  h.ports.metadata = () =>
    new Promise((done) => {
      resolve = done;
    });
  await h.receive({
    v: 1,
    type: 'ready',
    browserId: 'browser',
    connectionId: 'c',
    metadataSupported: true,
  });
  await h.connection.disconnect();
  resolve?.(metadata);
  await Promise.resolve();
  expect(h.connection.status()).toBe('未配对');
});

it('only authenticated connection receives and sends consent messages', async () => {
  vi.useFakeTimers();
  const h = setup(saved);
  const request = {
    requestId: 'id',
    nonce: 'nonce',
    clientName: 'client',
    redirectUri: 'https://client.test/callback',
    resource: 'https://avru.test/mcp',
    scope: 'browser:read' as const,
    expiresAt: Date.now() + 10000,
  };
  h.ports.onOAuthRequest = vi.fn().mockResolvedValue(undefined);
  h.ports.onOAuthClose = vi.fn();
  h.ports.resetOAuth = vi.fn();
  await h.connection.start();
  h.connection.decideOAuth(request, true);
  expect(h.current().send).not.toHaveBeenCalled();
  await h.receive({
    v: 1,
    type: 'ready',
    browserId: saved.browserId,
    connectionId: 'connection',
  });
  await h.receive({ v: 1, type: 'oauth-request', ...request });
  expect(h.ports.onOAuthRequest).toHaveBeenCalledWith(
    expect.objectContaining(request),
  );
  h.connection.decideOAuth(request, true);
  expect(h.current().send).toHaveBeenCalledWith(
    JSON.stringify({
      v: 1,
      type: 'oauth-decision',
      requestId: 'id',
      nonce: 'nonce',
      approved: true,
    }),
  );
  await h.receive({ v: 1, type: 'oauth-close', requestId: 'id' });
  expect(h.ports.onOAuthClose).toHaveBeenCalledWith('id');
  await h.receive({ v: 1, type: 'oauth-close' });
  expect(h.connection.status()).toContain('协议错误');
  expect(h.ports.resetOAuth).toHaveBeenCalled();
  const fresh = setup(saved);
  await fresh.connection.start();
  await fresh.receive({ v: 1, type: 'oauth-request', ...request });
  expect(fresh.connection.status()).toContain('协议错误');
});
it('supports older adapters without consent UI without auto approving', async () => {
  vi.useFakeTimers();
  const h = setup(saved);
  await h.connection.start();
  await h.receive({
    v: 1,
    type: 'ready',
    browserId: saved.browserId,
    connectionId: 'connection',
  });
  await h.receive({
    v: 1,
    type: 'oauth-request',
    requestId: 'id',
    nonce: 'nonce',
    clientName: 'client',
    redirectUri: 'https://client.test',
    resource: 'https://resource.test',
    scope: 'browser:read',
    expiresAt: Date.now() + 10000,
  });
  await h.receive({ v: 1, type: 'oauth-close', requestId: 'id' });
  expect(h.connection.status()).toBe('已连接');
});

it('binds pairing and saved credentials to the immutable extension channel', async () => {
  const wrong = setup({ ...saved, channel: 'prod' }, 'dev');
  await wrong.connection.start();
  expect(wrong.sockets).toHaveLength(0);
  await expect(
    wrong.connection.pair({ endpoint: saved.endpoint, name: 'Work' }),
  ).rejects.toThrow('环境');
  expect(wrong.sockets).toHaveLength(0);
  const h = setup(undefined, 'dev');
  await h.connection.pair({ endpoint: 'http://127.0.0.1:43822', name: 'Dev' });
  h.current().onopen?.(new Event('open'));
  expect(h.current().send).toHaveBeenCalledWith(
    expect.stringContaining('"channel":"dev"'),
  );
  await h.receive({
    v: 1,
    type: 'paired',
    channel: 'prod',
    browserId: 'b',
    token: 't',
  });
  expect(h.connection.status()).toContain('协议错误');
  expect(h.ports.save).not.toHaveBeenCalled();
  await h.connection.pair({ endpoint: 'http://127.0.0.1:43822', name: 'Dev' });
  await h.receive({
    v: 1,
    type: 'paired',
    channel: 'dev',
    browserId: 'b',
    token: 't',
  });
  expect(h.ports.save).toHaveBeenCalledWith(
    expect.objectContaining({ channel: 'dev' }),
  );
  await h.receive({ v: 1, type: 'ready', browserId: 'b', connectionId: 'c' });
  expect(h.connection.status()).toContain('协议错误');
});
it('authenticates only same-channel credentials before publishing tabs', async () => {
  vi.useFakeTimers();
  const h = setup({ ...saved, channel: 'prod' }, 'prod');
  await h.connection.start();
  h.current().onopen?.(new Event('open'));
  expect(h.current().send).toHaveBeenCalledWith(
    expect.stringContaining('"channel":"prod"'),
  );
  await h.receive({
    v: 1,
    type: 'ready',
    channel: 'prod',
    browserId: saved.browserId,
    connectionId: 'c',
  });
  expect(h.connection.status()).toBe('已连接');
  await h.connection.disconnect();
});
