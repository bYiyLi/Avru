import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Runner } from '../../packages/runner/dist/supervisor.js';

const workerEntry = fileURLToPath(
  new URL('../../packages/runner/worker.mjs', import.meta.url),
);

function spawnWorker() {
  return spawn(process.execPath, ['--max-old-space-size=64', workerEntry], {
    env: {},
    stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
  });
}

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
      const tabs = [
        {
          browserId: 'b1',
          tabId: 't1',
          generation: 1,
          title: 'Example',
          url: 'https://example.test/',
          active: true,
          claimed: true,
        },
      ];
      const invoke = (method) => {
        if (method === 'tabs.list')
          return Promise.resolve(JSON.stringify(tabs));
        if (method === 'tab.title')
          return Promise.resolve(JSON.stringify('Example'));
        return Promise.reject(new Error('denied'));
      };
      assert.deepEqual(
        await runner.run(
          'return { tabs: await browser.tabs.list(), title: await browser.tab.title() };',
          invoke,
        ).result,
        {
          status: 'completed',
          json: JSON.stringify({ tabs, title: 'Example' }),
        },
      );
      // __hostCall payloads are JSON text: the echo round-trips the JSON
      // array ['hello'] and the script parses it back to 'hello'.
      assert.deepEqual(
        await runner.run(
          'return JSON.parse(await __hostCall("mock.echo", \'"hello"\'));',

          (_, json) => Promise.resolve(json),
        ).result,
        { status: 'completed', json: '"hello"' },
      );
      const hanging = runner.run(
        'return await __hostCall("mock.echo", \'"x"\');',
        () => new Promise(() => {}),
        { timeoutMs: 50 },
      );
      assert.equal((await hanging.result).status, 'unknown');
      const stuck = runner.run('while(true){}', undefined, {
        timeoutMs: 50,
      });
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
    for (const malformed of [true, false]) {
      const child = spawnWorker();
      const closed = new Promise((resolve) => child.once('exit', resolve));
      if (malformed)
        child.stdio[3].write(
          `${JSON.stringify({
            v: 1,
            type: 'run_task',
            taskId: 'invalid',
            seq: 1,
            script: '',
            limits: {
              timeoutMs: 5000,
              maxOutputBytes: 65536,
              maxBridgeCalls: 32,
            },
          })}\n`,
        );
      else child.stdio[3].destroy();
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
      child = spawnWorker();
      return child;
    });
    try {
      const task = runner.run('await new Promise(()=>{});');
      await new Promise((resolve) => setTimeout(resolve, 200));
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
