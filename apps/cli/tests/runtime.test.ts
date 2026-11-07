import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  lstat: vi.fn(),
  readlink: vi.fn(),
  mkdir: vi.fn(),
  open: vi.fn(),
  spawn: vi.fn(),
  delay: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('node:fs/promises', () => ({
  readFile: mocks.read,
  lstat: mocks.lstat,
  readlink: mocks.readlink,
  mkdir: mocks.mkdir,
  open: mocks.open,
}));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:timers/promises', () => ({ setTimeout: mocks.delay }));
import {
  inspectRuntime,
  openManagement,
  parseRuntime,
  startRuntime,
  stopRuntime,
} from '../src/runtime.js';
const descriptor = {
  channel: 'dev',
  pid: 1,
  port: 43821,
  url: `http://127.0.0.1:43821/#key=${'a'.repeat(64)}`,
  instance: 'b'.repeat(32),
};
function child() {
  const process = Object.assign(new EventEmitter(), {
    pid: undefined as number | undefined,
    unref: vi.fn(),
    kill: vi.fn(),
  });
  process.pid = 1;
  process.kill.mockImplementation(() => {
    queueMicrotask(() => process.emit('close', null));
    return true;
  });
  return process;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.read.mockResolvedValue(JSON.stringify(descriptor));
  mocks.fetch.mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        instance: descriptor.instance,
        channel: descriptor.channel,
      }),
  });
  mocks.lstat.mockResolvedValue({
    isSymbolicLink: () => false,
    isDirectory: () => true,
  });
  mocks.readlink.mockResolvedValue('/other-environment/daemon.log');
  mocks.open.mockResolvedValue({ fd: 1, close: vi.fn() });
  mocks.spawn.mockImplementation(() => child());
});
afterEach(() => {
  vi.unstubAllGlobals();
});
test('descriptor refuses unsafe destinations and malformed fields', () => {
  expect(parseRuntime(JSON.stringify(descriptor))).toEqual(descriptor);
  for (const item of [
    null,
    {},
    { ...descriptor, pid: 0 },
    { ...descriptor, port: 80 },
    { ...descriptor, instance: 'bad' },
    { ...descriptor, url: 'https://evil.test' },
  ])
    expect(() => parseRuntime(JSON.stringify(item))).toThrow();
});
test('inspection authenticates instance and handles missing/stale state', async () => {
  expect(await inspectRuntime('/tmp/root')).toEqual(descriptor);
  expect(mocks.fetch.mock.calls[0]?.[0]).toContain('/api/runtime');
  mocks.fetch.mockResolvedValue({ ok: false, json: () => Promise.resolve({}) });
  expect(await inspectRuntime('/tmp/root')).toBeUndefined();
  mocks.read.mockRejectedValue(
    Object.assign(new Error('missing'), { code: 'ENOENT' }),
  );
  expect(await inspectRuntime('/tmp/root')).toBeUndefined();
});
test('stop absent, refused, successful and timed out daemons without PID signals', async () => {
  mocks.read.mockRejectedValueOnce(
    Object.assign(new Error('missing'), { code: 'ENOENT' }),
  );
  await stopRuntime('root');
  mocks.fetch
    .mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          instance: descriptor.instance,
          channel: descriptor.channel,
        }),
    })
    .mockResolvedValueOnce({ ok: false });
  await expect(stopRuntime('root')).rejects.toThrow('refused');
  mocks.fetch
    .mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          instance: descriptor.instance,
          channel: descriptor.channel,
        }),
    })
    .mockResolvedValueOnce({ ok: true });
  mocks.read
    .mockResolvedValueOnce(JSON.stringify(descriptor))
    .mockResolvedValueOnce(JSON.stringify(descriptor))
    .mockRejectedValueOnce(
      Object.assign(new Error('missing'), { code: 'ENOENT' }),
    );
  await stopRuntime('root');
  await expect(stopRuntime('root')).rejects.toThrow('timed out');
});
test('start reuses healthy daemon and starts detached payload with private log', async () => {
  expect(
    await startRuntime({
      dataRoot: 'root',
      payloadRoot: 'payload',
      execPath: 'node',
    }),
  ).toEqual(descriptor);
  expect(mocks.spawn).not.toHaveBeenCalled();
  mocks.read.mockRejectedValueOnce(
    Object.assign(new Error('absent'), { code: 'ENOENT' }),
  );
  expect(
    await startRuntime({
      dataRoot: 'root',
      payloadRoot: 'payload',
      execPath: 'node',
      port: 44000,
    }),
  ).toEqual(descriptor);
  expect(mocks.spawn).toHaveBeenCalledWith(
    'node',
    [expect.stringContaining('daemon.cjs')],
    expect.objectContaining({ detached: true }),
  );
});
test('start timeout and spawn failure never claim readiness', async () => {
  mocks.read.mockRejectedValue(
    Object.assign(new Error('absent'), { code: 'ENOENT' }),
  );
  await expect(
    startRuntime({
      dataRoot: 'root',
      payloadRoot: 'payload',
      execPath: 'node',
    }),
  ).rejects.toThrow('did not become ready');
  mocks.spawn.mockImplementation(() => {
    const process = child();
    process.pid = undefined;
    queueMicrotask(() => process.emit('error', new Error('spawn')));
    return process;
  });
  await expect(
    startRuntime({
      dataRoot: 'root',
      payloadRoot: 'payload',
      execPath: 'node',
    }),
  ).rejects.toThrow('did not become ready');
});
test('open uses argument arrays and propagates unsupported/browser failure', async () => {
  mocks.spawn.mockImplementation(() => {
    const process = child();
    queueMicrotask(() => process.emit('exit', 0));
    return process;
  });
  await openManagement(descriptor.url, 'darwin');
  await openManagement(descriptor.url, 'win32');
  await expect(openManagement('https://evil.test', 'darwin')).rejects.toThrow(
    'loopback',
  );
  await expect(openManagement(descriptor.url, 'linux')).rejects.toThrow(
    'Unsupported',
  );
  mocks.spawn.mockImplementation(() => {
    const process = child();
    queueMicrotask(() => process.emit('exit', 1));
    return process;
  });
  await expect(openManagement(descriptor.url, 'darwin')).rejects.toThrow(
    'Could not',
  );
});

