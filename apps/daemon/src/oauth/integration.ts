import type { FastifyInstance } from 'fastify';
import type { Connections } from '../connections.js';
import { Authority } from './authority.js';
import { buildRemote } from './http.js';
import type { OAuthConfig } from './config.js';
export function attachOAuth(
  app: FastifyInstance,
  connections: Connections,
  config: (OAuthConfig & { port: number }) | undefined,
  localPort: number,
): Authority | undefined {
  if (!config) return undefined;
  if (
    !Number.isInteger(config.port) ||
    config.port < 1024 ||
    config.port > 65535 ||
    config.port === localPort
  )
    throw new Error('Invalid separate OAuth port');
  const authority = new Authority(config, {
    offer: (consent) => connections.offerConsent(consent),
    dismiss: (requestId) => {
      connections.dismissConsent(requestId);
    },
    active: (browserId) => connections.ownsBrowser(browserId),
  });
  const remote = buildRemote(authority, () => ({
    browsers: connections.browsers(),
  }));
  app.addHook('onReady', async () => {
    await remote.listen({ host: '127.0.0.1', port: config.port });
  });
  app.addHook('preClose', async () => {
    await remote.close();
  });
  return authority;
}
