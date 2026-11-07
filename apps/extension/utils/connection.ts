import { AutoChallenge } from './auto-challenge';
import type { ConnectionStatus } from './connection-status';
import type { ReleaseChannel } from '../../../packages/protocol/environment.js';
import { consentRequest } from './oauth-consent';
import type { ConsentRequest } from './oauth-consent';
import {
  credentials,
  record,
  snapshot,
  socketUrl,
  validatePair,
} from './protocol';
import type { Credentials, PairInput, Tab } from './protocol';
export interface Socket {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send: (data: string) => void;
  close(): void;
}
import type { Metadata } from './metadata';
export interface Ports {
  channel?: ReleaseChannel;
  readBlocked?: () => Promise<boolean>;
  saveBlocked?: (blocked: boolean) => Promise<void>;
  onOAuthRequest?: (request: ConsentRequest) => Promise<void>;
  onOAuthClose?: (requestId: string) => void;
  resetOAuth?: () => void;
  metadata?: () => Promise<Metadata>;
  read: () => Promise<unknown>;
  save: (value: Credentials) => Promise<void>;
  clear: () => Promise<void>;
  tabs: () => Promise<Tab[]>;
  socket(url: string): Socket;
  uuid(): string;
  later(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  cancel(timer: ReturnType<typeof setTimeout>): void;
}
export class Connection {
  private readonly challenge = new AutoChallenge();
  private socket: Socket | undefined;
  private saved: Credentials | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private attempt = 0;
  private ready = false;
  private generation = 0;
  private snapshotSequence = 0;
  private state: ConnectionStatus = { code: 'unpaired' };
  private blocked = false;
  private pendingPong = false;
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly ports: Ports) {}
  status(): ConnectionStatus {
    return this.state;
  }
  async start(): Promise<void> {
    const generation = this.generation;
    const value = await this.ports.read();
    const blocked = await this.ports.readBlocked?.();
    if (generation !== this.generation) return;
    this.blocked = blocked === true;
    this.saved = credentials(value, this.ports.channel);
    this.reconnect();
  }
  reconnect(): void {
    if (!this.blocked && !this.socket && this.saved?.token)
      this.connect(this.saved.endpoint, {
        v: 1,
        type: 'authenticate',
        ...(this.ports.channel ? { channel: this.ports.channel } : {}),
        browserId: this.saved.browserId,
        token: this.saved.token,
      });
  }
  inspect() {
    return {
      status: this.state.code,
      autoAllowed: !this.blocked && !this.saved?.token,
      browserId: this.ready ? this.saved?.browserId : undefined,
    };
  }
  async probe(input: PairInput): Promise<string> {
    if (this.blocked || this.saved?.token)
      throw new Error('Automatic connection unavailable');
    await this.prepare(input);
    this.connect(input.endpoint, {
      v: 1,
      type: 'auto-probe',
      channel: this.ports.channel,
      profileId: this.saved?.profileId,
      name: this.saved?.name,
    });
    const generation = this.generation;
    try {
      return await this.challenge.wait();
    } catch (error) {
      if (generation === this.generation) this.fail();
      throw error;
    }
  }
  redeem(ticket: string): void {
    if (
      !this.socket ||
      this.ready ||
      this.blocked ||
      !/^[a-f0-9]{64}$/.test(ticket)
    )
      throw new Error('Invalid ticket');
    try {
      this.socket.send(JSON.stringify({ v: 1, type: 'auto-redeem', ticket }));
    } catch {
      this.fail();
      throw new Error('Connection unavailable');
    }
  }
  async pair(input: PairInput): Promise<void> {
    await this.prepare(input);
    this.connect(input.endpoint, {
      v: 1,
      type: 'pair',
      ...(this.ports.channel ? { channel: this.ports.channel } : {}),
      profileId: this.saved?.profileId,
      name: this.saved?.name,
    });
  }
  private async prepare(input: PairInput): Promise<void> {
    const valid = validatePair(input, this.ports.channel);
    const clearing = this.disconnect(false);
    const generation = this.generation;
    await clearing;
    if (generation !== this.generation)
      throw new Error('Connection superseded');
    this.blocked = false;
    const profileId = this.ports.uuid();
    this.saved = {
      ...(this.ports.channel ? { channel: this.ports.channel } : {}),
      endpoint: valid.endpoint,
      name: valid.name,
      profileId,
      browserId: '',
      token: '',
    };
  }
  async disconnect(block = true): Promise<void> {
    this.blocked = block;
    this.saved = undefined;
    this.stop();
    this.state = { code: 'unpaired' };
    await this.write(async () => {
      await this.ports.saveBlocked?.(block);
      await this.ports.clear();
    });
  }
  async publish(): Promise<void> {
    const generation = this.generation;
    if (!this.ready) return;
    const sequence = ++this.snapshotSequence;
    const tabs = snapshot(await this.ports.tabs());
    if (generation === this.generation && sequence === this.snapshotSequence)
      this.send({ v: 1, type: 'tabs', tabs });
  }
  decideOAuth(request: ConsentRequest, approved: boolean): void {
    if (this.ready)
      this.send({
        v: 1,
        type: 'oauth-decision',
        requestId: request.requestId,
        nonce: request.nonce,
        approved,
      });
  }
  private write(operation: () => Promise<void>): Promise<void> {
    this.writes = this.writes.then(operation, operation);
    return this.writes;
  }
  private send(data: unknown): void {
    try {
      this.socket?.send(JSON.stringify(data));
    } catch {
      this.retry();
    }
  }
  private stop(): void {
    this.challenge.cancel();
    this.generation++;
    this.ready = false;
    this.ports.resetOAuth?.();
    this.pendingPong = false;
    if (this.timer) this.ports.cancel(this.timer);
    this.timer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
  }
  private connect(endpoint: string, first: unknown): void {
    this.stop();
    this.state = { code: 'connecting' };
    const generation = this.generation;
    const socket = this.ports.socket(socketUrl(endpoint, this.ports.channel));
    this.socket = socket;
    socket.onopen = () => {
      if (generation === this.generation) this.send(first);
    };
    let messages = Promise.resolve();
    socket.onmessage = (event) => {
      messages = messages
        .then(async () => {
          if (generation === this.generation)
            await this.receive(event.data, generation);
        })
        .catch(() => {
          if (generation === this.generation) this.fail();
        });
    };
    socket.onclose = () => {
      if (generation === this.generation) this.retry();
    };
    socket.onerror = () => {
      if (generation === this.generation) this.retry();
    };
  }
  private async receive(raw: unknown, generation: number): Promise<void> {
    if (typeof raw !== 'string' || raw.length > 8192) {
      this.fail();
      return;
    }
    const message = record(JSON.parse(raw));
    if (message?.v !== 1) {
      this.fail();
      return;
    }
    if (
      this.ports.channel &&
      ['pairing', 'paired', 'ready', 'auto-challenge'].includes(
        String(message.type),
      ) &&
      message.channel !== this.ports.channel
    ) {
      this.fail();
      return;
    }
    if (message.type === 'auto-challenge') {
      this.challenge.accept(message.challenge);
      return;
    }
    if (await this.receiveOAuth(message)) return;
    if (message.type === 'error') {
      await this.reject(message.code);
      return;
    }
    if (
      message.type === 'pairing' &&
      typeof message.code === 'string' &&
      /^\d{6}$/.test(message.code)
    ) {
      this.state = { code: 'pairing', pairingCode: message.code };
    }
    if (message.type === 'paired') {
      if (
        !this.saved ||
        typeof message.browserId !== 'string' ||
        typeof message.token !== 'string'
      ) {
        this.fail();
        return;
      }
      this.saved = {
        ...this.saved,
        browserId: message.browserId,
        token: message.token,
      };
      const saved = this.saved;
      await this.write(async () => {
        if (generation === this.generation) await this.ports.save(saved);
      });
    }
    if (message.type === 'pong') this.pendingPong = false;
    if (message.type === 'ready') await this.acceptReady(message, generation);
  }
  private async receiveOAuth(
    message: Record<string, unknown>,
  ): Promise<boolean> {
    if (message.type === 'oauth-request') {
      if (!this.ready) throw new Error('Unauthenticated consent');
      await this.ports.onOAuthRequest?.(consentRequest(message));
      return true;
    }
    if (message.type === 'oauth-close') {
      if (!this.ready || typeof message.requestId !== 'string')
        throw new Error('Invalid consent close');
      this.ports.onOAuthClose?.(message.requestId);
      return true;
    }
    return false;
  }
  private async acceptReady(
    message: Record<string, unknown>,
    generation: number,
  ): Promise<void> {
    if (
      !this.saved?.token ||
      message.browserId !== this.saved.browserId ||
      typeof message.connectionId !== 'string' ||
      !message.connectionId
    ) {
      this.fail();
      return;
    }
    if (this.timer) this.ports.cancel(this.timer);
    this.ready = true;
    this.attempt = 0;
    this.state = { code: 'connected' };
    if (message.metadataSupported === true && this.ports.metadata) {
      const metadata = await this.ports.metadata();
      if (generation !== this.generation) return;
      this.send({ v: 1, type: 'metadata', metadata });
    }
    await this.publish();
    if (generation === this.generation) this.heartbeat();
  }
  private async reject(code: unknown): Promise<void> {
    if (this.saved?.token && (code === 'timeout' || code === 'busy')) {
      this.retry();
      return;
    }
    if (code === 'revoked' || code === 'unauthorized') {
      const clearing = this.disconnect();
      const stopped = this.generation;
      await clearing;
      if (stopped !== this.generation) return;
    } else this.stop();
    this.blocked = true;
    this.state = { code: 'rejected' };
  }
  private heartbeat(): void {
    this.timer = this.ports.later(() => {
      if (this.ready) {
        if (this.pendingPong) {
          this.retry();
          return;
        }
        this.pendingPong = true;
        this.send({ v: 1, type: 'ping' });
        this.heartbeat();
      }
    }, 20000);
  }
  private retry(): void {
    this.stop();
    this.state = { code: 'reconnecting' };
    if (!this.saved?.token) return;
    const delay = Math.min(1000 * 2 ** this.attempt++, 30000);
    this.timer = this.ports.later(() => {
      this.reconnect();
    }, delay);
  }
  private fail(): void {
    this.stop();
    this.blocked = true;
    this.state = { code: 'protocolError' };
  }
}
