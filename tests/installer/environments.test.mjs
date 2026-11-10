import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { install, uninstall } from '../../apps/cli/src/install.ts';
import {
  inspectRuntime,
  startRuntime,
  stopRuntime,
} from '../../apps/cli/src/runtime.ts';

const execute = promisify(execFile);
async function unusedPort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await new Promise((done) => server.close(done));
  return address.port;
}

function api(runtime, path, keyRuntime = runtime) {
  const key = new URL(keyRuntime.url).hash.slice(5);
  return fetch(new URL(path, runtime.url), {
    headers: { authorization: `Bearer ${key}` },
  });
}

async function environment(directory, channel) {
  const root = join(directory, channel);
  const source = resolve(
    channel === 'dev' ? 'artifacts/avru' : 'artifacts/avru-prod',
  );
  const version = channel === 'dev' ? '0.1.0-dev.1' : '0.1.0';
  const port = await unusedPort();
  const registration = join(root, 'login-test.txt');
  const options = {
    root,
    channel,
    sourceRoot: join(source, 'payload'),
    version,
    execPath: process.execPath,
    hooks: {
      stop: () => stopRuntime(root, channel),
      start: async (active) =>
        (
          await startRuntime({
            dataRoot: root,
            channel,
            port,
            payloadRoot: join(root, 'program/releases', active.release),
            execPath: active.execPath,
          })
        ).url,
      // CI fixture only; real Mac login items are accepted separately.
      autostart: (active) => writeFile(registration, active.release),
      open: async () => {},
    },
  };
  const identity = await execute(
    process.execPath,
    [join(source, 'cli.mjs'), '--version'],
    {
      env: { ...process.env, AVRU_CHANNEL: channel === 'dev' ? 'prod' : 'dev' },
    },
  );
  assert.equal(identity.stdout.trim(), version);
  await install(options);
  const runtime = await inspectRuntime(root, channel);
  assert.ok(runtime);
  const status = await (await api(runtime, '/api/status')).json();
  assert.equal(status.channel, channel);
  assert.equal(status.daemonVersion, version);
  assert.equal(status.extensionFiles.directory, join(root, 'extension'));
  const connection = await (await api(runtime, '/api/connection')).json();
  assert.equal(connection.state, 'unconfigured');
  assert.equal(connection.programAvailable, true);
  return {
    root,
    channel,
    runtime,
    options,
    registration,
    extensionId: status.extensionFiles.extensionId,
  };
}

async function verifyRollback(prod) {
  const activePath = join(prod.root, 'program/active.json');
  const previous = JSON.parse(await readFile(activePath, 'utf8'));
  const releasesPath = join(prod.root, 'program/releases');
  const releases = await readdir(releasesPath);
  let failedInstance;
  await assert.rejects(
    install({
      ...prod.options,
      hooks: {
        ...prod.options.hooks,
        autostart: async (active) => {
          if (active.release !== previous.release) {
            failedInstance = (await inspectRuntime(prod.root, 'prod')).instance;
            throw new Error('simulated login registration failure');
          }
          await prod.options.hooks.autostart(active);
        },
      },
    }),
    /simulated login registration failure/,
  );
  assert.deepEqual(JSON.parse(await readFile(activePath, 'utf8')), previous);
  assert.deepEqual(await readdir(releasesPath), releases);
  const rolledBack = await inspectRuntime(prod.root, 'prod');
  assert.ok(
    rolledBack && failedInstance && rolledBack.instance !== failedInstance,
  );
  assert.equal((await api(rolledBack, '/api/status')).status, 200);
}

test(
  'compiled dev/prod packages coexist, reject cross credentials, roll back failed updates and uninstall separately',
  { timeout: 45000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'avru-environments-'));
    try {
      const dev = await environment(directory, 'dev');
      const prod = await environment(directory, 'prod');
      assert.notEqual(dev.runtime.pid, prod.runtime.pid);
      assert.notEqual(dev.runtime.port, prod.runtime.port);
      assert.notEqual(dev.extensionId, prod.extensionId);
      assert.equal(
        (await api(prod.runtime, '/api/runtime', dev.runtime)).status,
        401,
      );
      assert.equal(
        (await api(dev.runtime, '/api/runtime', prod.runtime)).status,
        401,
      );
      assert.equal(await inspectRuntime(dev.root, 'prod'), undefined);
      await assert.rejects(
        install({ ...prod.options, root: dev.root }),
        /channel mismatch/,
      );
      await assert.rejects(
        execute(
          process.execPath,
          [join(prod.options.sourceRoot, 'daemon.mjs')],
          {
            env: {
              ...process.env,
              AVRU_CHANNEL: 'dev',
              AVRU_DATA_DIR: join(directory, 'forbidden'),
            },
            timeout: 5000,
          },
        ),
      );
      await verifyRollback(prod);
      await install(prod.options);
      assert.equal(
        (await inspectRuntime(dev.root, 'dev')).instance,
        dev.runtime.instance,
      );
      await uninstall({
        root: prod.root,
        channel: 'prod',
        hooks: {
          stop: prod.options.hooks.stop,
          removeAutostart: () => rm(prod.registration),
        },
      });
      assert.equal(await inspectRuntime(prod.root, 'prod'), undefined);
      assert.equal(
        (await inspectRuntime(dev.root, 'dev')).instance,
        dev.runtime.instance,
      );
      assert.ok((await readFile(join(dev.root, 'browsers.sqlite'))).length);
      assert.ok((await readFile(join(prod.root, 'browsers.sqlite'))).length);
    } finally {
      for (const channel of ['dev', 'prod'])
        await stopRuntime(join(directory, channel), channel);
      await rm(directory, { recursive: true, force: true });
    }
  },
);
