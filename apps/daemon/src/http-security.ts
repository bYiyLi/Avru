import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';

export function authorized(request: FastifyRequest, key: string): boolean {
  const expected = Buffer.from(`Bearer ${key}`);
  const supplied = Buffer.from(request.headers.authorization ?? '');
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}
export function secureHttp(
  app: FastifyInstance,
  port: number,
  key: string,
): void {
  const host = `127.0.0.1:${String(port)}`;
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    if (
      request.headers.host !== host ||
      (request.headers.origin !== undefined &&
        request.headers.origin !== `http://${host}`)
    ) {
      return reply.code(403).send({ error: 'Untrusted origin' });
    }
    if (request.url.startsWith('/api/') && !authorized(request, key))
      return reply.code(401).send({ error: 'Unauthorized' });
    if (
      request.method !== 'GET' &&
      request.method !== 'HEAD' &&
      request.headers.origin !== `http://${host}`
    )
      return reply.code(403).send({ error: 'Origin required' });
    return undefined;
  });
}
