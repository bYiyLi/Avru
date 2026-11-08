import type { CallTraces } from '../call-traces.js';
import type { FastifyInstance } from 'fastify';
import type { Connections } from '../connections.js';
import { Authority } from './authority.js';
import { buildRemote } from './http.js';
import type { OAuthConfig } from './config.js';
export class OAuthListener {
  authority: Authority | undefined;
  private remote: ReturnType<typeof buildRemote> | undefined;
  private port = 0;
  constructor(
    private readonly connections: Connections,
    private readonly local: { port: number; traces?: CallTraces },
  ) {}
  prepare(config: OAuthConfig & { port: number }): Authority {
    if (
      !Number.isInteger(config.port) ||
      config.port < 1024 ||
      config.port > 65535 ||
      config.port === this.local.port
    )
      throw new Error('Invalid separate OAuth port');
    this.authority = new Authority(config, {
      offer: (consent) => this.connections.offerConsent(consent),
      dismiss: (id) => {
        this.connections.dismissConsent(id);
      },
      active: (id) => this.connections.ownsBrowser(id),
    });
    this.port = config.port;
    this.remote = buildRemote(
      this.authority,
      () => ({ browsers: this.connections.browsers() }),
      this.local.traces,
    );
    return this.authority;
  }
  async listen(): Promise<void> {
    const authority = this.authority;
    if (authority && this.remote) {
      await this.remote.listen({ host: '127.0.0.1', port: this.port });
    }
  }
  async configure(config: OAuthConfig & { port: number }): Promise<void> {
    await this.close();
    this.prepare(config);
    try {
      await this.listen();
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  async close(): Promise<void> {
    this.authority?.close();
    this.authority = undefined;
    const remote = this.remote;
    this.remote = undefined;
    await remote?.close();
  }
}
export function attachOAuth(
  app: FastifyInstance,
  connections: Connections,
  config: (OAuthConfig & { port: number }) | undefined,
  local: number | { port: number; traces: CallTraces },
): Authority | undefined {
  if (!config) return undefined;
  const listener = new OAuthListener(
    connections,
    typeof local === 'number' ? { port: local } : local,
  );
  const authority = listener.prepare(config);
  app.addHook('onReady', async () => {
    await listener.listen();
  });
  app.addHook('preClose', async () => {
    await listener.close();
  });
  return authority;
}
