import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ConnectionManager } from '../src/transports/connection-manager.js';
import { ConnectionEvents } from '../src/transports/connection-events.js';
import { connectionBundle } from './connection-fixture.js';
const roots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture(external = false) {
  const root = await mkdtemp(join(tmpdir(), 'avru-manager-'));
  roots.push(root);
  const remote = {
    configure: vi.fn<() => Promise<void>>().mockResolvedValue(),
    close: vi.fn<() => Promise<void>>().mockResolvedValue(),
  };
  const driver = {
    start: vi.fn<() => Promise<void>>().mockResolvedValue(),
    stop: vi.fn<() => Promise<void>>().mockResolvedValue(),
    registered: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
  };
  const options = {
    dataRoot: root,
    payloadRoot: resolve('artifacts'),
    channel: 'dev' as const,
    localPort: 43822,
    databasePath: join(root, 'data.sqlite'),
    remote,
    driver,
    external,
  };
  const manager = new ConnectionManager(options);
  await manager.initialize();
  return { root, remote, driver, manager, options };
}
it('imports, auto-starts, restores and clears only private configuration and sanitized events', async () => {
  const f = await fixture();
  const bundle = connectionBundle();
  try {
    expect(f.manager.snapshot().state).toBe('unconfigured');
    await f.manager.import(bundle);
    expect(f.driver.start).toHaveBeenCalledWith(bundle);
    expect(f.manager.snapshot()).toMatchObject({
      configured: true,
      state: 'connecting',
      issuer: bundle.oauth.issuer,
    });
    expect(JSON.stringify(f.manager.snapshot())).not.toContain(
      bundle.frp.token,
    );
    expect(JSON.stringify(f.manager.snapshot())).not.toContain(
      bundle.frp.privateKeyPem,
    );
    expect(
      JSON.parse(
        await readFile(join(f.root, 'connection/configuration.json'), 'utf8'),
      ),
    ).toEqual(bundle);
    await f.manager.close();
    const restored = new ConnectionManager(f.options);
    await restored.initialize();
    expect(restored.snapshot().configured).toBe(true);
    expect(f.driver.start).toHaveBeenCalledTimes(2);
    await restored.clear();
    expect(restored.snapshot().state).toBe('unconfigured');
    expect(
      restored
        .snapshot()
        .events.slice(0, 2)
        .map((event) => event.code),
    ).toEqual(['configuration_removed', 'process_stopped']);
    await expect(
      readFile(join(f.root, 'connection/configuration.json')),
    ).rejects.toThrow();
    await restored.close();
  } catch (error) {
    await f.manager.close().catch(() => {});
    throw error;
  }
});
it('rejects invalid bundles and conflicting external configuration without starting', async () => {
  const f = await fixture(true);
  await expect(f.manager.import(connectionBundle())).rejects.toThrow(
    'conflict',
  );
  expect(f.driver.start).not.toHaveBeenCalled();
  await f.manager.close();
  await writeFile(
    join(f.root, 'connection/configuration.json'),
    JSON.stringify(connectionBundle()),
    { mode: 0o600 },
  );
  const restored = new ConnectionManager(f.options);
  await restored.initialize();
  expect(restored.snapshot().state).toBe('unavailable');
  expect(restored.snapshot().events[0]?.code).toBe('configuration_conflict');
  await restored.close();
  const normal = new ConnectionManager({ ...f.options, external: false });
  await normal.initialize();
  await expect(normal.import({})).rejects.toThrow('configuration_invalid');
  expect(normal.snapshot().events[0]?.code).toBe('configuration_invalid');
  await normal.close();
});
it('polls proxy registration, recovers confirmed exits with backoff and stops on unknown ownership', async () => {
  const f = await fixture();
  vi.useFakeTimers();
  try {
    await f.manager.import(connectionBundle());
    f.driver.registered.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.manager.snapshot().state).toBe('registered');
    const events = f.manager.snapshot().events.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.manager.snapshot().events.length).toBe(events);
    f.driver.registered.mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.manager.snapshot().state).toBe('connecting');
    f.driver.registered.mockRejectedValueOnce(new Error('process_exited'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.manager.snapshot().state).toBe('unavailable');
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.driver.start).toHaveBeenCalledTimes(2);
    f.driver.stop.mockRejectedValueOnce(new Error('ownership_unknown'));
    await expect(f.manager.clear()).rejects.toThrow();
    expect(f.manager.snapshot().state).toBe('unknown');
    await expect(
      readFile(join(f.root, 'connection/configuration.json')),
    ).resolves.toBeTruthy();
  } finally {
    await f.manager.close();
  }
});
it('reports startup errors, serializes mutations and cancels recovery during close', async () => {
  const f = await fixture();
  vi.useFakeTimers();
  try {
    f.driver.start.mockRejectedValue(new Error('cannot spawn secret details'));
    await f.manager.import(connectionBundle());
    expect(f.manager.snapshot().state).toBe('unavailable');
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.driver.start).toHaveBeenCalledTimes(2);
    let release: () => void = () => {};
    f.driver.stop.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          release = done;
        }),
    );
    const removing = f.manager.clear();
    await Promise.resolve();
    await expect(f.manager.clear()).rejects.toThrow('busy');
    const closing = f.manager.close();
    release();
    await removing;
    await vi.advanceTimersByTimeAsync(20);
    await closing;
    const count = f.driver.start.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.driver.start).toHaveBeenCalledTimes(count);
    await expect(f.manager.import(connectionBundle())).rejects.toThrow();
  } finally {
    vi.useRealTimers();
  }
});
it('preserves the previous in-memory configuration if an atomic replacement is refused', async () => {
  const f = await fixture();
  await f.manager.import(connectionBundle());
  const path = join(f.root, 'connection/configuration.json');
  await rm(path);
  await mkdir(path);
  await expect(f.manager.import(connectionBundle())).rejects.toThrow();
  expect(f.driver.start).toHaveBeenCalledTimes(2);
  expect(f.manager.snapshot().configured).toBe(true);
  await f.manager.close();
  const restored = new ConnectionManager(f.options);
  await restored.initialize();
  expect(restored.snapshot().state).toBe('unavailable');
  await restored.close();
  await rm(path, { recursive: true });
  const empty = new ConnectionManager({
    ...f.options,
    databasePath: undefined,
  } as unknown as ConstructorParameters<typeof ConnectionManager>[0]);
  await expect(empty.import(connectionBundle())).rejects.toThrow('busy');
  await empty.close();
  await mkdir(path);
  const initial = new ConnectionManager(f.options);
  await initial.initialize();
  await expect(initial.import(connectionBundle())).rejects.toThrow();
  expect(initial.snapshot().configured).toBe(false);
  await initial.close();
});
it('persists unknown ownership during shutdown and shares the same failed close result without retrying', async () => {
  const f = await fixture();
  await f.manager.import(connectionBundle());
  f.driver.stop.mockRejectedValueOnce(new Error('ownership_unknown'));
  const closing = f.manager.close();
  await expect(closing).rejects.toThrow('ownership_unknown');
  expect(f.manager.close()).toBe(closing);
  const events = new ConnectionEvents(f.options.databasePath);
  expect(events.snapshot().events[0]?.code).toBe('ownership_unknown');
  events.close();
});
