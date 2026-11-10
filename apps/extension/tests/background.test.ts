import { afterEach, expect, it, vi } from 'vitest';
import type { Ports } from '../utils/connection';
const mock = vi.hoisted(() => ({
  clicked: vi.fn(),
  tabCreate: vi.fn().mockResolvedValue({}),
  tabGet: vi.fn().mockResolvedValue({
    title: 'Page title',
    url: 'https://example.test/page',
    windowId: 11,
  }),
  tabUpdate: vi.fn().mockResolvedValue({ id: 44, active: true }),
  tabRemove: vi.fn().mockResolvedValue(undefined),
  tabMove: vi.fn().mockResolvedValue({ id: 44, index: 0, windowId: 11 }),
  scriptExecute: vi.fn().mockResolvedValue([
    {
      result: {
        title: 'Page title',
        url: 'https://example.test/page',
        text: 'Content',
      },
    },
  ]),
  decideOAuth: vi.fn(),
  windowCreate: vi.fn().mockResolvedValue({ id: 7 }),
  windowRemove: vi.fn().mockResolvedValue(undefined),
  windowGetAll: vi
    .fn()
    .mockResolvedValue([{ id: 11, focused: true, incognito: false }]),
  windowRemoved: vi.fn(),
  start: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(undefined),
  pair: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  reconnect: vi.fn(),
  status: vi.fn().mockReturnValue('ready'),
  interrupt: vi.fn(),
  get: vi.fn().mockResolvedValue({ connection: 'stored' }),
  set: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  query: vi.fn().mockResolvedValue([]),
  created: vi.fn(),
  updated: vi.fn(),
  removed: vi.fn(),
  activated: vi.fn(),
  tabSendMessage: vi.fn().mockResolvedValue(undefined),
  alarm: vi.fn(),
  message: vi.fn(),
  external: vi.fn(),
  create: vi.fn().mockResolvedValue(undefined),
  debuggerAttach: vi.fn().mockResolvedValue(undefined),
  debuggerDetach: vi.fn().mockResolvedValue(undefined),
  debuggerSend: vi.fn().mockResolvedValue({}),
  debuggerEvent: vi.fn(),
  debuggerDetachEvent: vi.fn(),
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
    interrupt = mock.interrupt;
  },
}));
vi.mock('wxt/utils/define-background', () => ({
  defineBackground: (callback: () => void) => callback,
}));
vi.mock('wxt/browser', () => ({
  browser: {
    action: { onClicked: { addListener: mock.clicked } },
    debugger: {
      attach: mock.debuggerAttach,
      detach: mock.debuggerDetach,
      sendCommand: mock.debuggerSend,
      onEvent: {
        addListener: mock.debuggerEvent,
        removeListener: vi.fn(),
      },
      onDetach: {
        addListener: mock.debuggerDetachEvent,
        removeListener: vi.fn(),
      },
    },
    windows: {
      create: mock.windowCreate,
      remove: mock.windowRemove,
      getAll: mock.windowGetAll,
      onRemoved: { addListener: mock.windowRemoved },
    },
    storage: { local: { get: mock.get, set: mock.set, remove: mock.remove } },
    tabs: {
      create: mock.tabCreate,
      get: mock.tabGet,
      remove: mock.tabRemove,
      move: mock.tabMove,
      update: mock.tabUpdate,
      query: mock.query,
      sendMessage: mock.tabSendMessage,
      onCreated: { addListener: mock.created },
      onUpdated: { addListener: mock.updated },
      onRemoved: { addListener: mock.removed },
      onActivated: { addListener: mock.activated },
    },
    scripting: { executeScript: mock.scriptExecute },
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
it('forwards the Chrome debugger Cancel event to the local execution controller', async () => {
  const background = await import('../entrypoints/background');
  (background.default as unknown as () => void)();
  const action = ports.action;
  if (!action) throw new Error('Missing browser action port');
  await action(7, 'cdp.send', ['Page.enable']);
  const detached = mock.debuggerDetachEvent.mock.calls.at(-1)?.[0] as (
    target: { tabId: number },
    reason: string,
  ) => void;
  detached({ tabId: 7 }, 'canceled_by_user');
  expect(mock.interrupt).toHaveBeenCalledWith(7);
  await expect(action(7, 'cdp.send', ['Page.enable'])).rejects.toThrow(
    'CDP_DISCONNECTED',
  );
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

it('exposes the real browser action adapter through the background connection', async () => {
  const background = await import('../entrypoints/background');
  (background.default as unknown as () => void)();
  const action = ports.action;
  if (!action) throw new Error('Missing browser action port');
  mock.tabCreate.mockResolvedValueOnce({
    id: 44,
    title: 'Created',
    url: 'https://example.test/new',
  });
  expect(
    await action(7, 'tabs.new', [
      'https://example.test/new',
      { active: false },
    ]),
  ).toMatchObject({ tabId: '44', title: 'Created' });
  expect(mock.tabCreate).toHaveBeenCalledWith({
    url: 'https://example.test/new',
    active: false,
  });
  await action(7, 'tabs.select', ['44']);
  expect(mock.tabUpdate).toHaveBeenCalledWith(44, { active: true });
  mock.tabUpdate.mockResolvedValueOnce(undefined);
  await expect(action(7, 'tabs.select', ['44'])).resolves.toMatchObject({
    tabId: '44',
    ok: true,
  });
  mock.query.mockResolvedValueOnce([
    {
      id: 44,
      title: 'Created',
      url: 'https://example.test/new',
    },
  ]);
  expect(await action(7, 'tabs.selected', [])).toMatchObject({
    tabId: '44',
    title: 'Created',
  });
  expect(mock.query).toHaveBeenCalledWith({ active: true, windowId: 11 });
  expect(await action(7, 'tab.url', [])).toBe('https://example.test/page');
  expect(await action(7, 'tab.snapshot', [])).toMatchObject({
    title: 'Page title',
    text: 'Content',
    truncated: false,
  });
  expect(mock.scriptExecute).toHaveBeenCalledOnce();
  await action(7, 'cdp.send', ['Runtime.evaluate', { expression: '1 + 1' }]);
  expect(mock.debuggerAttach).toHaveBeenCalledWith({ tabId: 7 }, '1.3');
  expect(mock.debuggerSend).toHaveBeenCalledWith(
    { tabId: 7 },
    'Runtime.evaluate',
    { expression: '1 + 1' },
  );
  await action(7, 'tabs.close', ['44']);
  expect(mock.tabRemove).toHaveBeenCalledWith(44);
  expect(await action(7, 'windows.list', [])).toEqual([
    { id: '11', focused: true },
  ]);
  expect(mock.windowGetAll).toHaveBeenCalledWith({ populate: false });
  expect(await action(7, 'tabs.move', ['44', { index: 0 }])).toMatchObject({
    tabId: '44',
    windowId: '11',
    index: 0,
  });
  expect(mock.tabMove).toHaveBeenCalledWith(44, { index: 0 });
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

it('restores trusted tab badges and clears finished badges on activation', async () => {
  const background = await import('../entrypoints/background');
  (background.default as unknown as () => void)();
  const listener = mock.message.mock.calls.at(-1)?.[0] as (
    value: unknown,
    sender: { id: string; url: string; tab?: { id: number } },
    respond: (value: unknown) => void,
  ) => boolean;
  const savedState = {
    'avru.favicon.states': { '7': { status: 'done', taskId: 'task-1' } },
  };
  mock.get.mockResolvedValueOnce(savedState);
  const respond = vi.fn();
  expect(
    listener(
      { type: 'avru.overlay.ready' },
      { id: 'extension', url: 'https://example.test/', tab: { id: 7 } },
      respond,
    ),
  ).toBe(true);
  await Promise.resolve();
  await Promise.resolve();
  expect(respond).toHaveBeenCalledWith({
    type: 'avru.favicon.status',
    status: 'done',
    taskId: 'task-1',
  });
  expect(
    listener(
      { type: 'avru.overlay.ready' },
      { id: 'other', url: 'https://example.test/', tab: { id: 7 } },
      respond,
    ),
  ).toBe(false);
  expect(
    listener(
      { type: 'avru.overlay.ready' },
      { id: 'extension', url: 'https://example.test/' },
      respond,
    ),
  ).toBe(false);
  const activated = mock.activated.mock.calls.at(-1)?.[0] as (value: {
    tabId: number;
  }) => void;
  mock.get.mockResolvedValueOnce(savedState);
  activated({ tabId: 7 });
  for (let index = 0; index < 6; index++) await Promise.resolve();
  expect(mock.set).toHaveBeenCalledWith({ 'avru.favicon.states': {} });
  expect(mock.tabSendMessage).toHaveBeenCalledWith(7, {
    type: 'avru.favicon.status',
    status: 'clear',
    taskId: 'task-1',
  });
  mock.get.mockResolvedValueOnce({
    'avru.favicon.states': { '7': { status: 'active', taskId: 'task-2' } },
  });
  activated({ tabId: 7 });
  await Promise.resolve();
  expect(mock.tabSendMessage).toHaveBeenCalledTimes(1);
});
