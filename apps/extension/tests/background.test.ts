import { afterEach, expect, it, vi } from 'vitest';
import type { Ports } from '../utils/connection';
const mock = vi.hoisted(() => ({
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
  create: vi.fn().mockResolvedValue(undefined),
}));
let ports: Ports;
vi.mock('../utils/connection', () => ({
  Connection: class {
    constructor(value: Ports) {
      ports = value;
    }
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
    storage: { local: { get: mock.get, set: mock.set, remove: mock.remove } },
    tabs: {
      query: mock.query,
      onCreated: { addListener: mock.created },
      onUpdated: { addListener: mock.updated },
      onRemoved: { addListener: mock.removed },
    },
    alarms: { create: mock.create, onAlarm: { addListener: mock.alarm } },
    runtime: {
      id: 'extension',
      getURL: (path: string) => `chrome-extension://extension${path}`,
      onMessage: { addListener: mock.message },
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
  const message = mock.message.mock.calls[0]?.[0] as (
    value: unknown,
    sender: { id: string; url: string },
    respond: (value: unknown) => void,
  ) => boolean;
  const respond = vi.fn();
  const sender = {
    id: 'extension',
    url: 'chrome-extension://extension/popup.html',
  };
  expect(message({}, { ...sender, id: 'evil' }, respond)).toBe(false);
  expect(message({}, { ...sender, url: 'https://evil.test' }, respond)).toBe(
    false,
  );
  for (const value of [
    null,
    { type: 'pair' },
    { type: 'pair', endpoint: 'http://127.0.0.1' },
    { type: 'pair', endpoint: 'http://127.0.0.1', name: 'Work' },
    { type: 'disconnect' },
    { type: 'status' },
  ]) {
    expect(message(value, sender, respond)).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
  }
  expect(mock.pair).toHaveBeenCalledWith({
    endpoint: 'http://127.0.0.1',
    name: 'Work',
  });
  expect(mock.disconnect).toHaveBeenCalled();
  mock.pair.mockRejectedValueOnce(new Error('invalid'));
  message({ type: 'pair', endpoint: 'bad', name: 'n' }, sender, respond);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(respond).toHaveBeenCalledWith({ status: '请求失败，请检查连接信息' });
});
