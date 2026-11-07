import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { registerLifecycle } from './lifecycle.js';
import { buildApp } from './app.js';

async function bootstrap(): Promise<void> {
  const dataRoot = process.env.AVRU_DATA_DIR ?? resolve(homedir(), '.avru');
  const port = Number(process.env.AVRU_PORT ?? '43821');
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Invalid AVRU_PORT');
  const adminKey = randomBytes(32).toString('hex');
  const app = buildApp({
    adminKey,
    port,
    databasePath: resolve(dataRoot, 'browsers.sqlite'),
    webRoot:
      process.env.AVRU_WEB_ROOT ??
      resolve(dirname(process.argv[1] ?? '.'), '../../web/dist'),
  });
  const publishRuntime = await registerLifecycle(app, dataRoot, {
    pid: process.pid,
    port,
    instance: randomBytes(16).toString('hex'),
    url: `http://127.0.0.1:${String(port)}/#key=${adminKey}`,
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      app.close().catch(() => {
        console.error('Avru shutdown failed');
        process.exitCode = 1;
      });
    });
  }
  try {
    const address = await app.listen({ host: '127.0.0.1', port });
    await publishRuntime();
    console.log(
      `Avru local management (private link): ${address}/#key=${adminKey}`,
    );
  } catch {
    console.error(
      'Avru could not start. Check the local port and data directory.',
    );
    await app.close();
    process.exitCode = 1;
  }
}
bootstrap().catch(() => {
  console.error('Avru initialization failed. Check the data directory.');
  process.exitCode = 1;
});
