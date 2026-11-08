import { AutoPairing } from './auto-pairing.js';
import type { ReleaseChannel } from '../../../packages/protocol/environment.js';
import type { Consent } from './oauth/authority.js';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { parseMessage } from './messages.js';
import type { BrowserMetadata, Tab } from './messages.js';
import type { BrowserStore } from './store.js';

export interface Peer {
  send(data: string): void;
  close(): void;
}
interface Session {
  peer: Peer;
  origin: string;
  deadline: number;
  browserId?: string;
  connectionId: string;
  pendingId?: string;
}
interface Pairing {
  id: string;
  name: string;
  code: string;
  expiresAt: number;
  origin: string;
  profileId: string;
  session: Session;
}
export class Connections {
  private readonly automatic: AutoPairing<Session>;
  private readonly sessions = new Set<Session>();
  private readonly pending = new Map<string, Pairing>();
  private readonly active = new Map<
    string,
    { session: Session; tabs: Tab[]; metadata?: BrowserMetadata }
  >();
  constructor(
    private readonly store: BrowserStore,
    private readonly now: () => number = Date.now,
    private readonly decide?: (
      sessionId: string,
      browserId: string,
      decision: { requestId: string; nonce: string; approved: boolean },
    ) => void,
    private readonly channel?: ReleaseChannel,
  ) {
    this.automatic = new AutoPairing(now);
  }

