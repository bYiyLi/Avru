import type { InstalledExtension } from './installed-extension.js';
import type { ReleaseChannel } from '../../../packages/protocol/environment.js';
import { CallTraces } from './call-traces.js';
import { attachOAuth } from './oauth/integration.js';
import type { OAuthConfig } from './oauth/config.js';
import { releaseInfo } from './release-info.js';
import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import { BrowserStore } from './store.js';
import { Connections } from './connections.js';
import { secureHttp } from './http-security.js';
import { serveWeb } from './static-web.js';
import { connectWebSockets } from './websocket.js';

export interface AppOptions {
  channel?: ReleaseChannel;
  installedExtension?: InstalledExtension | null;
  adminKey?: string;
  databasePath?: string;
  webRoot?: string;
  port?: number;
  oauth?: OAuthConfig & { port: number };
}
export function buildApp(options: AppOptions = {}) {
  const port = options.port ?? 43821;
  const app = Fastify({ logger: false, bodyLimit: 1024 });
  const store = new BrowserStore(options.databasePath ?? ':memory:');
  const connections = new Connections(
    store,
    Date.now,
    (sessionId, browserId, decision) => {
      authority?.decide(sessionId, browserId, decision);
    },
    options.channel,
  );
  const traces = new CallTraces();
  const authority = attachOAuth(app, connections, options.oauth, {
    port,
    traces,
  });
  secureHttp(app, port, options.adminKey ?? randomBytes(32).toString('hex'));
  app.get('/health', () => ({
    service: 'avru',
    state: 'browser-connection',
    browserControl: false,
  }));
  app.get('/api/status', () => ({
    ...releaseInfo,
    extensionFiles: options.installedExtension ?? null,
    channel: options.channel,
    mcp: authority ? 'oauthReadOnly' : 'notImplemented',
    chatgpt: 'notImplemented',
    frpc: 'notImplemented',
  }));
  app.get('/api/calls', () => traces.snapshot());
  app.get('/api/grants', () => ({ grants: authority?.grants() ?? [] }));
  app.delete<{ Params: { id: string } }>(
    '/api/grants/:id',
    (request, reply) => {
      authority?.revoke(request.params.id);
      return reply.code(204).send();
    },
  );
  app.get('/api/browsers', () => ({ browsers: connections.browsers() }));
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
  app.addHook('onClose', (_instance, done) => {
    store.close();
    done();
  });
  return app;
}
