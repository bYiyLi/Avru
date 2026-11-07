import { randomBytes } from 'node:crypto';
interface Identity {
  profileId: string;
  name: string;
}
interface Pending extends Identity {
  challenge: string;
  expiresAt: number;
  ticket?: string;
}
/** Entries are bound to object identity of the original live WS session. */
export class AutoPairing<Session> {
  private readonly pending = new Map<Session, Pending>();
  constructor(private readonly now: () => number) {}
  get size(): number {
    return this.pending.size;
  }
  has(session: Session): boolean {
    return this.pending.has(session);
  }
  remove(session: Session): void {
    this.pending.delete(session);
  }
  probe(session: Session, identity: Identity) {
    const entry = {
      ...identity,
      challenge: randomBytes(32).toString('hex'),
      expiresAt: this.now() + 30_000,
    };
    this.pending.set(session, entry);
    return { challenge: entry.challenge, expiresAt: entry.expiresAt };
  }
  issue(challenge: string) {
    for (const entry of this.pending.values()) {
      if (entry.challenge !== challenge || entry.expiresAt <= this.now())
        continue;
      // A retry replaces, never extends, the previous short-lived ticket.
      entry.ticket = randomBytes(32).toString('hex');
      return { ticket: entry.ticket, expiresAt: entry.expiresAt };
    }
    return undefined;
  }
  redeem(session: Session, ticket: string): Identity | undefined {
    const entry = this.pending.get(session);
    this.pending.delete(session);
    if (!entry || entry.expiresAt <= this.now() || entry.ticket !== ticket)
      return undefined;
    return { name: entry.name, profileId: entry.profileId };
  }
}
