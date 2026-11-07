import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';

const types: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
export function serveWeb(app: FastifyInstance, root?: string): void {
  app.get('/', async (_request, reply) => {
    if (!root)
      return reply.code(503).send({ error: 'Build management Web first' });
    try {
      return await reply
        .type('text/html')
        .send(await readFile(resolve(root, 'index.html')));
    } catch {
      return reply
        .type('application/json')
        .code(503)
        .send({ error: 'Build management Web first' });
    }
  });
  app.get<{ Params: { '*': string } }>('/assets/*', async (request, reply) => {
    if (!root) return reply.code(404).send();
    const file = resolve(root, 'assets', request.params['*']);
    const type = types[extname(file)];
    if (!file.startsWith(`${resolve(root, 'assets')}${sep}`) || !type)
      return reply.code(404).send();
    try {
      return await reply.type(type).send(await readFile(file));
    } catch {
      return reply.code(404).send();
    }
  });
}
