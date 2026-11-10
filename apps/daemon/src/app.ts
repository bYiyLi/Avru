import { record } from './messages.js';
import type { InstalledExtension } from './installed-extension.js';
import type { ReleaseChannel } from '../../../packages/protocol/environment.js';
import { CallTraces } from './call-traces.js';
import { OAuthListener } from './oauth/integration.js';
import { ConnectionManager } from './transports/connection-manager.js';
import type { ConnectionDriver } from './transports/frpc-process.js';
import type { OAuthConfig } from './oauth/config.js';
import { releaseInfo } from './release-info.js';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { BrowserStore } from './store.js';
import { Connections } from './connections.js';
import { secureHttp, secureErrors } from './http-security.js';
import { serveWeb } from './static-web.js';
import { connectWebSockets } from './websocket.js';
import { Executions } from './executions.js';
import { ExecutionAudit } from './execution-audit.js';

export interface AppOptions {
  channel?: ReleaseChannel;
  installedExtension?: InstalledExtension | null;
  adminKey?: string;
  databasePath?: string;
  webRoot?: string;
  port?: number;
  oauth?: OAuthConfig & { port: number };
  connection?: {
    dataRoot: string;
    payloadRoot: string;
    driver?: ConnectionDriver;
  };
}
export function buildApp(options: AppOptions = {}) {
  const port = options.port ?? 43821;
  const app = Fastify({ logger: false, bodyLimit: 1024 });
  secureErrors(app);
  const store = new BrowserStore(options.databasePath ?? ':memory:');
  const connections = new Connections(
    store,
    Date.now,
    (sessionId, browserId, decision) => {
      remote.authority?.decide(sessionId, browserId, decision);
    },
    options.channel,
  );
  const executionAuditPath =
    options.databasePath && options.databasePath !== ':memory:'
      ? join(
          dirname(options.databasePath),
          `${basename(options.databasePath, '.sqlite')}-execution-audit.sqlite`,
        )
      : undefined;
  const executionAudit = new ExecutionAudit(executionAuditPath);
  const traces = new CallTraces(executionAuditPath);
  if (options.databasePath && options.databasePath !== ':memory:')
    traces.migrateLegacy(options.databasePath);
  const executions = new Executions(connections, executionAudit);
  connections.onInterrupted(executions.interruptByUser.bind(executions));
  const remote = new OAuthListener(connections, {
    port,
    traces,
    executions,
  });
  if (options.oauth) remote.prepare(options.oauth);
  const connection =
    options.connection && options.channel
      ? new ConnectionManager({
          ...options.connection,
          channel: options.channel,
          localPort: port,
          ...(options.databasePath
            ? { databasePath: options.databasePath }
            : {}),
          external: !!options.oauth,
          remote,
        })
      : undefined;
  app.addHook('onReady', async () => {
    await remote.listen();
    await connection?.initialize();
  });
  app.addHook('preClose', async () => {
    executions.close();
    await connection?.close();
    await remote.close();
  });
  secureHttp(app, port, options.adminKey ?? randomBytes(32).toString('hex'));
  statusRoutes(app, options, remote, connection);
  app.get('/api/calls', () => traces.snapshot());
  app.get('/api/execution-audit', () => executionAudit.snapshot());
  connectionRoutes(app, connection);
  app.get('/api/grants', () => ({ grants: remote.authority?.grants() ?? [] }));
  app.delete<{ Params: { id: string } }>(
    '/api/grants/:id',
    (request, reply) => {
      remote.authority?.revoke(request.params.id);
      return reply.code(204).send();
    },
  );
  app.get('/api/browsers', () => ({ browsers: connections.browsers() }));
  connectionTicketRoute(app, connections);
  browserRoutes(app, connections);
  serveWeb(app, options.webRoot);
  const closeSockets = connectWebSockets(
    app.server,
    connections,
    port,
    options.channel,
  );
  const timer = setInterval(() => {
    connections.sweep();
  }, 1000);
  timer.unref();
  app.addHook('preClose', (done) => {
    clearInterval(timer);
    connections.close();
    closeSockets();
    done();
  });
  app.addHook('onClose', closeStores(traces, store, executionAudit));
  return app;
}

function statusRoutes(
  app: FastifyInstance,
  options: AppOptions,
  remote: OAuthListener,
  connection: ConnectionManager | undefined,
): void {
  app.get('/health', () => ({
    service: 'avru',
    state: 'browser-connection',
    browserControl: true,
  }));
  app.get('/api/status', () => ({
    ...releaseInfo,
    extensionFiles: options.installedExtension ?? null,
    channel: options.channel,
    mcp: remote.authority ? 'browserControl' : 'notImplemented',
    chatgpt: 'notVerified',
    frpc: connection ? 'managed' : 'notImplemented',
  }));
}

function browserRoutes(app: FastifyInstance, connections: Connections): void {
  app.get('/api/pairings', () => ({ pairings: connections.pairings() }));
  app.post<{ Params: { id: string } }>(
    '/api/pairings/:id/approve',
    (request, reply) => {
      return reply
        .code(connections.approve(request.params.id) ? 204 : 404)
        .send();
    },
  );
  app.delete<{ Params: { id: string } }>(
    '/api/pairings/:id',
    (request, reply) => {
      return reply
        .code(connections.reject(request.params.id) ? 204 : 404)
        .send();
    },
  );
  app.delete<{ Params: { id: string } }>(
    '/api/browsers/:id',
    (request, reply) => {
      return reply
        .code(connections.revoke(request.params.id) ? 204 : 404)
        .send();
    },
  );
}

function connectionRoutes(
  app: FastifyInstance,
  connection: ConnectionManager | undefined,
): void {
  app.get(
    '/api/connection',
    (_request, reply) =>
      connection?.snapshot() ??
      reply.code(503).send({ error: 'connection_unavailable' }),
  );
  app.post(
    '/api/connection/import',
    { bodyLimit: 262144 },
    async (request, reply) => {
      if (!connection)
        return await reply.code(503).send({ error: 'connection_unavailable' });
      try {
        await connection.import(request.body);
        return connection.snapshot();
      } catch {
        return await reply
          .code(400)
          .send({ error: 'connection_configuration_failed' });
      }
    },
  );
  app.delete('/api/connection', async (_request, reply) => {
    if (!connection)
      return await reply.code(503).send({ error: 'connection_unavailable' });
    try {
      await connection.clear();
      return await reply.code(204).send();
    } catch {
      return await reply.code(409).send({ error: 'connection_clear_failed' });
    }
  });
}

function connectionTicketRoute(
  app: FastifyInstance,
  connections: Connections,
): void {
  app.post('/api/connection-ticket', (request, reply) => {
    const body = request.body;
    if (
      !record(body) ||
      typeof body.challenge !== 'string' ||
      !/^[a-f0-9]{64}$/.test(body.challenge)
    )
      return reply.code(400).send({ error: 'Invalid challenge' });
    const issued = connections.issueConnectionTicket(body.challenge);
    return issued ?? reply.code(404).send({ error: 'Challenge unavailable' });
  });
}

function closeStores(
  traces: CallTraces,
  store: BrowserStore,
  audit: ExecutionAudit,
) {
  return (_instance: FastifyInstance, done: () => void) => {
    traces.close();
    audit.close();
    store.close();
    done();
  };
}