  attach(
    peer: Peer,
    origin: string,
  ): { receive: (raw: string) => void; disconnect: () => void } {
    const session: Session = {
      peer,
      origin,
      deadline: this.now() + 5_000,
      connectionId: randomUUID(),
    };
    this.sessions.add(session);
    if (this.sessions.size > 84) this.fail(session, 'busy');
    return {
      receive: (raw) => {
        this.receive(session, raw);
      },
      disconnect: () => {
        this.disconnect(session);
      },
    };
  }
  offerConsent(consent: Consent): string[] {
    const recipients: string[] = [];
    for (const { session } of this.active.values()) {
      if (this.send(session, { type: 'oauth-request', ...consent }))
        recipients.push(session.connectionId);
    }
    return recipients;
  }
  dismissConsent(requestId: string): void {
    for (const { session } of this.active.values())
      this.send(session, { type: 'oauth-close', requestId });
  }
  ownsBrowser(browserId: string): boolean {
    return this.store.list().some((item) => item.id === browserId);
  }
  pairings() {
    this.sweep();
    return [...this.pending.values()].map(
      ({ id, name, code, expiresAt, origin }) => ({
        id,
        name,
        code,
        expiresAt,
        origin,
      }),
    );
  }
  browsers() {
    return this.store.list().map(({ id, name }) => {
      const live = this.active.get(id);
      return {
        id,
        name,
        connected: Boolean(live),
        connectionId: live?.session.connectionId ?? null,
        tabs: live?.tabs ?? [],
        metadata: live?.metadata ?? null,
      };
    });
  }
  issueConnectionTicket(challenge: string) {
    this.sweep();
    return this.automatic.issue(challenge);
  }
  approve(id: string): boolean {
    this.sweep();
    const pairing = this.pending.get(id);
    if (!pairing) return false;
    this.pending.delete(id);
    delete pairing.session.pendingId;
    return this.completePairing(pairing.session, pairing);
  }
  private completePairing(
    session: Session,
    identity: { name: string; profileId: string },
    local = false,
  ): boolean {
    const token = randomBytes(32).toString('hex');
    const item = local
      ? this.store.connectLocal({ ...identity, origin: session.origin }, token)
      : this.store.add({ ...identity, origin: session.origin }, token);
    const delivered = this.send(session, {
      type: 'paired',
      browserId: item.id,
      token,
      connectionId: session.connectionId,
    });
    if (!delivered) {
      if (!local) this.store.remove(item.id);
      return false;
    }
    this.activate(session, item.id);
    return true;
  }
  reject(id: string): boolean {
    const pairing = this.pending.get(id);
    if (!pairing) return false;
    this.fail(pairing.session, 'rejected');
    return true;
  }
  revoke(id: string): boolean {
    const existed = this.store.remove(id);
    const live = this.active.get(id);
    if (live) this.fail(live.session, 'revoked');
    return existed;
  }
  sweep(): void {
    for (const session of this.sessions) {
      if (session.deadline <= this.now()) this.fail(session, 'timeout');
    }
  }
  close(): void {
    for (const session of this.sessions) {
      this.disconnect(session);
      session.peer.close();
    }
  }
  private send(session: Session, value: Record<string, unknown>): boolean {
    try {
      session.peer.send(
        JSON.stringify({ v: 1, channel: this.channel, ...value }),
      );
      return true;
    } catch {
      this.disconnect(session);
      session.peer.close();
      return false;
    }
  }
  private disconnect(session: Session): void {
    this.sessions.delete(session);
    this.automatic.remove(session);
    if (session.pendingId) this.pending.delete(session.pendingId);
    if (
      session.browserId &&
      this.active.get(session.browserId)?.session === session
    )
      this.active.delete(session.browserId);
  }
  private fail(session: Session, code: string): void {
    this.send(session, {
      type: 'error',
      code,
      message: 'Connection not available',
    });
    this.disconnect(session);
    session.peer.close();
  }
  private activate(session: Session, browserId: string): void {
    const previous = this.active.get(browserId);
    if (previous) this.fail(previous.session, 'replaced');
    session.browserId = browserId;
    session.deadline = this.now() + 60_000;
    this.active.set(browserId, { session, tabs: [] });
    this.send(session, {
      type: 'ready',
      metadataSupported: true,
      browserId,
      connectionId: session.connectionId,
    });
  }
  private requestPairing(
    session: Session,
    identity: { profileId: string; name: string },
  ): void {
    if (
      this.pending.size + this.automatic.size >= 20 ||
      this.store.list().length >= 64
    ) {
      this.fail(session, 'busy');
      return;
    }
    const id = randomUUID();
    const pairing: Pairing = {
      ...identity,
      id,
      code: randomInt(0, 1_000_000).toString().padStart(6, '0'),
      expiresAt: this.now() + 120_000,
      origin: session.origin,
      session,
    };
    session.pendingId = id;
    session.deadline = pairing.expiresAt;
    this.pending.set(id, pairing);
    this.send(session, {
      type: 'pairing',
      requestId: id,
      code: pairing.code,
      expiresAt: pairing.expiresAt,
    });
  }
  private receive(session: Session, raw: string): void {
    if (!this.sessions.has(session)) return;
    if (session.deadline <= this.now()) {
      this.fail(session, 'timeout');
      return;
    }
    try {
      const message = parseMessage(raw);
      if (!this.acceptsChannel(message)) {
        this.fail(session, 'channel-mismatch');
        return;
      }
      if (session.browserId) {
        this.receiveAuthenticated(session, message);
      } else if (this.receiveAutomatic(session, message)) {
        return;
      } else if (session.pendingId) {
        this.fail(session, 'pending');
      } else if (message.type === 'local-connect') {
        this.completePairing(session, message, true);
      } else if (message.type === 'pair') {
        this.requestPairing(session, message);
      } else if (message.type === 'authenticate') {
        const item = this.store.authenticate(
          message.browserId,
          session.origin,
          message.token,
        );
        if (item) this.activate(session, item.id);
        else this.fail(session, 'unauthorized');
      } else this.fail(session, 'unauthorized');
    } catch {
      this.fail(session, 'invalid');
    }
  }
  private acceptsChannel(message: ReturnType<typeof parseMessage>): boolean {
    if (
      !['pair', 'local-connect', 'auto-probe', 'authenticate'].includes(
        message.type,
      )
    )
      return true;
    return this.channel
      ? 'channel' in message && message.channel === this.channel
      : message.type !== 'local-connect';
  }
  private receiveAutomatic(
    session: Session,
    message: ReturnType<typeof parseMessage>,
  ): boolean {
    if (this.automatic.has(session)) {
      const identity =
        message.type === 'auto-redeem'
          ? this.automatic.redeem(session, message.ticket)
          : undefined;
      if (identity) this.completePairing(session, identity);
      else this.fail(session, 'unauthorized');
      return true;
    }
    if (message.type !== 'auto-probe' || session.pendingId) return false;
    if (
      this.pending.size + this.automatic.size >= 20 ||
      this.store.list().length >= 64
    ) {
      this.fail(session, 'busy');
      return true;
    }
    const challenge = this.automatic.probe(session, message);
    session.deadline = challenge.expiresAt;
    this.send(session, { type: 'auto-challenge', ...challenge });
    return true;
  }
  private receiveAuthenticated(
    session: Session,
    message: ReturnType<typeof parseMessage>,
  ): void {
    const live = this.active.get(session.browserId ?? '');
    if (!live || live.session !== session) {
      this.fail(session, 'replaced');
      return;
    }
    session.deadline = this.now() + 60_000;
    if (message.type === 'ping') this.send(session, { type: 'pong' });
    else if (message.type === 'metadata') live.metadata = message.metadata;
    else if (message.type === 'tabs') live.tabs = message.tabs;
    else if (message.type === 'oauth-decision')
      this.decide?.(session.connectionId, session.browserId ?? '', message);
    else this.fail(session, 'invalid');
  }
}
