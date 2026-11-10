/** The Chrome debugger API is the transport for the full CDP method space.
 * No CDP domain or method allowlist is applied here.
 */
export interface CdpTarget {
  tabId: number;
}
type EventListener = (
  source: CdpTarget,
  method: string,
  params?: Record<string, unknown>,
) => void;
type DetachListener = (source: CdpTarget, reason: string) => void;
export interface CdpApi {
  attach(target: CdpTarget, protocolVersion: string): Promise<void>;
  sendCommand(
    target: CdpTarget,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown>;
  detach(target: CdpTarget): Promise<void>;
  onEvent: {
    addListener(listener: EventListener): void;
    removeListener(listener: EventListener): void;
  };
  onDetach: {
    addListener(listener: DetachListener): void;
    removeListener(listener: DetachListener): void;
  };
}
interface RecordedEvent {
  sequence: number;
  method: string;
  params?: Record<string, unknown>;
}
const MAX_EVENTS = 200;

export class CdpController {
  private readonly attached = new Set<number>();
  private readonly interrupted = new Set<number>();
  private readonly attaching = new Map<number, Promise<void>>();
  private readonly history = new Map<number, RecordedEvent[]>();
  private readonly sequence = new Map<number, number>();
  private closed = false;
  private readonly onEvent: EventListener = (source, method, params) => {
    if (this.closed || !this.attached.has(source.tabId)) return;
    const next = (this.sequence.get(source.tabId) ?? 0) + 1;
    this.sequence.set(source.tabId, next);
    const events = this.history.get(source.tabId) ?? [];
    const entry: RecordedEvent = { sequence: next, method };
    if (params !== undefined) entry.params = params;
    events.push(entry);
    if (events.length > MAX_EVENTS) events.shift();
    this.history.set(source.tabId, events);
  };
  private readonly onDetach: DetachListener = (source, reason) => {
    const attached = this.attached.has(source.tabId);
    this.attached.delete(source.tabId);
    this.history.delete(source.tabId);
    this.sequence.delete(source.tabId);
    if (!this.closed && attached && reason === 'canceled_by_user') {
      this.interrupted.add(source.tabId);
      this.onUserCancel?.(source.tabId);
    }
  };

  constructor(
    private readonly api: CdpApi,
    private readonly onUserCancel?: (tabId: number) => void,
  ) {
    api.onEvent.addListener(this.onEvent);
    api.onDetach.addListener(this.onDetach);
  }
  private check(tabId: number): void {
    if (this.closed || this.interrupted.has(tabId))
      throw new Error('CDP_DISCONNECTED');
    if (!Number.isSafeInteger(tabId) || tabId < 0)
      throw new Error('INVALID_TARGET');
  }
  /** A new daemon execution is the only way to resume a user-cancelled tab. */
  resume(tabId: number): void {
    if (this.closed) throw new Error('CDP_DISCONNECTED');
    if (!Number.isSafeInteger(tabId) || tabId < 0)
      throw new Error('INVALID_TARGET');
    this.interrupted.delete(tabId);
  }
  private async ensure(tabId: number): Promise<void> {
    if (this.attached.has(tabId)) return;
    let attaching = this.attaching.get(tabId);
    if (!attaching) {
      attaching = this.api.attach({ tabId }, '1.3').then(async () => {
        if (this.closed) {
          await this.api.detach({ tabId }).catch(() => {
            // Shutdown wins over an attach that completed after close().
          });
          throw new Error('CDP_DISCONNECTED');
        }
        this.attached.add(tabId);
      });
      this.attaching.set(tabId, attaching);
      void attaching
        .finally(() => {
          this.attaching.delete(tabId);
        })
        .catch(() => {
          /* Failed attach is returned to its caller; a later attempt may retry. */
        });
    }
    await attaching;
  }
  async send(
    tabId: number,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    this.check(tabId);
    if (typeof method !== 'string' || !/^[A-Za-z][\w.]{0,127}$/u.test(method))
      throw new Error('INVALID_ARGUMENT');
    if (params !== undefined && Array.isArray(params))
      throw new Error('INVALID_ARGUMENT');
    await this.ensure(tabId);
    return this.api.sendCommand({ tabId }, method, params);
  }
  async cursor(tabId: number): Promise<string> {
    this.check(tabId);
    await this.ensure(tabId);
    return String(this.sequence.get(tabId) ?? 0);
  }
  async events(tabId: number, cursor?: string) {
    this.check(tabId);
    if (cursor !== undefined && !/^(0|[1-9]\d*)$/u.test(cursor))
      throw new Error('INVALID_ARGUMENT');
    await this.ensure(tabId);
    const entries = this.history.get(tabId) ?? [];
    const first = entries[0];
    // An omitted cursor starts at the oldest still-buffered event. An
    // explicitly supplied cursor remains strict and detects lost history.
    const after =
      cursor === undefined
        ? (first?.sequence ?? (this.sequence.get(tabId) ?? 0) + 1) - 1
        : Number(cursor);
    if (!Number.isSafeInteger(after)) throw new Error('INVALID_ARGUMENT');
    if (cursor !== undefined && first && after < first.sequence - 1)
      throw new Error('STALE_REF');
    const newest = this.sequence.get(tabId) ?? 0;
    if (after > newest) throw new Error('INVALID_ARGUMENT');
    return {
      events: entries.filter((event) => event.sequence > after),
      nextCursor: String(newest),
    };
  }
  async detach(tabId: number): Promise<void> {
    this.check(tabId);
    const pending = this.attaching.get(tabId);
    if (pending) await pending;
    if (!this.attached.delete(tabId)) return;
    this.history.delete(tabId);
    this.sequence.delete(tabId);
    await this.api.detach({ tabId });
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.api.onEvent.removeListener(this.onEvent);
    this.api.onDetach.removeListener(this.onDetach);
    for (const tabId of this.attached) {
      void this.api.detach({ tabId }).catch(() => {
        /* Closing a browser cannot prevent local teardown. */
      });
    }
    this.attached.clear();
    this.attaching.clear();
    this.history.clear();
    this.sequence.clear();
    this.interrupted.clear();
  }
}
