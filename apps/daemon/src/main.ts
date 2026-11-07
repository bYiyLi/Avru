import {
  defaultDataRoot,
  runtimeChannel,
  runtimePort,
  verifyDataRoot,
} from './environment.js';
import { loadOAuthConfig } from './oauth/load-config.js';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { registerLifecycle } from './lifecycle.js';
import { buildApp } from './app.js';

async function bootstrap(): Promise<void> {
  const channel = runtimeChannel(process.env.AVRU_CHANNEL);
  const dataRoot =
    process.env.AVRU_DATA_DIR ??
    defaultDataRoot(homedir(), process.platform, process.env.LOCALAPPDATA);
  const port = runtimePort(channel, process.env.AVRU_PORT);
  await verifyDataRoot(dataRoot, channel);
  const adminKey = randomBytes(32).toString('hex');
  const oauth = await loadOAuthConfig(process.env.AVRU_OAUTH_CONFIG, channel);
  const app = buildApp({
    ...(oauth ? { oauth } : {}),
    channel,
    adminKey,
    port,
    databasePath: resolve(dataRoot, 'browsers.sqlite'),
    webRoot:
      process.env.AVRU_WEB_ROOT ??
      resolve(dirname(process.argv[1] ?? '.'), '../../web/dist'),
  });
  const publishRuntime = await registerLifecycle(app, dataRoot, {
    channel,
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
