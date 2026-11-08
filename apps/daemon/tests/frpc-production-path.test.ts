import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type * as ChildProcessModule from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it, vi } from 'vitest';
import { FrpcProcess } from '../src/transports/frpc-process.js';
import { ownedDirectory } from '../src/transports/private-files.js';
import { connectionBundle } from './connection-fixture.js';
import { frpcStub } from './frpc-stub.js';
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof ChildProcessModule>();
  const { frpcStub: code } = await import('./frpc-stub.js');
  return {
    ...actual,
    spawn: vi.fn(
      (
        _file: string,
        args: string[],
        options: Parameters<typeof actual.spawn>[2],
      ) => actual.spawn(process.execPath, ['-e', code, args[1] ?? ''], options),
    ),
  };
});
it('statically verifies the official program on the production path while executing only the substitute', async () => {
  const root = await mkdtemp(join(tmpdir(), 'avru-verified-'));
  const directory = await ownedDirectory(root);
  const driver = new FrpcProcess({
    directory,
    payloadRoot: resolve('artifacts'),
    localPort: 43822,
    channel: 'dev',
  });
  try {
    await driver.start(connectionBundle());
    await expect.poll(() => driver.registered()).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      expect.stringMatching(/frpc(?:\.exe)?$/),
      expect.any(Array),
      expect.objectContaining({ shell: false }),
    );
    expect(frpcStub).toContain('/api/stop');
  } finally {
    await driver.stop();
    await rm(root, { recursive: true, force: true });
  }
});
it('retains ownership state when a substitute refuses both termination signals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'avru-stuck-'));
  const directory = await ownedDirectory(root);
  const emitter = new EventEmitter();
  const kill = vi.fn().mockReturnValue(false);
  const child = Object.assign(emitter, {
    pid: process.pid,
    kill,
  }) as unknown as ChildProcess;
  const driver = new FrpcProcess({
    directory,
    payloadRoot: root,
    localPort: 43822,
    channel: 'dev',
    verify: () => Promise.resolve('substitute'),
    spawn: () => {
      queueMicrotask(() => {
        emitter.emit('spawn');
      });
      return child;
    },
  });
  try {
    await driver.start(connectionBundle());
    const stopping = driver.stop().then(
      () => '',
      (error: unknown) =>
        error instanceof Error ? error.message : 'unexpected',
    );
    expect(await stopping).toBe('ownership_unknown');
    expect(kill).toHaveBeenCalledWith('SIGKILL');
    emitter.emit('exit');
    await driver.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
