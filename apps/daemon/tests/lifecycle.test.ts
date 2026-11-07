import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, test, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { registerLifecycle } from '../src/lifecycle.js';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'avru-runtime-'));
  roots.push(root);
  const app = buildApp({ adminKey: 'key' });
  const descriptor = {
    pid: 1,
    port: 43821,
    instance: 'instance',
    url: 'http://127.0.0.1:43821/#key=key',
  };
  const publish = await registerLifecycle(app, root, descriptor);
  return { root, app, descriptor, publish };
}
test('publishes descriptor only after explicit readiness; protected routes and cleanup', async () => {
  const { root, app, descriptor, publish } = await fixture();
  await expect(readFile(join(root, 'runtime.json'))).rejects.toThrow();
  await publish();
  expect(
    JSON.parse(await readFile(join(root, 'runtime.json'), 'utf8')),
  ).toEqual(descriptor);
  expect(
    (
      await app.inject({
        url: '/api/runtime',
        headers: { host: '127.0.0.1:43821' },
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await app.inject({
        url: '/api/runtime',
        headers: { host: '127.0.0.1:43821', authorization: 'Bearer key' },
      })
    ).json(),
  ).toEqual({ instance: 'instance' });
  await app.close();
  await expect(readFile(join(root, 'runtime.json'))).rejects.toThrow();
});
test('authenticated shutdown and replacement descriptor is preserved', async () => {
  const { root, app, publish } = await fixture();
  await publish();
  await writeFile(join(root, 'runtime.json'), 'replacement');
  const response = await app.inject({
    method: 'POST',
    url: '/api/shutdown',
    headers: {
      host: '127.0.0.1:43821',
      origin: 'http://127.0.0.1:43821',
      authorization: 'Bearer key',
    },
  });
  expect(response.statusCode).toBe(202);
  await new Promise((resolve) => setImmediate(resolve));
  await app.close();
  expect(await readFile(join(root, 'runtime.json'), 'utf8')).toBe(
    'replacement',
  );
});
test('close without publish tolerates missing descriptor', async () => {
  const { app } = await fixture();
  await app.close();
});

test('reports a shutdown error without unhandled rejection', async () => {
  const { app } = await fixture();
  const close = vi
    .spyOn(app, 'close')
    .mockRejectedValueOnce(new Error('failure'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await app.inject({
    method: 'POST',
    url: '/api/shutdown',
    headers: {
      host: '127.0.0.1:43821',
      origin: 'http://127.0.0.1:43821',
      authorization: 'Bearer key',
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  expect(log).toHaveBeenCalledWith('Avru graceful shutdown failed');
  close.mockRestore();
  log.mockRestore();
  await app.close();
});
