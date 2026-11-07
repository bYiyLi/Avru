import type { Connection } from './connection';
import { record } from './protocol';
export interface ExternalSender {
  id?: string;
  url?: string;
  origin?: string;
  frameId?: number;
  documentId?: string;
  tab?: { id?: number | undefined; incognito?: boolean };
}
/** Browser-scoped transport. The management capability stays in the web page. */
export class ExternalConnection {
  private pending:
    | {
        document: string;
        tab: number;
        challenge: string;
        expires: number;
      }
    | undefined;
  private busy = false;
  constructor(
    private readonly connection: Connection,
    private readonly endpoint: string,
    private readonly version: string,
    private readonly now = Date.now,
  ) {}
  trusted(sender: ExternalSender): boolean {
    return (
      sender.id === undefined &&
      sender.origin === this.endpoint &&
      sender.url === `${this.endpoint}/` &&
      sender.frameId === 0 &&
      typeof sender.documentId === 'string' &&
      typeof sender.tab?.id === 'number' &&
      sender.tab.incognito === false
    );
  }
  async message(raw: unknown, sender: ExternalSender): Promise<unknown> {
    if (!this.trusted(sender)) throw new Error('Untrusted sender');
    const message = record(raw);
    if (message?.type === 'avru-detect')
      return { version: this.version, ...this.connection.inspect() };
    if (message?.type === 'avru-probe') return this.probe(sender);
    if (message?.type !== 'avru-redeem' || typeof message.ticket !== 'string')
      throw new Error('Unsupported request');
    const pending = this.pending;
    this.pending = undefined;
    if (
      !pending ||
      pending.expires <= this.now() ||
      pending.document !== sender.documentId ||
      pending.tab !== sender.tab?.id ||
      pending.challenge !== message.challenge
    )
      throw new Error('Expired request');
    this.connection.redeem(message.ticket);
    return { accepted: true };
  }
  private async probe(sender: ExternalSender) {
    if (this.busy) throw new Error('Connection busy');
    this.busy = true;
    this.pending = undefined;
    try {
      const challenge = await this.connection.probe({
        endpoint: this.endpoint,
        name: 'Browser',
      });
      // trusted() proved these values before the asynchronous operation.
      this.pending = {
        document: sender.documentId ?? '',
        tab: sender.tab?.id ?? -1,
        challenge,
        expires: this.now() + 20000,
      };
      return { challenge };
    } finally {
      this.busy = false;
    }
  }
}
