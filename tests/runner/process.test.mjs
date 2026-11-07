import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Runner } from '../../packages/runner/dist/supervisor.js';

test(
  'real QuickJS child: isolated reuse, mock bridge, deadlines and restart',
  { timeout: 25000 },
  async () => {
    const runner = new Runner();
    try {
      const first = runner.run('globalThis.privateTask = 1; return 7;');
      assert.deepEqual(await first.result, { status: 'completed', json: '7' });
      assert.deepEqual(await runner.run('return typeof privateTask;').result, {
        status: 'completed',
        json: '"undefined"',
      });
      assert.deepEqual(
        await runner.run(
          'return await __hostCall("mock.echo", "hello");',
          (_, json) => Promise.resolve(json),
        ).result,
        { status: 'completed', json: '"hello"' },
      );
      const stuck = runner.run('while(true){}');
      assert.equal((await stuck.result).status, 'timeout');
      assert.deepEqual(await runner.run('return 2;').result, {
        status: 'completed',
        json: '2',
      });
      const cancelled = runner.run('await new Promise(()=>{});');
      cancelled.cancel();
      assert.equal((await cancelled.result).status, 'cancelled');
      assert.deepEqual(await runner.run('return 3;').result, {
        status: 'completed',
        json: '3',
      });
    } finally {
      runner.close();
    }
  },
);

test(
  'worker exits on malformed IPC and parent disconnect',
  { timeout: 10000 },
  async () => {
    const entry = fileURLToPath(
      new URL('../../packages/runner/worker.mjs', import.meta.url),
    );
    for (const malformed of [true, false]) {
      const child = fork(entry, [], {
        env: {},
        execArgv: [],
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      const closed = new Promise((resolve) => child.once('exit', resolve));
      if (malformed) child.send({ type: 'run', id: 'invalid', code: '' });
      else child.disconnect();
      await closed;
    }
  },
);

test(
  'externally killed child is not replayed and next task gets a fresh child',
  { timeout: 10000 },
  async () => {
    let child;
    let launches = 0;
    const runner = new Runner(() => {
      ++launches;
      child = fork(
        fileURLToPath(
          new URL('../../packages/runner/worker.mjs', import.meta.url),
        ),
        [],
        { env: {}, execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
      );
      return child;
    });
    try {
      const task = runner.run('await new Promise(()=>{});');
      child.kill('SIGKILL');
      assert.equal((await task.result).status, 'crashed');
      assert.deepEqual(await runner.run('return 9;').result, {
        status: 'completed',
        json: '9',
      });
      assert.equal(launches, 2);
    } finally {
      runner.close();
    }
  },
);
