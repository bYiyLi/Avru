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
export interface Ports {
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
  private socket: Socket | undefined;
  private saved: Credentials | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private attempt = 0;
  private ready = false;
  private generation = 0;
  private snapshotSequence = 0;
  private state = '未配对';
  private blocked = false;
  private pendingPong = false;
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly ports: Ports) {}
  status(): string {
    return this.state;
  }
  async start(): Promise<void> {
    const generation = this.generation;
    const value = await this.ports.read();
    if (generation !== this.generation) return;
    this.saved = credentials(value);
    this.reconnect();
  }
  reconnect(): void {
    if (!this.blocked && !this.socket && this.saved?.token)
      this.connect(this.saved.endpoint, {
        v: 1,
        type: 'authenticate',
        browserId: this.saved.browserId,
        token: this.saved.token,
      });
  }
  async pair(input: PairInput): Promise<void> {
    const valid = validatePair(input);
    const clearing = this.disconnect();
    const generation = this.generation;
    await clearing;
    if (generation !== this.generation) return;
    this.blocked = false;
    const profileId = this.ports.uuid();
    this.saved = {
      endpoint: valid.endpoint,
      name: valid.name,
      profileId,
      browserId: '',
      token: '',
    };
    this.connect(valid.endpoint, {
      v: 1,
      type: 'pair',
      profileId,
      name: valid.name,
    });
  }
  async disconnect(): Promise<void> {
    this.saved = undefined;
    this.stop();
    this.state = '未配对';
    await this.write(() => this.ports.clear());
  }
  async publish(): Promise<void> {
    const generation = this.generation;
    if (!this.ready) return;
    const sequence = ++this.snapshotSequence;
    const tabs = snapshot(await this.ports.tabs());
    if (generation === this.generation && sequence === this.snapshotSequence)
      this.send({ v: 1, type: 'tabs', tabs });
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
    this.generation++;
    this.ready = false;
    this.pendingPong = false;
    if (this.timer) this.ports.cancel(this.timer);
    this.timer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
  }
  private connect(endpoint: string, first: unknown): void {
    this.stop();
    this.state = '连接中';
    const generation = this.generation;
    const socket = this.ports.socket(socketUrl(endpoint));
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
    if (message.type === 'error') {
      await this.reject(message.code);
      return;
    }
    if (
      message.type === 'pairing' &&
      typeof message.code === 'string' &&
      /^\d{6}$/.test(message.code)
    ) {
      this.state = `请在本机管理页核对 ${message.code} 并批准`;
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
    this.state = '已连接';
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
    this.state = '连接被拒绝或配对已过期，请重新配对';
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
    this.state = '已断开，等待重连';
    if (!this.saved?.token) return;
    const delay = Math.min(1000 * 2 ** this.attempt++, 30000);
    this.timer = this.ports.later(() => {
      this.reconnect();
    }, delay);
  }
  private fail(): void {
    this.stop();
    this.blocked = true;
    this.state = '协议错误，请重新配对';
  }
}
