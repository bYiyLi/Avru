import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';

const dataRoot = process.env.AVRU_DATA_DIR ?? resolve(homedir(), '.avru');
const port = Number(process.env.AVRU_PORT ?? '43821');
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid AVRU_PORT');
const adminKey = randomBytes(32).toString('hex');
const app = buildApp({
  adminKey,
  port,
  databasePath: resolve(dataRoot, 'browsers.sqlite'),
  webRoot: fileURLToPath(new URL('../../web/dist', import.meta.url)),
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
