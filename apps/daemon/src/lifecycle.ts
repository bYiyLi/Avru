import { readFile, writeFile, rename, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

export interface RuntimeDescriptor {
  pid: number;
  port: number;
  url: string;
  instance: string;
}
export async function registerLifecycle(
  app: FastifyInstance,
  root: string,
  descriptor: RuntimeDescriptor,
): Promise<() => Promise<void>> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, 'runtime.json');
  app.get('/api/runtime', () => ({ instance: descriptor.instance }));
  app.post('/api/shutdown', (_request, reply) => {
    reply.code(202).send({ accepted: true });
    setImmediate(() => {
      app.close().catch(() => {
        console.error('Avru graceful shutdown failed');
      });
    });
  });
  app.addHook('onClose', async () => {
    const current = await readFile(path, 'utf8').catch(() => '');
    if (current === JSON.stringify(descriptor)) await rm(path, { force: true });
  });
  return async () => {
    const temporary = `${path}.${descriptor.instance}`;
    await writeFile(temporary, JSON.stringify(descriptor), {
      mode: 0o600,
      flag: 'wx',
    });
    await rename(temporary, path);
  };
}
