import { buildApp } from './app.js';
const app = buildApp();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.close().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  });
}
try {
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  console.log(`Avru health-only scaffold: ${address}/health`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
