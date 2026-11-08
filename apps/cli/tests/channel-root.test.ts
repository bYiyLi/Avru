import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  claimRoot,
  defaultDataRoot,
  previousDataRoot,
  readRootChannel,
  rejectLegacyDefault,
} from '../src/channel-root.js';
import { install, uninstall } from '../src/install.js';
import { planAutostart } from '../src/autostart.js';
const manifestKeys = JSON.parse(
  await readFile('apps/extension/manifest-keys.json', 'utf8'),
) as Record<'dev' | 'prod', string>;
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function root() {
  const value = await mkdtemp(join(tmpdir(), 'avru-channel-'));
  roots.push(value);
  return value;
}
it('resolves platform data roots and honors absolute custom roots', () => {
  expect(
    defaultDataRoot({ platform: 'darwin', home: '/Users/a', channel: 'dev' }),
  ).toBe('/Users/a/Avru/dev');
  expect(
    defaultDataRoot({
      platform: 'win32',
      home: 'C:\\Users\\a',
      channel: 'prod',
    }),
  ).toBe('C:\\Users\\a\\Avru\\prod');
  expect(
    previousDataRoot({
      platform: 'win32',
      home: 'C:\\Users\\a',
      localAppData: 'D:\\Local',
      channel: 'dev',
    }),
  ).toBe('D:\\Local\\Avru\\dev');
  expect(
    previousDataRoot({
      platform: 'win32',
      home: 'C:\\Users\\a',
      channel: 'prod',
    }),
  ).toBe('C:\\Users\\a\\AppData\\Local\\Avru\\prod');
  expect(
    previousDataRoot({ platform: 'darwin', home: '/Users/a', channel: 'dev' }),
  ).toBe('/Users/a/Library/Application Support/Avru/dev');
  expect(
    defaultDataRoot({
      platform: 'darwin',
      home: '/Users/a',
      channel: 'dev',
      custom: '/custom',
    }),
  ).toBe('/custom');
  expect(() =>
    defaultDataRoot({
      platform: 'darwin',
      home: '/',
      channel: 'dev',
      custom: 'relative',
    }),
  ).toThrow('absolute');
});
it('claims an empty root once and rejects changing its channel', async () => {
  const directory = await root();
  await writeFile(join(directory, '.install.lock'), 'lock');
  await claimRoot(directory, 'dev');
  await claimRoot(directory, 'dev');
  expect(await readRootChannel(directory)).toBe('dev');
  await expect(claimRoot(directory, 'prod')).rejects.toThrow(
    'channel mismatch',
  );
  await writeFile(join(directory, '.avru-channel'), 'invalid');
  await expect(readRootChannel(directory)).rejects.toThrow('Invalid');
});
it('refuses legacy nonempty directories without changing contents', async () => {
  const directory = await root();
  await writeFile(join(directory, 'browsers.sqlite'), 'legacy');
  await expect(claimRoot(directory, 'dev')).rejects.toThrow('legacy');
  expect(await readFile(join(directory, 'browsers.sqlite'), 'utf8')).toBe(
    'legacy',
  );
});
it('rejects cross-channel install and uninstall before stopping anything', async () => {
  const directory = await root();
  await claimRoot(directory, 'prod');
  const stop = vi.fn<() => Promise<void>>();
  await expect(
    uninstall({
      root: directory,
      channel: 'dev',
      hooks: { stop, removeAutostart: vi.fn() },
    }),
  ).rejects.toThrow('channel mismatch');
  await expect(
    install({
      root: directory,
      channel: 'dev',
      sourceRoot: '/absent',
      version: '0.1.0-dev.1',
      execPath: process.execPath,
      hooks: { stop, start: vi.fn(), autostart: vi.fn(), open: vi.fn() },
    }),
  ).rejects.toThrow('channel mismatch');
  expect(stop).not.toHaveBeenCalled();
});
it('uses separate autostart targets on both supported platforms', () => {
  for (const platform of ['darwin', 'win32'] as const) {
    const base = platform === 'darwin' ? '/Users/a' : 'C:\\Users\\a';
    const options = {
      platform,
      home: base,
      execPath: base,
      launcherPath: base,
    };
    const dev = planAutostart({ ...options, channel: 'dev' });
    const prod = planAutostart({ ...options, channel: 'prod' });
    expect(dev.filePath).not.toBe(prod.filePath);
    expect(dev.label).not.toBe(prod.label);
  }
});

it('parallel channel installs and one uninstall preserve the other installation', async () => {
  const base = await root();
  const sourceRoot = join(base, 'payload');
  await mkdir(join(sourceRoot, 'web'), { recursive: true });
  await writeFile(join(sourceRoot, 'daemon.cjs'), '// fixture');
  await writeFile(join(sourceRoot, 'web/index.html'), '<html>fixture</html>');
  const hooks = {
    stop: vi.fn<() => Promise<void>>().mockResolvedValue(),
    start: vi.fn<() => Promise<string>>().mockResolvedValue('local'),
    autostart: vi.fn<() => Promise<void>>().mockResolvedValue(),
    open: vi.fn<() => Promise<void>>().mockResolvedValue(),
  };
  const dev = join(base, 'dev');
  const prod = join(base, 'prod');
  await Promise.all(
    (
      [
        ['dev', dev],
        ['prod', prod],
      ] as const
    ).map(async ([channel, path]) => {
      const payload = join(base, `payload-${channel}`);
      await mkdir(join(payload, 'web'), { recursive: true });
      await mkdir(join(payload, 'extension'));
      await writeFile(join(payload, 'daemon.cjs'), '// fixture');
      await writeFile(join(payload, 'web/index.html'), '<html>fixture</html>');
      await writeFile(
        join(payload, 'extension/manifest.json'),
        JSON.stringify({
          manifest_version: 3,
          version: '0.0.1',
          key: manifestKeys[channel],
        }),
      );
      return install({
        root: path,
        channel,
        sourceRoot: payload,
        version: '0.1.0',
        execPath: process.execPath,
        hooks,
      });
    }),
  );
  const saved = await readFile(join(prod, 'program/active.json'), 'utf8');
  await writeFile(join(prod, 'browsers.sqlite'), 'prod data');
  await uninstall({
    root: dev,
    channel: 'dev',
    removeData: true,
    hooks: { stop: hooks.stop, removeAutostart: vi.fn() },
  });
  expect(await readFile(join(prod, 'program/active.json'), 'utf8')).toBe(saved);
  expect(await readFile(join(prod, 'browsers.sqlite'), 'utf8')).toBe(
    'prod data',
  );
  expect(await readRootChannel(dev)).toBe('dev');
});

it('detects old default installation before migration and permits absent legacy roots', async () => {
  const home = await root();
  await rejectLegacyDefault(home);
  await mkdir(join(home, '.avru'));
  await rejectLegacyDefault(home);
  await writeFile(join(home, '.avru', 'runtime.json'), 'old runtime');
  await expect(rejectLegacyDefault(home)).rejects.toThrow(
    'stop the old daemon',
  );
  expect(await readFile(join(home, '.avru', 'runtime.json'), 'utf8')).toBe(
    'old runtime',
  );
});
it('refuses the previous platform directory without adopting or deleting it', async () => {
  const home = await root();
  const previous = join(home, 'previous');
  await rejectLegacyDefault(home, previous);
  await mkdir(previous);
  await writeFile(join(previous, 'browsers.sqlite'), 'preserved');
  await expect(rejectLegacyDefault(home, previous)).rejects.toThrow(
    'stop the old daemon',
  );
  expect(await readFile(join(previous, 'browsers.sqlite'), 'utf8')).toBe(
    'preserved',
  );
});