test('unreachable stale descriptor blocks startup without cancelling unrelated process', async () => {
  mocks.fetch.mockRejectedValue(new Error('unreachable'));
  const process = child();
  mocks.spawn.mockReturnValue(process);
  await expect(
    startRuntime({
      dataRoot: 'root',
      payloadRoot: 'payload',
      execPath: 'node',
    }),
  ).rejects.toThrow('cannot be authenticated');
  expect(process.kill).not.toHaveBeenCalled();
});
test('early exit needs no signal and failed exit confirmation is explicit', async () => {
  mocks.read.mockRejectedValue(
    Object.assign(new Error('missing'), { code: 'ENOENT' }),
  );
  const exited = child();
  mocks.spawn.mockImplementation(() => {
    queueMicrotask(() => exited.emit('close', 1));
    return exited;
  });
  await expect(
    startRuntime({
      dataRoot: 'root',
      payloadRoot: 'payload',
      execPath: 'node',
    }),
  ).rejects.toThrow('did not become ready');
  expect(exited.kill).not.toHaveBeenCalled();
  const stuck = child();
  stuck.kill.mockImplementation(() => false);
  mocks.spawn.mockReturnValue(stuck);
  await expect(
    startRuntime({
      dataRoot: 'root',
      payloadRoot: 'payload',
      execPath: 'node',
    }),
  ).rejects.toMatchObject({ code: 'AVRU_PROCESS_EXIT_UNCONFIRMED' });
});

test('unverified existing daemon prevents uninstall and unexpected read errors surface', async () => {
  mocks.fetch.mockRejectedValue(new Error('timeout'));
  await expect(stopRuntime('root')).rejects.toMatchObject({
    code: 'AVRU_RUNTIME_UNVERIFIED',
  });
  mocks.read.mockRejectedValue(new Error('permission denied'));
  await expect(stopRuntime('root')).rejects.toThrow('permission denied');
});

test('cross-channel descriptors cannot be reused or stopped', async () => {
  expect(await inspectRuntime('root', 'prod')).toBeUndefined();
  expect(mocks.fetch).not.toHaveBeenCalled();
  await expect(stopRuntime('root', 'prod')).rejects.toThrow(
    'cannot be authenticated',
  );
  expect(mocks.fetch).not.toHaveBeenCalled();
  mocks.fetch.mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({ instance: descriptor.instance, channel: 'prod' }),
  });
  expect(await inspectRuntime('root', 'dev')).toBeUndefined();
});

test('start rejects a linked log before opening or spawning', async () => {
  mocks.read.mockRejectedValueOnce(
    Object.assign(new Error('absent'), { code: 'ENOENT' }),
  );
  mocks.lstat.mockImplementation((path: string) =>
    Promise.resolve({
      isSymbolicLink: () => path.endsWith('daemon.log'),
      isDirectory: () => !path.endsWith('daemon.log'),
    }),
  );
  await expect(
    startRuntime({
      dataRoot: '/isolated/dev',
      payloadRoot: '/payload',
      execPath: '/node',
      channel: 'dev',
    }),
  ).rejects.toThrow('Symbolic link');
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.spawn).not.toHaveBeenCalled();
});
