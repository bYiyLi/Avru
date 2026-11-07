import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { Authority } from './authority.js';
import { parameters, scope } from './config.js';
import { mcpResponse } from './mcp.js';

export function buildRemote(authority: Authority, snapshot: () => unknown) {
  const app = Fastify({
    logger: false,
    bodyLimit: 8192,
    requestTimeout: 130_000,
  });
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => {
      done(null, body);
    },
  );
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'",
    );
    if (
      request.headers.host !== new URL(authority.config.issuer).host ||
      request.headers.origin !== undefined
    )
      return reply.code(403).send({ error: 'untrusted_request' });
    return undefined;
  });
  metadataRoutes(app, authority);
  app.get('/oauth/authorize', async (request, reply) => {
    let requestId = '';
    const cancel = () => {
      authority.cancel(requestId);
    };
    try {
      const result = await new Promise<string>((resolve) => {
        requestId = authority.authorize(
          parameters(request.url.split('?')[1] ?? ''),
          resolve,
        );
        reply.raw.once('close', cancel);
      });
      reply.raw.removeListener('close', cancel);
      return await reply.redirect(result);
    } catch {
      return reply.code(400).send({ error: 'invalid_request' });
    }
  });
  app.post('/oauth/token', (request, reply) => {
    try {
      return authority.exchange(parameters(request.body));
    } catch {
      return reply.code(400).send({ error: 'invalid_grant' });
    }
  });
  app.post('/oauth/revoke', (request, reply) => {
    try {
      authority.revokeToken(parameters(request.body));
      return reply.code(200).send();
    } catch {
      return reply.code(400).send({ error: 'invalid_request' });
    }
  });
  mcpRoutes(app, authority, snapshot);
  const timer = setInterval(() => {
    authority.sweep();
  }, 1000);
  timer.unref();
  app.addHook('preClose', (done) => {
    clearInterval(timer);
    authority.close();
    done();
  });
  return app;
}

function metadataRoutes(app: FastifyInstance, authority: Authority): void {
  app.get('/.well-known/oauth-protected-resource/mcp', () => ({
    resource: authority.resource,
    authorization_servers: [authority.config.issuer],
    scopes_supported: [scope],
    bearer_methods_supported: ['header'],
  }));
  app.get('/.well-known/oauth-authorization-server', () => ({
    issuer: authority.config.issuer,
    authorization_endpoint: `${authority.config.issuer}/oauth/authorize`,
    token_endpoint: `${authority.config.issuer}/oauth/token`,
    revocation_endpoint: `${authority.config.issuer}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
    scopes_supported: [scope],
  }));
}

function mcpRoutes(
  app: FastifyInstance,
  authority: Authority,
  snapshot: () => unknown,
): void {
  app.post('/mcp', (request, reply) => {
    if (!authority.authenticate(request.headers.authorization))
      return reply
        .code(401)
        .header(
          'WWW-Authenticate',
          `Bearer resource_metadata="${authority.config.issuer}/.well-known/oauth-protected-resource/mcp", scope="${scope}"`,
        )
        .send({ error: 'invalid_token' });
    if (
      request.headers['mcp-protocol-version'] !== undefined &&
      request.headers['mcp-protocol-version'] !== '2025-11-25'
    )
      return reply.code(400).send({ error: 'unsupported_protocol_version' });
    if (
      request.headers.accept !== undefined &&
      !request.headers.accept.includes('application/json') &&
      request.headers.accept !== '*/*'
    )
      return reply.code(406).send({ error: 'not_acceptable' });
    const result = mcpResponse(request.body, snapshot);
    return reply.code(result.status).send(result.body);
  });
  app.get('/mcp', (_request, reply) => reply.code(405).send());
}
