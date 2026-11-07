import { record } from './protocol';

export interface ConsentRequest {
  requestId: string;
  nonce: string;
  clientName: string;
  redirectUri: string;
  resource: string;
  scope: 'browser:read';
  expiresAt: number;
}
export function consentRequest(
  value: unknown,
  now = Date.now(),
): ConsentRequest {
  const data = record(value);
  if (
    !data ||
    !['requestId', 'nonce', 'clientName', 'redirectUri', 'resource'].every(
      (key) =>
        typeof data[key] === 'string' &&
        data[key].length > 0 &&
        data[key].length <= 2048,
    ) ||
    data.scope !== 'browser:read' ||
    typeof data.expiresAt !== 'number' ||
    !Number.isFinite(data.expiresAt) ||
    data.expiresAt <= now ||
    data.expiresAt > now + 180_000
  )
    throw new Error('Invalid consent request');
  for (const key of ['redirectUri', 'resource']) {
    const url = new URL(data[key] as string);
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new Error('Invalid consent URL');
  }
  return data as unknown as ConsentRequest;
}
interface ConsentPorts {
  open(): Promise<number>;
  close(id: number): Promise<void>;
  decide(request: ConsentRequest, approved: boolean): void;
  now(): number;
}
export class ConsentController {
  private pending: { request: ConsentRequest; windowId?: number } | undefined;
  private opening: Promise<number> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly ports: ConsentPorts) {}
  async show(request: ConsentRequest): Promise<void> {
    this.reset();
    const pending = { request } as {
      request: ConsentRequest;
      windowId?: number;
    };
    this.pending = pending;
    this.timer = setTimeout(
      () => {
        this.decide(false);
      },
      Math.max(0, request.expiresAt - this.ports.now()),
    );
    try {
      this.opening = this.ports.open();
      const id = await this.opening;
      if (this.pending === pending) pending.windowId = id;
      else await this.ports.close(id);
    } catch {
      if (this.pending === pending) this.decide(false);
    }
  }
  async message(raw: unknown, windowId: number | undefined): Promise<unknown> {
    await this.opening?.catch(() => undefined);
    const pending = this.pending;
    if (!pending || windowId === undefined || windowId !== pending.windowId)
      return null;
    if (pending.request.expiresAt <= this.ports.now()) {
      this.decide(false);
      return null;
    }
    const message = record(raw);
    if (message?.type === 'oauth-consent-read') {
      return {
        requestId: pending.request.requestId,
        clientName: pending.request.clientName,
        redirectUri: pending.request.redirectUri,
        resource: pending.request.resource,
        scope: pending.request.scope,
        expiresAt: pending.request.expiresAt,
      };
    }
    if (
      message?.type === 'oauth-consent-decide' &&
      message.requestId === pending.request.requestId &&
      typeof message.approved === 'boolean'
    ) {
      this.decide(message.approved);
      return { accepted: true };
    }
    return null;
  }
  removed(id: number): void {
    if (this.pending?.windowId === id) this.decide(false);
  }
  close(requestId: string): void {
    if (this.pending?.request.requestId === requestId) this.reset();
  }
  reset(): void {
    const pending = this.pending;
    this.pending = undefined;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (pending?.windowId !== undefined)
      this.ports.close(pending.windowId).catch(() => undefined);
  }
  private decide(approved: boolean): void {
    const request = this.pending?.request;
    this.reset();
    if (request) this.ports.decide(request, approved);
  }
}
