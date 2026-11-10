import { createHash, randomBytes } from 'node:crypto';
import { parseScopes, validateConfig } from './config.js';
import type { OAuthConfig } from './config.js';

const secret = () => randomBytes(32).toString('base64url');
const hash = (value: string) =>
  createHash('sha256').update(value).digest('base64url');
export interface Consent {
  requestId: string;
  nonce: string;
  clientName: string;
  redirectUri: string;
  resource: string;
  scope: string;
  expiresAt: number;
}
export interface ConsentBridge {
  offer(consent: Consent): string[];
  dismiss(requestId: string): void;
  active(browserId: string): boolean;
}
interface Request {
  consent: Consent;
  clientId: string;
  challenge: string;
  state: string;
  sessions: string[];
  scopes: string[];
  finish: (redirect: string) => void;
}
interface Grant {
  id: string;
  browserId: string;
  clientId: string;
  expiresAt: number;
  scopes: string[];
}
interface Code {
  request: Request;
  browserId: string;
  expiresAt: number;
  grantId?: string;
}
export class Authority {
  readonly config: OAuthConfig;
  private pending: Request | undefined;
  private readonly codes = new Map<string, Code>();
  private readonly tokens = new Map<string, Grant>();
  private nextRequestAt = 0;
  private windowStart = 0;
  private windowRequests = 0;
  constructor(
    config: OAuthConfig,
    private readonly bridge: ConsentBridge,
    private readonly now: () => number = Date.now,
  ) {
    this.config = validateConfig(config);
  }
  get resource(): string {
    return `${this.config.issuer}/mcp`;
  }
  authorize(
    values: URLSearchParams,
    finish: (redirect: string) => void,
  ): string {
    this.sweep();
    const client = this.config.clients.find(
      (item) => item.id === values.get('client_id'),
    );
    const redirectUri = values.get('redirect_uri') ?? '';
    const challenge = values.get('code_challenge') ?? '';
    const state = values.get('state') ?? '';
    const grantedScopes = parseScopes(values.get('scope'));
    if (
      !client ||
      !client.redirectUris.includes(redirectUri) ||
      values.get('response_type') !== 'code' ||
      values.get('code_challenge_method') !== 'S256' ||
      !/^[\w-]{43}$/.test(challenge) ||
      !state ||
      state.length > 512 ||
      values.get('resource') !== this.resource ||
      grantedScopes === undefined
    )
      throw new Error('invalid_request');
    if (this.now() - this.windowStart >= 300_000) {
      this.windowStart = this.now();
      this.windowRequests = 0;
    }
    if (
      this.windowRequests >= 3 ||
      this.pending ||
      this.now() < this.nextRequestAt ||
      this.tokens.size >= 64
    )
      throw new Error('temporarily_unavailable');
    const consent: Consent = {
      requestId: secret(),
      nonce: secret(),
      clientName: client.name,
      redirectUri,
      resource: this.resource,
      scope: grantedScopes.join(' '),
      expiresAt: this.now() + 120_000,
    };
    this.nextRequestAt = this.now() + 10_000;
    this.windowRequests++;
    this.pending = {
      consent,
      clientId: client.id,
      challenge,
      state,
      finish,
      sessions: [],
      scopes: grantedScopes,
    };
    this.pending.sessions = this.bridge.offer(consent);
    if (!this.pending.sessions.length) {
      this.pending = undefined;
      throw new Error('temporarily_unavailable');
    }
    return consent.requestId;
  }
  decide(
    sessionId: string,
    browserId: string,
    decision: {
      requestId: string;
      nonce: string;
      approved: boolean;
    },
  ): boolean {
    this.sweep();
    const item = this.pending;
    if (
      !item ||
      item.consent.requestId !== decision.requestId ||
      item.consent.nonce !== decision.nonce ||
      !item.sessions.includes(sessionId) ||
      !this.bridge.active(browserId)
    )
      return false;
    this.pending = undefined;
    this.bridge.dismiss(item.consent.requestId);
    if (!decision.approved) {
      item.finish(this.redirect(item, 'error', 'access_denied'));
      return true;
    }
    const code = secret();
    this.codes.set(hash(code), {
      request: item,
      browserId,
      expiresAt: this.now() + 60_000,
    });
    item.finish(this.redirect(item, 'code', code));
    return true;
  }
  cancel(requestId: string): void {
    if (this.pending?.consent.requestId !== requestId) return;
    const item = this.pending;
    this.pending = undefined;
    this.bridge.dismiss(requestId);
    item.finish(this.redirect(item, 'error', 'access_denied'));
  }
  exchange(values: URLSearchParams) {
    this.sweep();
    const key = hash(values.get('code') ?? '');
    const code = this.codes.get(key);
    const verifier = values.get('code_verifier') ?? '';
    if (
      !code ||
      code.expiresAt <= this.now() ||
      values.get('grant_type') !== 'authorization_code' ||
      values.get('client_id') !== code.request.clientId ||
      values.get('redirect_uri') !== code.request.consent.redirectUri ||
      values.get('resource') !== this.resource ||
      !/^[\w.~-]{43,128}$/.test(verifier) ||
      hash(verifier) !== code.request.challenge ||
      !this.bridge.active(code.browserId)
    )
      throw new Error('invalid_grant');
    if (code.grantId) {
      this.revoke(code.grantId);
      throw new Error('invalid_grant');
    }
    const token = secret();
    const grant: Grant = {
      id: secret(),
      browserId: code.browserId,
      clientId: code.request.clientId,
      expiresAt: this.now() + 600_000,
      scopes: code.request.scopes,
    };
    code.grantId = grant.id;
    code.expiresAt = grant.expiresAt;
    this.tokens.set(hash(token), grant);
    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: 600,
      scope: code.request.scopes.join(' '),
    };
  }
  authenticate(authorization: string | undefined): Grant | undefined {
    this.sweep();
    if (!authorization?.startsWith('Bearer ')) return undefined;
    const grant = this.tokens.get(hash(authorization.slice(7)));
    return grant && this.bridge.active(grant.browserId)
      ? { ...grant }
      : undefined;
  }
  revoke(id: string): void {
    for (const [key, grant] of this.tokens)
      if (grant.id === id) this.tokens.delete(key);
  }
  revokeToken(values: URLSearchParams): void {
    const grant = this.tokens.get(hash(values.get('token') ?? ''));
    if (grant?.clientId === values.get('client_id')) this.revoke(grant.id);
  }
  grants() {
    this.sweep();
    return [...this.tokens.values()].map((item) => ({
      ...item,
      scope: item.scopes.join(' '),
    }));
  }
  sweep(): void {
    if (this.pending && this.pending.consent.expiresAt <= this.now())
      this.cancel(this.pending.consent.requestId);
    for (const [key, code] of this.codes)
      if (code.expiresAt <= this.now()) this.codes.delete(key);
    for (const [key, grant] of this.tokens)
      if (grant.expiresAt <= this.now() || !this.bridge.active(grant.browserId))
        this.tokens.delete(key);
  }
  close(): void {
    if (this.pending) this.cancel(this.pending.consent.requestId);
    this.tokens.clear();
    this.codes.clear();
  }
  private redirect(item: Request, key: string, value: string): string {
    const uri = new URL(item.consent.redirectUri);
    uri.searchParams.set(key, value);
    uri.searchParams.set('state', item.state);
    uri.searchParams.set('iss', this.config.issuer);
    return uri.href;
  }
}
