import { CallTraces } from '../call-traces.js';
import type { TraceCode } from '../call-traces.js';
import { secureErrors } from '../http-security.js';
import { record } from '../messages.js';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Authority } from './authority.js';
import { parameters, scopes } from './config.js';
import { handleMcpRequest } from './mcp.js';
import type { Executions } from '../executions.js';

export function buildRemote(
  authority: Authority,
  traces = new CallTraces(),
  executions?: Executions,
) {
  const app = Fastify({
    logger: false,
    bodyLimit: 8192,
    requestTimeout: 130_000,
  });
  secureErrors(app);
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
  mcpRoutes(app, authority, { traces, executions });
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
    scopes_supported: scopes,
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
    scopes_supported: scopes,
  }));
}

/** Protocol-version and accept checks (auth is handled by the caller). */
function validateMcpRequest(request: FastifyRequest): {
  status: number;
  error: TraceCode;
} | null {
  if (
    request.headers['mcp-protocol-version'] !== undefined &&
    request.headers['mcp-protocol-version'] !== '2025-11-25'
  )
    return { status: 400, error: 'unsupported_protocol_version' };
  // The Streamable HTTP transport (official SDK) requires the client to
  // accept both JSON and SSE responses; mirror that here so the check and
  // its trace code stay in one place instead of surfacing as a bare SDK
  // 406. A bare '*/*' or 'application/json'-only Accept is rejected.
  const accept = request.headers.accept;
  if (
    accept === undefined ||
    !accept.includes('application/json') ||
    !accept.includes('text/event-stream')
  )
    return { status: 406, error: 'not_acceptable' };
  return null;
}

/**
 * Whether the SDK will answer this request with a JSON-RPC error. Used
 * only for call tracing: the SDK returns JSON-RPC errors (unknown method,
 * invalid params) with HTTP 200, so the status code alone cannot tell a
 * protocol failure from success. The SDK remains the authority for the
 * response; this mirrors its validation for the cases the trace cares
 * about (unknown method, tools/call param shape).
 */
function isProtocolError(body: unknown): boolean {
  if (!record(body)) return true;
  const method = body.method;
  if (typeof method !== 'string') return true;
  if (method.startsWith('notifications/')) return false;
  const known = new Set(['initialize', 'ping', 'tools/list', 'tools/call']);
  if (!known.has(method)) return true;
  if (method === 'tools/call') {
    const params = body.params;
    if (!record(params)) return true;
    if (typeof params.name !== 'string') return true;
    if (params.arguments !== undefined && !record(params.arguments))
      return true;
  }
  return false;
}

function mcpRoutes(
  app: FastifyInstance,
  authority: Authority,
  {
    traces,
    executions,
  }: { traces: CallTraces; executions?: Executions | undefined },
): void {
  app.post('/mcp', { bodyLimit: 131072 }, async (request, reply) => {
    const trace = traces.begin(request.body);
    const authenticated = authority.authenticate(request.headers.authorization);
    if (!authenticated) {
      trace.step('authorization', 'rejected', 'invalid_token');
      trace.finish('rejected', 'invalid_token');
      return reply
        .code(401)
        .header('X-Avru-Request-Id', trace.requestId)
        .header(
          'WWW-Authenticate',
          `Bearer resource_metadata="${authority.config.issuer}/.well-known/oauth-protected-resource/mcp", scope="${scopes.join(' ')}"`,
        )
        .send({ error: 'invalid_token' });
    }
    trace.step('authorization', 'succeeded', 'authorized');
    const rejected = validateMcpRequest(request);
    if (rejected) {
      trace.finish('rejected', rejected.error);
      return reply
        .code(rejected.status)
        .header('X-Avru-Request-Id', trace.requestId)
        .send({ error: rejected.error });
    }
    // The SDK writes the raw response, so Fastify-stored headers never reach
    // it: set them on the raw response and hijack the reply.
    reply.raw.setHeader('X-Avru-Request-Id', trace.requestId);
    reply.raw.setHeader('Cache-Control', 'no-store');
    reply.raw.setHeader('Referrer-Policy', 'no-referrer');
    reply.raw.setHeader('X-Content-Type-Options', 'nosniff');
    reply.raw.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'",
    );
    reply.hijack();
    try {
      const outcome = await handleMcpRequest(
        request.raw,
        reply.raw,
        request.body,
        {
          executions,
          owner: authenticated.id,
          scopes: authenticated.scopes,
          audit: { traceId: trace.traceId, requestId: trace.requestId },
        },
      );
      const status = reply.raw.statusCode;
      // The SDK answers JSON-RPC errors with HTTP 200, so fold the
      // request-shape check in or protocol failures trace as success.
      const rejected =
        status >= 400 || outcome.isError || isProtocolError(request.body);
      const code = rejected
        ? 'protocol_error'
        : status === 202
          ? 'notification_accepted'
          : 'completed';
      trace.step('dispatch', rejected ? 'rejected' : 'succeeded', code);
      trace.finish(rejected ? 'rejected' : 'succeeded', code);
      return undefined;
    } catch {
      trace.step('dispatch', 'failed', 'internal_error');
      trace.finish('failed', 'internal_error');
      if (!reply.raw.headersSent && !reply.raw.writableEnded) {
        try {
          reply.raw.writeHead(500, { 'Content-Type': 'application/json' });
          reply.raw.end(JSON.stringify({ error: 'internal_error' }));
        } catch {
          // The client is gone; nothing left to report.
        }
      }
      return undefined;
    }
  });
  app.get('/mcp', (_request, reply) => reply.code(405).send());
}
