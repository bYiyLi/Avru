import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import {
  cp,
  copyFile,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { install, uninstall } from '../../apps/cli/src/install.ts';
import {
  inspectRuntime,
  startRuntime,
  stopRuntime,
} from '../../apps/cli/src/runtime.ts';

const execute = promisify(execFile);
async function unusedPort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return address.port;
}

async function exerciseInstall(root, cache, port) {
  const registration = join(root, 'autostart-test.txt');
  const hooks = {
    stop: () => stopRuntime(root),
    start: async (active) =>
      (
        await startRuntime({
          dataRoot: root,
          payloadRoot: join(root, 'program/releases', active.release),
          execPath: active.execPath,
          port,
        })
      ).url,
    // A test fixture only. No launchctl, Registry, Startup folder or browser is touched.
    autostart: (active) => writeFile(registration, active.release),
    open: async (url) => {
      const response = await fetch(new URL('/', url));
      assert.equal(response.status, 200);
      assert.match(await response.text(), /<html/);
    },
  };
  const options = {
    root,
    sourceRoot: join(cache, 'payload'),
    version: '0.1.0-dev',
    execPath: process.execPath,
    hooks,
  };
  const first = await install(options);
  assert.equal(first.mode, 'install');
  assert.equal(first.browserOpened, true);
  const before = await inspectRuntime(root);
  assert.ok(before);
  const denied = await fetch(new URL('/api/runtime', before.url));
  assert.equal(denied.status, 401);
  await writeFile(join(root, 'user-settings-test.json'), 'preserve me');
  const repaired = await install(options);
  assert.equal(repaired.mode, 'repair');
  const after = await inspectRuntime(root);
  assert.ok(after);
  assert.notEqual(after.instance, before.instance);
  assert.equal(
    await readFile(join(root, 'user-settings-test.json'), 'utf8'),
    'preserve me',
  );
  await rm(cache, { recursive: true });
  await stopRuntime(root);
  // Survives removal of the entire temporary npx-style package location.
  await copyFile(
    join(root, 'program/releases', repaired.active.release, 'launcher.mjs'),
    join(root, 'program/launcher.mjs'),
  );
  const launcher = spawn(
    process.execPath,
    [join(root, 'program/launcher.mjs')],
    {
      env: {
        ...process.env,
        AVRU_DATA_DIR: join(root, 'wrong-transient-dir'),
        AVRU_PORT: String(port),
      },
      stdio: 'ignore',
    },
  );
  for (
    let attempt = 0;
    attempt < 50 && !(await inspectRuntime(root));
    attempt++
  )
    await delay(100);
  assert.ok(await inspectRuntime(root));
  launcher.unref();
  await uninstall({
    root,
    hooks: { stop: hooks.stop, removeAutostart: () => rm(registration) },
  });
  assert.equal(await inspectRuntime(root), undefined);
  await assert.rejects(readFile(join(root, 'program/active.json')));
  assert.ok((await readFile(join(root, 'browsers.sqlite'))).length > 0);
}

test(
  'bundled package installs, repairs, survives cache deletion and uninstalls',
  { timeout: 45000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'avru-package-'));
    const root = join(directory, 'data');
    const cache = join(directory, 'temporary-package-cache');
    try {
      await cp(resolve('artifacts/avru'), cache, { recursive: true });
      const help = await execute(process.execPath, [
        join(cache, 'cli.mjs'),
        '--help',
      ]);
      assert.match(help.stdout, /Avru/i);
      await exerciseInstall(root, cache, await unusedPort());
    } finally {
      await stopRuntime(root);
      await rm(directory, { recursive: true, force: true });
    }
  },
);
