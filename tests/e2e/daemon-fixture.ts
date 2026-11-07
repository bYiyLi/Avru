import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';

export async function startDaemon(dataDirectory: string) {
  const child = spawn(process.execPath, [resolve('apps/daemon/dist/main.js')], {
    env: { ...process.env, AVRU_PORT: '43822', AVRU_DATA_DIR: dataDirectory },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.resume();
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const closed = once(child, 'exit');
    child.kill('SIGTERM');
    const deadline = setTimeout(() => {
      child.kill('SIGKILL');
    }, 5000);
    try {
      await closed;
    } finally {
      clearTimeout(deadline);
    }
  };
  try {
    const url = await new Promise<string>((resolveUrl, reject) => {
      let output = '';
      const deadline = setTimeout(() => {
        reject(new Error('Daemon startup timed out'));
      }, 20_000);
      const fail = () => {
        clearTimeout(deadline);
        reject(new Error('Daemon exited before management endpoint was ready'));
      };
      child.once('error', fail);
      child.once('exit', fail);
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        const link = /http:\/\/127\.0\.0\.1:43822\/#key=[a-f0-9]{64}/.exec(
          output,
        )?.[0];
        if (!link) return;
        clearTimeout(deadline);
        child.off('error', fail);
        child.off('exit', fail);
        resolveUrl(link);
      });
    });
    return { url, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
