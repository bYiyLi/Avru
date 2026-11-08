import { afterEach, expect, it, vi } from 'vitest';
import type { Ports } from '../utils/connection';
const mock = vi.hoisted(() => ({
  clicked: vi.fn(),
  tabCreate: vi.fn().mockResolvedValue({}),
  decideOAuth: vi.fn(),
  windowCreate: vi.fn().mockResolvedValue({ id: 7 }),
  windowRemove: vi.fn().mockResolvedValue(undefined),
  windowRemoved: vi.fn(),
  start: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(undefined),
  pair: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  reconnect: vi.fn(),
  status: vi.fn().mockReturnValue('ready'),
  get: vi.fn().mockResolvedValue({ connection: 'stored' }),
  set: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  query: vi.fn().mockResolvedValue([]),
  created: vi.fn(),
  updated: vi.fn(),
  removed: vi.fn(),
  alarm: vi.fn(),
  message: vi.fn(),
  external: vi.fn(),
  create: vi.fn().mockResolvedValue(undefined),
}));
let ports: Ports;
vi.mock('../utils/connection', () => ({
  Connection: class {
    constructor(value: Ports) {
      ports = value;
    }
    decideOAuth = mock.decideOAuth;
    start = mock.start;
    publish = mock.publish;
    pair = mock.pair;
    disconnect = mock.disconnect;
    reconnect = mock.reconnect;
    status = mock.status;
  },
}));
vi.mock('wxt/utils/define-background', () => ({
  defineBackground: (callback: () => void) => callback,
}));
vi.mock('wxt/browser', () => ({
  browser: {
    action: { onClicked: { addListener: mock.clicked } },
    windows: {
      create: mock.windowCreate,
      remove: mock.windowRemove,
      onRemoved: { addListener: mock.windowRemoved },
    },
    storage: { local: { get: mock.get, set: mock.set, remove: mock.remove } },
    tabs: {
      create: mock.tabCreate,
      query: mock.query,
      onCreated: { addListener: mock.created },
      onUpdated: { addListener: mock.updated },
      onRemoved: { addListener: mock.removed },
    },
    alarms: { create: mock.create, onAlarm: { addListener: mock.alarm } },
    runtime: {
      id: 'extension',
      getManifest: () => ({ version: '0.0.1' }),
      getURL: (path: string) => `chrome-extension://extension${path}`,
      onMessage: { addListener: mock.message },
      onMessageExternal: { addListener: mock.external },
    },
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it('wires the browser adapter, popup-only requests, events and retry alarm', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'WebSocket',
    class {
      constructor(public url: string) {}
    },
  );
  const background = await import('../entrypoints/background');
  (background.default as unknown as () => void)();
  await Promise.resolve();
  expect(await ports.read()).toBe('stored');
  await ports.save({
    endpoint: 'http://127.0.0.1',
    profileId: 'p',
    name: 'n',
    browserId: 'b',
    token: 't',
  });
  await ports.clear();
  await ports.tabs();
  expect((await ports.metadata?.())?.extensionVersion).toBe('0.0.1');
  expect(ports.uuid()).toMatch(/-/);
  expect(ports.socket('ws://127.0.0.1')).toBeDefined();
  const timer = ports.later(vi.fn(), 100);
  ports.cancel(timer);
  const publish = mock.created.mock.calls[0]?.[0] as () => void;
  publish();
  mock.publish.mockRejectedValueOnce(new Error('closed'));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  publish();
  await Promise.resolve();
  const alarm = mock.alarm.mock.calls[0]?.[0] as (value: {
    name: string;
  }) => void;
  alarm({ name: 'other' });
  alarm({ name: 'avru-reconnect' });
  expect(mock.reconnect).toHaveBeenCalledOnce();
  const click = mock.clicked.mock.calls[0]?.[0] as () => void;
  click();
  await Promise.resolve();
  expect(mock.tabCreate).toHaveBeenCalledWith({
    url: 'http://127.0.0.1:43822/#overview',
  });
  mock.tabCreate.mockRejectedValueOnce(new Error('closed'));
  click();
  await Promise.resolve();
  const message = mock.message.mock.calls[0]?.[0] as (
    value: unknown,
    sender: { id: string; url: string },
    respond: (value: unknown) => void,
  ) => boolean;
  expect(message({}, { id: 'evil', url: 'https://evil.test' }, vi.fn())).toBe(
    false,
  );
  expect(ports.local).toBe(true);
});

it('routes OAuth only through extension-owned consent window', async () => {
  vi.useFakeTimers();
  const background = await import('../entrypoints/background');
  (background.default as unknown as () => void)();
  const listener = mock.message.mock.calls.at(-1)?.[0] as (
    value: unknown,
    sender: { id: string; url: string },
    respond: (value: unknown) => void,
  ) => boolean;
  const request = {
    requestId: 'request',
    nonce: 'nonce',
    clientName: 'client',
    redirectUri: 'https://example.com/callback',
    resource: 'https://example.com/mcp',
    scope: 'browser:read' as const,
    expiresAt: Date.now() + 10000,
  };
  await ports.onOAuthRequest?.(request);
  const sender = {
    id: 'extension',
    url: 'chrome-extension://extension/consent.html',
  };
  const respond = vi.fn();
  listener({ type: 'oauth-consent-read', windowId: 7 }, sender, respond);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(respond).toHaveBeenLastCalledWith(
    expect.objectContaining({ requestId: 'request' }),
  );
  listener({ type: 'oauth-consent-read' }, sender, respond);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(respond).toHaveBeenLastCalledWith(null);
  listener(
    {
      type: 'oauth-consent-decide',
      windowId: 7,
      requestId: 'request',
      approved: true,
    },
    sender,
    respond,
  );
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(mock.decideOAuth).toHaveBeenCalledWith(request, true);
  await ports.onOAuthRequest?.(request);
  (mock.windowRemoved.mock.calls.at(-1)?.[0] as (id: number) => void)(7);
  await ports.onOAuthRequest?.(request);
  ports.onOAuthClose?.('request');
  ports.resetOAuth?.();
  mock.windowCreate.mockResolvedValueOnce({});
  await ports.onOAuthRequest?.(request);
});
