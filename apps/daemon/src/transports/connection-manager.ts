import { join } from 'node:path';
import { FRPC_VERSION } from '../../../../packages/protocol/frpc-assets.js';
import type {
  ConnectionStatus,
  ConnectionState,
  ConnectionEventCode,
} from '../../../../packages/protocol/connection.d.ts';
import type { ReleaseChannel } from '../../../../packages/protocol/environment.js';
import type { OAuthListener } from '../oauth/integration.js';
import type { ConnectionBundle } from './connection-bundle.js';
import { parseBundle } from './connection-bundle.js';
import { ConnectionEvents } from './connection-events.js';
import { FrpcProcess } from './frpc-process.js';
import type { ConnectionDriver } from './frpc-process.js';
import { verifiedProgram } from './frpc-program.js';
import {
  ownedDirectory,
  readPrivate,
  writePrivate,
  removePrivate,
} from './private-files.js';
export interface ConnectionOptions {
  dataRoot: string;
  payloadRoot: string;
  channel: ReleaseChannel;
  localPort: number;
  databasePath?: string;
  external: boolean;
  remote: Pick<OAuthListener, 'configure' | 'close'>;
  driver?: ConnectionDriver;
}
export class ConnectionManager {
  private readonly events: ConnectionEvents;
  private driver: ConnectionDriver | undefined;
  private bundle: ConnectionBundle | undefined;
  private directory = '';
  private state: ConnectionState = 'unconfigured';
  private available = false;
  private busy = false;
  private closing = false;
  private closeResult: Promise<void> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private backoff = 1000;
  constructor(private readonly options: ConnectionOptions) {
    this.events = new ConnectionEvents(options.databasePath);
  }
  async initialize(): Promise<void> {
    this.directory = await ownedDirectory(this.options.dataRoot);
    this.driver =
      this.options.driver ??
      new FrpcProcess({
        directory: this.directory,
        payloadRoot: this.options.payloadRoot,
        localPort: this.options.localPort,
        channel: this.options.channel,
      });
    try {
      await verifiedProgram(this.options.payloadRoot);
      this.available = true;
    } catch {
      this.available = false;
    }
    try {
      const saved = await readPrivate(
        join(this.directory, 'configuration.json'),
      );
      if (saved) this.bundle = this.parse(JSON.parse(saved) as unknown);
      if (this.bundle && this.options.external) {
        await this.options.remote.close();
        this.report('unavailable', 'configuration_conflict');
      } else if (this.bundle) await this.activate();
      else await this.driver.stop();
    } catch (error) {
      await this.options.remote.close();
      this.failure(error);
    }
  }
  snapshot(): ConnectionStatus {
    return {
      state: this.state,
      configured: !!this.bundle,
      issuer: this.bundle?.oauth.issuer ?? null,
      mcpUrl: this.bundle ? `${this.bundle.oauth.issuer}/mcp` : null,
      programVersion: FRPC_VERSION,
      programAvailable: this.available,
      verification: { publicEntry: 'notVerified', chatgpt: 'notVerified' },
      ...this.events.snapshot(),
    };
  }
  async import(raw: unknown): Promise<void> {
    if (this.options.external) throw new Error('configuration_conflict');
    const candidate = this.parse(raw);
    await this.exclusive(async () => {
      this.state = 'applying';
      const previous = this.bundle;
      await this.stopConnection();
      try {
        await writePrivate(
          join(this.directory, 'configuration.json'),
          JSON.stringify(candidate),
        );
      } catch (error) {
        this.bundle = previous;
        if (previous) await this.activate();
        throw error;
      }
      this.bundle = candidate;
      this.events.record('configuration_imported');
      await this.activate();
    });
  }
  async clear(): Promise<void> {
    await this.exclusive(async () => {
      this.state = 'applying';
      await this.stopConnection();
      await removePrivate(join(this.directory, 'configuration.json'));
      this.bundle = undefined;
      this.report('unconfigured', 'configuration_removed');
    });
  }
  close(): Promise<void> {
    this.closeResult ??= this.shutdown();
    return this.closeResult;
  }
  private async shutdown(): Promise<void> {
    this.closing = true;
    clearTimeout(this.timer);
    while (this.busy)
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    try {
      await this.stopConnection();
    } catch (error) {
      this.failure(error);
      throw error;
    } finally {
      this.events.close();
    }
  }
  private parse(raw: unknown): ConnectionBundle {
    try {
      return parseBundle(raw, this.options.channel, this.options.localPort);
    } catch {
      this.events.record('configuration_invalid');
      throw new Error('configuration_invalid');
    }
  }
  private async exclusive(action: () => Promise<void>): Promise<void> {
    if (this.busy || this.closing || !this.driver)
      throw new Error('connection_busy');
    this.busy = true;
    clearTimeout(this.timer);
    try {
      await action();
    } catch (error) {
      this.failure(error);
      throw new Error('connection_apply_failed', { cause: error });
    } finally {
      this.busy = false;
    }
  }
  private async stopConnection(): Promise<void> {
    clearTimeout(this.timer);
    await this.options.remote.close();
    await this.driver?.stop();
  }
  private async activate(): Promise<void> {
    if (!this.bundle || !this.driver || this.closing) return;
    try {
      await this.options.remote.configure(this.bundle.oauth);
      await this.driver.start(this.bundle);
      this.report('connecting', 'process_started');
      this.schedule(1000);
    } catch (error) {
      await this.options.remote.close();
      this.failure(error);
      if (this.state !== 'unknown') this.schedule(this.nextBackoff(), true);
    }
  }
  private schedule(ms: number, restart = false): void {
    clearTimeout(this.timer);
    if (this.closing) return;
    this.timer = setTimeout(() => {
      this.exclusive(async () => {
        if (restart) await this.activate();
        else await this.poll();
      }).catch(() => {});
    }, ms);
    this.timer.unref();
  }
  private async poll(): Promise<void> {
    try {
      const registered = await this.driver?.registered();
      if (registered && this.state !== 'registered')
        this.report('registered', 'proxy_registered');
      else if (!registered) this.state = 'connecting';
      if (registered) this.backoff = 1000;
      this.schedule(2000);
    } catch {
      await this.stopConnection();
      this.report('unavailable', 'process_exited');
      this.schedule(this.nextBackoff(), true);
    }
  }
  private nextBackoff(): number {
    const delay = this.backoff;
    this.backoff = Math.min(30000, delay * 2);
    return delay;
  }
  private report(state: ConnectionState, code: ConnectionEventCode): void {
    this.state = state;
    this.events.record(code);
  }
  private failure(error: unknown): void {
    const unknown =
      error instanceof Error && error.message === 'ownership_unknown';
    this.report(
      unknown ? 'unknown' : 'unavailable',
      unknown ? 'ownership_unknown' : 'connection_unavailable',
    );
  }
}
