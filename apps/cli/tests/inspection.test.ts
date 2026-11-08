import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { inspectInstallation } from '../src/inspection.js';
import { enableAutostart } from '../src/autostart-io.js';
import type { RuntimeDescriptor } from '../src/runtime.js';

const mocks = vi.hoisted(() => ({
  runtime: vi.fn<() => Promise<RuntimeDescriptor | undefined>>(),
}));
vi.mock('../src/runtime.js', () => ({ inspectRuntime: mocks.runtime }));
const roots: string[] = [];
const active = {
  release: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  version: '0.1.0-dev.1',
  execPath: process.execPath,
};
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'avru-inspect-'));
  roots.push(home);
  const root = join(home, 'Avru', 'dev');
  const autostart = {
    platform:
      process.platform === 'win32' ? ('win32' as const) : ('darwin' as const),
    home,
    channel: 'dev' as const,
    execPath: process.execPath,
    launcherPath: join(root, 'program', 'launcher.mjs'),
  };
  return {
    root,
    channel: 'dev' as const,
    packageVersion: '0.1.0-dev.1',
    autostart,
  };
}
async function markInstalled(options: Awaited<ReturnType<typeof fixture>>) {
  await mkdir(join(options.root, 'program'), { recursive: true });
  await writeFile(join(options.root, '.avru-channel'), 'dev');
  await writeFile(join(options.root, 'program/.avru-owned'), 'avru-program-v1');
  await writeFile(
    join(options.root, 'program/active.json'),
    JSON.stringify(active),
  );
}
afterEach(async () => {
  mocks.runtime.mockReset();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
it('checks an empty machine without creating directories or login items', async () => {
  const options = await fixture();
  const before = await readdir(options.autostart.home);
  expect(await inspectInstallation(options)).toMatchObject({
    active: undefined,
    service: 'not_detected',
    autostart: 'missing',
    retainedData: false,
  });
  expect(await readdir(options.autostart.home)).toEqual(before);
  await mkdir(options.root, { recursive: true });
  expect((await inspectInstallation(options)).active).toBeUndefined();
  expect(await readdir(options.root)).toEqual([]);
});
it('detects owned state, preserved data, configured startup and only authenticated runtime', async () => {
  const options = await fixture();
  await markInstalled(options);
  await writeFile(join(options.root, 'browsers.sqlite'), 'retained');
  const startup = await enableAutostart(options.autostart);
  let state = await inspectInstallation(options);
  expect(state).toMatchObject({
    active,
    service: 'not_detected',
    autostart: 'configured',
    retainedData: true,
  });
  await writeFile(join(options.root, 'runtime.json'), '{}');
  state = await inspectInstallation(options);
  expect(state.service).toBe('unknown');
  mocks.runtime.mockResolvedValue({
    channel: 'dev',
    pid: 1,
    port: 43822,
    instance: 'instance',
    url: 'private',
  });
  expect((await inspectInstallation(options)).service).toBe('running');
  await writeFile(startup.filePath, 'foreign');
  expect((await inspectInstallation(options)).autostart).toBe('unknown');
  expect(await readFile(join(options.root, 'browsers.sqlite'), 'utf8')).toBe(
    'retained',
  );
});
it('recognizes a retained connection file without reading its contents', async () => {
  const options = await fixture();
  await mkdir(join(options.root, 'connection'), { recursive: true });
  await writeFile(join(options.root, '.avru-channel'), 'dev');
  await writeFile(
    join(options.root, 'connection/configuration.json'),
    'private',
  );
  expect((await inspectInstallation(options)).retainedData).toBe(true);
});
it('rejects busy, foreign and different-channel roots without modification', async () => {
  const options = await fixture();
  await mkdir(options.root, { recursive: true });
  await writeFile(join(options.root, 'unknown.txt'), 'keep');
  await expect(inspectInstallation(options)).rejects.toMatchObject({
    code: 'AVRU_ROOT_UNOWNED',
  });
  expect(await readFile(join(options.root, 'unknown.txt'), 'utf8')).toBe(
    'keep',
  );
  await writeFile(join(options.root, '.avru-channel'), 'prod');
  await expect(inspectInstallation(options)).rejects.toMatchObject({
    code: 'AVRU_CHANNEL_MISMATCH',
  });
  await writeFile(join(options.root, '.install.lock'), 'busy');
  await expect(inspectInstallation(options)).rejects.toMatchObject({
    code: 'AVRU_INSTALL_BUSY',
  });
});
it('refuses unowned programs and classifies a service without an active program as unknown', async () => {
  const options = await fixture();
  await markInstalled(options);
  await rm(join(options.root, 'program/.avru-owned'));
  await expect(inspectInstallation(options)).rejects.toThrow('unowned');
  await writeFile(join(options.root, 'program/.avru-owned'), 'avru-program-v1');
  await rm(join(options.root, 'program/active.json'));
  expect((await inspectInstallation(options)).programPresent).toBe(true);
  await writeFile(join(options.root, 'runtime.json'), '{}');
  mocks.runtime.mockResolvedValue({
    channel: 'dev',
    pid: 1,
    port: 43822,
    instance: 'instance',
    url: 'private',
  });
  expect((await inspectInstallation(options)).service).toBe('unknown');
});
it('does not mistake a non-file runtime descriptor for a stopped service', async () => {
  const options = await fixture();
  await markInstalled(options);
  await mkdir(join(options.root, 'runtime.json'));
  expect((await inspectInstallation(options)).service).toBe('unknown');
});
it.skipIf(process.platform === 'win32')(
  'refuses linked connection data rather than inspecting its target',
  async () => {
    const options = await fixture();
    await mkdir(options.root, { recursive: true });
    await writeFile(join(options.root, '.avru-channel'), 'dev');
    const target = join(options.autostart.home, 'elsewhere');
    await writeFile(target, 'private');
    await symlink(target, join(options.root, 'browsers.sqlite'));
    await expect(inspectInstallation(options)).rejects.toThrow('Symbolic link');
  },
);
