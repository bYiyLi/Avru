import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import { BrowserStore } from './store.js';
import { Connections } from './connections.js';
import { secureHttp } from './http-security.js';
import { serveWeb } from './static-web.js';
import { connectWebSockets } from './websocket.js';

export interface AppOptions {
  adminKey?: string;
  databasePath?: string;
  webRoot?: string;
  port?: number;
}
export function buildApp(options: AppOptions = {}) {
  const port = options.port ?? 43821;
  const app = Fastify({ logger: false, bodyLimit: 1024 });
  const store = new BrowserStore(options.databasePath ?? ':memory:');
  const connections = new Connections(store);
  secureHttp(app, port, options.adminKey ?? randomBytes(32).toString('hex'));
  app.get('/health', () => ({
    service: 'avru',
    state: 'browser-connection',
    browserControl: false,
  }));
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
  const closeSockets = connectWebSockets(app.server, connections, port);
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
