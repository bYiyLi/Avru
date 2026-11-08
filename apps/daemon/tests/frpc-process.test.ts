import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { FrpcProcess } from '../src/transports/frpc-process.js';
import {
  ownedDirectory,
  writePrivate,
} from '../src/transports/private-files.js';
import {
  processIdentity,
  processExists,
  admin,
} from '../src/transports/frpc-admin.js';
import { connectionBundle } from './connection-fixture.js';
import { frpcStub } from './frpc-stub.js';
it('runs a substitute process, obtains authenticated proxy status and recovers an owned prior instance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'avru-subprocess-'));
  const directory = await ownedDirectory(root);
  const options = {
    directory,
    payloadRoot: resolve('artifacts'),
    localPort: 43822,
    channel: 'dev' as const,
    verify: () => Promise.resolve(process.execPath),
    spawn: (_file: string, args: string[], opts: Parameters<typeof spawn>[2]) =>
      spawn(process.execPath, ['-e', frpcStub, args[1] ?? ''], opts),
  };
  const first = new FrpcProcess(options);
  try {
    expect(await first.registered()).toBe(false);
    await first.start(connectionBundle());
    await expect.poll(() => first.registered()).toBe(true);
    const descriptor = processIdentity(
      JSON.parse(
        await readFile(join(directory, 'process.json'), 'utf8'),
      ) as unknown,
    );
    expect(processExists(descriptor.pid)).toBe(true);
    await expect(
      admin({ ...descriptor, password: 'a'.repeat(64) }),
    ).rejects.toThrow();
    const config = await readFile(join(directory, 'frpc.json'), 'utf8');
    expect(config).not.toContain(connectionBundle().frp.token);
    expect(config).toContain('127.0.0.1');
    const replacement = new FrpcProcess(options);
    await replacement.start(connectionBundle());
    expect(processExists(descriptor.pid)).toBe(false);
    await expect(first.registered()).rejects.toThrow('exited');
    await expect.poll(() => replacement.registered()).toBe(true);
    await replacement.stop();
    await expect(readFile(join(directory, 'process.json'))).rejects.toThrow();
    await expect(readFile(join(directory, 'key.pem'))).rejects.toThrow();
  } finally {
    await first.stop();
    await rm(root, { recursive: true, force: true });
  }
});
it('never kills a PID without ownership proof and rejects wrong-channel descriptors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'avru-orphan-'));
  const directory = await ownedDirectory(root);
  const driver = new FrpcProcess({
    directory,
    payloadRoot: root,
    localPort: 43822,
    channel: 'dev',
  });
  const descriptor = {
    instance: 'a'.repeat(32),
    pid: process.pid,
    port: 1025,
    username: 'b'.repeat(32),
    password: 'c'.repeat(64),
    proxy: `avru-prod-${'d'.repeat(32)}`,
  };
  try {
    await writePrivate(
      join(directory, 'process.json'),
      JSON.stringify(descriptor),
    );
    await expect(driver.stop()).rejects.toThrow('ownership_unknown');
    descriptor.proxy = `avru-dev-${'d'.repeat(32)}`;
    await writePrivate(
      join(directory, 'process.json'),
      JSON.stringify(descriptor),
    );
    await expect(driver.stop()).rejects.toThrow('ownership_unknown');
    expect(processExists(process.pid)).toBe(true);
    await writePrivate(
      join(directory, 'process.json'),
      JSON.stringify({ ...descriptor, pid: 2147483647 }),
    );
    await driver.stop();
    for (const value of [
      null,
      {},
      { ...descriptor, pid: -1 },
      { ...descriptor, port: 1 },
      { ...descriptor, proxy: 'x' },
    ])
      expect(() => processIdentity(value)).toThrow();
    await writePrivate(join(directory, 'process.json'), '{');
    await expect(driver.stop()).rejects.toThrow('ownership_unknown');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('handles a substitute process exiting, spawn errors and unavailable program verification', async () => {
  const root = await mkdtemp(join(tmpdir(), 'avru-exit-'));
  const directory = await ownedDirectory(root);
  const options = {
    directory,
    payloadRoot: root,
    localPort: 43822,
    channel: 'dev' as const,
    verify: () => Promise.resolve(process.execPath),
    spawn: () => spawn(process.execPath, ['-e', 'process.exit(1)']),
  };
  const driver = new FrpcProcess(options);
  try {
    await driver.start(connectionBundle());
    await expect
      .poll(() =>
        driver.registered().then(
          () => false,
          () => true,
        ),
      )
      .toBe(true);
    await driver.stop();
    const failed = new FrpcProcess({
      ...options,
      spawn: () => spawn(join(root, 'not-an-executable'), []),
    });
    await expect(failed.start(connectionBundle())).rejects.toThrow();
    await failed.stop();
    const unavailable = new FrpcProcess({
      ...options,
      verify: () => Promise.reject(new Error('untrusted')),
    });
    await expect(unavailable.start(connectionBundle())).rejects.toThrow(
      'untrusted',
    );
  } finally {
    await driver.stop();
    await rm(root, { recursive: true, force: true });
  }
});
