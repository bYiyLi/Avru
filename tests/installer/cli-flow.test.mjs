import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { inspectRuntime, stopRuntime } from '../../apps/cli/src/runtime.ts';

const execute = promisify(execFile);
async function unusedPort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await new Promise((done) => server.close(done));
  return address.port;
}
function isolatedEnvironment(directory, root, port) {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !/^AVRU_/i.test(name) &&
        !/^(NODE_AUTH_TOKEN|NPM_TOKEN|GH_TOKEN|GITHUB_TOKEN)$/i.test(name),
    ),
  );
  return {
    ...inherited,
    AVRU_TEST_HOME: directory,
    AVRU_DATA_DIR: root,
    AVRU_TEST_PORT: String(port),
  };
}
async function verifyConflictingInstallation({
  directory,
  root,
  port,
  packageRoot,
  bootstrap,
  running,
}) {
  const loginFile =
    process.platform === 'win32'
      ? join(
          directory,
          'AppData',
          'Roaming',
          'Microsoft',
          'Windows',
          'Start Menu',
          'Programs',
          'Startup',
          'Avru-dev.cmd',
        )
      : join(directory, 'Library', 'LaunchAgents', 'ai.avru.daemon.dev.plist');
  const loginBefore = await readFile(loginFile);
  const otherRoot = join(directory, 'another-installation', 'dev');
  const otherEnv = isolatedEnvironment(directory, otherRoot, port);
  await assert.rejects(
    execute(
      process.execPath,
      ['--import', bootstrap, join(packageRoot, 'cli.mjs'), '--yes'],
      { env: otherEnv, timeout: 10000 },
    ),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(
        `${error.stdout}${error.stderr}`,
        /无法确认登录启动项是否属于当前安装/,
      );
      return true;
    },
  );
  assert.deepEqual(await readFile(loginFile), loginBefore);
  assert.equal((await inspectRuntime(root, 'dev')).instance, running.instance);
  await assert.rejects(readFile(join(otherRoot, '.avru-channel')), {
    code: 'ENOENT',
  });
}

test(
  'packaged CLI installs, repairs and uninstalls inside an isolated user directory',
  { timeout: 60000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'avru-cli-flow-'));
    const root = join(directory, 'Avru', 'dev');
    const packageRoot = resolve(
      process.env.AVRU_INSTALLER_TEST_PACKAGE_ROOT ?? 'artifacts/avru',
    );
    const bootstrap = resolve('tests/installer/isolation-bootstrap.mjs');
    const port = await unusedPort();
    const env = isolatedEnvironment(directory, root, port);
    const run = (...args) =>
      execute(
        process.execPath,
        ['--import', bootstrap, join(packageRoot, 'cli.mjs'), ...args],
        { env, timeout: 20000 },
      );
    try {
      const first = await run('--yes');
      assert.match(first.stdout, /Avru 开发版已安装/);
      const initial = JSON.parse(
        await readFile(join(root, 'program', 'active.json'), 'utf8'),
      );
      const running = await inspectRuntime(root, 'dev');
      assert.ok(running && running.port === port);
      await verifyConflictingInstallation({
        directory,
        root,
        port,
        packageRoot,
        bootstrap,
        running,
      });
      const keep = join(root, 'personal-note.txt');
      await writeFile(keep, 'keep this');
      const activePath = join(root, 'program', 'active.json');
      await writeFile(
        activePath,
        JSON.stringify({ ...initial, version: '0.1.0-dev.2' }),
      );
      await assert.rejects(run('--yes'), (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stdout, /旧安装包不能自动降级/);
        return true;
      });
      assert.equal(
        (await inspectRuntime(root, 'dev')).instance,
        running.instance,
      );
      assert.equal(
        JSON.parse(await readFile(activePath, 'utf8')).version,
        '0.1.0-dev.2',
      );
      await writeFile(activePath, JSON.stringify(initial));
      const second = await run('--yes');
      assert.match(second.stdout, /Avru 开发版已修复/);
      const repaired = JSON.parse(
        await readFile(join(root, 'program', 'active.json'), 'utf8'),
      );
      assert.notEqual(repaired.release, initial.release);
      assert.equal(await readFile(keep, 'utf8'), 'keep this');
      const removed = await run('uninstall', '--yes');
      assert.match(removed.stdout, /连接设置和记录未被清除/);
      assert.ok((await readFile(join(root, 'browsers.sqlite'))).length > 0);
      const cleared = await run('uninstall', '--yes', '--remove-data');
      assert.match(cleared.stdout, /调用记录和连接活动记录/);
      assert.doesNotMatch(cleared.stdout, /将保留已有的连接设置和记录/);
      await assert.rejects(readFile(join(root, 'browsers.sqlite')), {
        code: 'ENOENT',
      });
      assert.equal(await readFile(keep, 'utf8'), 'keep this');
      assert.ok(await readFile(join(root, 'extension', 'manifest.json')));
    } finally {
      await stopRuntime(root, 'dev');
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'packaged CLI stops before writes when the existing service cannot be verified',
  { timeout: 20000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'avru-cli-unknown-'));
    const root = join(directory, 'Avru', 'dev');
    const packageRoot = resolve(
      process.env.AVRU_INSTALLER_TEST_PACKAGE_ROOT ?? 'artifacts/avru',
    );
    const bootstrap = resolve('tests/installer/isolation-bootstrap.mjs');
    const env = isolatedEnvironment(directory, root, await unusedPort());
    try {
      await mkdir(join(root, 'program'), { recursive: true });
      await writeFile(join(root, '.avru-channel'), 'dev');
      await writeFile(join(root, 'program', '.avru-owned'), 'avru-program-v1');
      const record = JSON.stringify({
        release: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        version: '0.1.0-dev.1',
        execPath: process.execPath,
      });
      await writeFile(join(root, 'program', 'active.json'), record);
      await writeFile(join(root, 'runtime.json'), '{}');
      await writeFile(join(root, 'browsers.sqlite'), 'retained');
      await assert.rejects(
        execute(
          process.execPath,
          ['--import', bootstrap, join(packageRoot, 'cli.mjs'), '--yes'],
          { env, timeout: 10000 },
        ),
        (error) => {
          assert.equal(error.code, 1);
          assert.match(
            `${error.stdout}${error.stderr}`,
            /无法确认 Avru 服务的当前状态/,
          );
          return true;
        },
      );
      assert.equal(await readFile(join(root, 'runtime.json'), 'utf8'), '{}');
      assert.equal(
        await readFile(join(root, 'program', 'active.json'), 'utf8'),
        record,
      );
      assert.equal(
        await readFile(join(root, 'browsers.sqlite'), 'utf8'),
        'retained',
      );
      await assert.rejects(readFile(join(root, '.install.lock')), {
        code: 'ENOENT',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
