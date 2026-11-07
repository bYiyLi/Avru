import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { InstallOptions } from '../src/install.js';
import type { runFlow } from '../src/flow.js';
const mocks = vi.hoisted(() => ({
  flow: vi.fn<typeof runFlow>().mockResolvedValue(0),
  install: vi
    .fn<(options: InstallOptions) => Promise<unknown>>()
    .mockResolvedValue({}),
  start: vi.fn().mockResolvedValue({ url: 'http://127.0.0.1:43822/#key=test' }),
  launcher: vi.fn().mockResolvedValue(vi.fn()),
  autostart: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/flow.js', () => ({ runFlow: mocks.flow }));
vi.mock('../src/install.js', () => ({
  install: mocks.install,
  uninstall: vi.fn(),
}));
vi.mock('../src/runtime.js', () => ({
  startRuntime: mocks.start,
  stopRuntime: vi.fn(),
  openManagement: vi.fn(),
}));
vi.mock('../src/launcher.js', () => ({ installLauncher: mocks.launcher }));
vi.mock('../src/autostart-io.js', () => ({
  enableAutostart: mocks.autostart,
  disableAutostart: vi.fn(),
}));
afterEach(() => {
  vi.unstubAllGlobals();
});
it('CLI uses one channel root consistently for payload and launcher wiring', async () => {
  vi.stubGlobal('process', {
    ...process,
    platform: 'darwin',
    argv: ['node', 'avru'],
    env: { AVRU_DATA_DIR: '/custom/dev', AVRU_PACKAGE_ROOT: '/package' },
  });
  await import('../src/main.js');
  const operations = mocks.flow.mock.calls[0]?.[2];
  expect(operations).toBeDefined();
  await operations?.install();
  const options = mocks.install.mock.calls[0]?.[0];
  expect(options).toMatchObject({
    root: '/custom/dev',
    channel: 'dev',
    sourceRoot: join('/package', 'payload'),
  });
  const active = {
    release: 'fixture-release',
    version: '0.1.0-dev.1',
    execPath: '/node',
  };
  await options?.hooks.start(active);
  expect(mocks.start).toHaveBeenCalledWith({
    dataRoot: '/custom/dev',
    channel: 'dev',
    payloadRoot: join('/custom/dev', 'program', 'releases', 'fixture-release'),
    execPath: '/node',
  });
  await options?.hooks.autostart(active);
  expect(mocks.launcher).toHaveBeenCalledWith(
    join(
      '/custom/dev',
      'program',
      'releases',
      'fixture-release',
      'launcher.mjs',
    ),
    join('/custom/dev', 'program', 'launcher.mjs'),
  );
  expect(mocks.autostart).toHaveBeenCalledWith(
    expect.objectContaining({
      channel: 'dev',
      launcherPath: join('/custom/dev', 'program', 'launcher.mjs'),
    }),
  );
});
