import Fastify from 'fastify';
/** Health-only scaffold: no browser, OAuth, MCP or management endpoint. */
export function buildApp() {
  const app = Fastify({ logger: false });
  app.get('/health', (_request, reply) =>
    reply.send({
      service: 'avru',
      state: 'scaffold',
      browserControl: false,
    }),
  );
  return app;
}
