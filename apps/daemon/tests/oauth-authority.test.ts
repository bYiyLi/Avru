import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { Authority } from '../src/oauth/authority.js';
import type { Consent } from '../src/oauth/authority.js';
import { parameters, validateConfig } from '../src/oauth/config.js';
const config = {
  issuer: 'https://avru.example',
  clients: [
    {
      id: 'client',
      name: 'Test client',
      redirectUris: ['https://client.example/callback'],
    },
  ],
};
const verifier = 'v'.repeat(43);
function setup() {
  let now = 1000;
  let consent: Consent | undefined;
  const bridge = {
    offer: vi.fn((value: Consent) => {
      consent = value;
      return ['session'];
    }),
    dismiss: vi.fn(),
    active: vi.fn(() => true),
  };
  const authority = new Authority(config, bridge, () => now);
  const values = new URLSearchParams({
    client_id: 'client',
    redirect_uri: 'https://client.example/callback',
    response_type: 'code',
    state: 'state',
    resource: authority.resource,
    scope: 'browser:read',
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  });
  const finish = vi.fn();
  const begin = () => authority.authorize(values, finish);
  const approve = (approved = true) => {
    if (!consent) throw new Error('No consent');
    return authority.decide('session', 'browser', {
      requestId: consent.requestId,
      nonce: consent.nonce,
      approved,
    });
  };
  const exchange = () =>
    new URLSearchParams({
      client_id: 'client',
      code:
        new URL(String(finish.mock.calls[0]?.[0])).searchParams.get('code') ??
        '',
      grant_type: 'authorization_code',
      code_verifier: verifier,
      redirect_uri: 'https://client.example/callback',
      resource: authority.resource,
    });
  return {
    authority,
    bridge,
    values,
    begin,
    approve,
    finish,
    exchange,
    advance: (ms: number) => {
      now += ms;
    },
    consent: () => consent,
  };
}
describe('extension-only OAuth grant lifecycle', () => {
  it('binds to the pending authenticated session and one-time challenge, issues scoped revocable token', () => {
    const x = setup();
    const id = x.begin();
    const c = x.consent();
    expect(x.finish).not.toHaveBeenCalled();
    expect(x.authority.grants()).toEqual([]);
    expect(
      x.authority.decide('foreign', 'browser', {
        requestId: id,
        nonce: c?.nonce ?? '',
        approved: true,
      }),
    ).toBe(false);
    expect(
      x.authority.decide('session', 'browser', {
        requestId: id,
        nonce: 'wrong',
        approved: true,
      }),
    ).toBe(false);
    expect(
      x.authority.decide('session', 'browser', {
        requestId: 'wrong',
        nonce: c?.nonce ?? '',
        approved: true,
      }),
    ).toBe(false);
    x.bridge.active.mockReturnValueOnce(false);
    expect(x.approve()).toBe(false);
    expect(x.approve()).toBe(true);
    expect(x.approve()).toBe(false);
    const redirect = new URL(String(x.finish.mock.calls[0]?.[0]));
    expect(redirect.searchParams.get('state')).toBe('state');
    expect(redirect.searchParams.get('iss')).toBe(config.issuer);
    const token = x.authority.exchange(x.exchange());
    expect(token).toMatchObject({
      token_type: 'Bearer',
      expires_in: 600,
      scope: 'browser:read',
    });
    expect(
      x.authority.authenticate(`Bearer ${token.access_token}`),
    ).toMatchObject({ browserId: 'browser', clientId: 'client' });
    expect(x.authority.authenticate(undefined)).toBeUndefined();
    expect(x.authority.authenticate('Basic x')).toBeUndefined();
    expect(x.authority.authenticate('Bearer unknown')).toBeUndefined();
    const grant = x.authority.grants()[0];
    expect(grant).toBeDefined();
    x.authority.revoke(grant?.id ?? '');
    expect(
      x.authority.authenticate(`Bearer ${token.access_token}`),
    ).toBeUndefined();
  });
  it.each([
    'client_id',
    'redirect_uri',
    'response_type',
    'code_challenge_method',
    'code_challenge',
    'state',
    'resource',
    'scope',
  ])('rejects tampered %s before offering consent', (key) => {
    const x = setup();
    x.values.set(key, 'wrong');
    if (key === 'state') x.values.set(key, '');
    expect(x.begin).toThrow('invalid_request');
    expect(x.bridge.offer).not.toHaveBeenCalled();
  });
  it('rejects duplicates and unbounded input and invalid config', () => {
    expect(() => parameters('x=1&x=2')).toThrow();
    expect(() => parameters({})).toThrow();
    expect(() => parameters('x=' + 'a'.repeat(8193))).toThrow();
    expect(() => parameters('x=' + 'a'.repeat(2049))).toThrow();
    expect(parameters('x=1').get('x')).toBe('1');
    expect(() =>
      validateConfig({ ...config, issuer: 'http://avru.example' }),
    ).toThrow();
    expect(() => validateConfig({ ...config, clients: [] })).toThrow();
    expect(() =>
      validateConfig({
        ...config,
        clients: [
          { id: 'x', name: 'X', redirectUris: ['https://x.test/'] },
          { id: 'x', name: 'X', redirectUris: ['https://x.test/'] },
        ],
      }),
    ).toThrow();
    expect(() =>
      validateConfig({
        ...config,
        clients: [{ id: 'a', name: '', redirectUris: [] }],
      }),
    ).toThrow();
    expect(() =>
      validateConfig({
        ...config,
        clients: [
          { id: 'a', name: 'x', redirectUris: ['https://evil.test/#fragment'] },
        ],
      }),
    ).toThrow();
  });
  it('rejects concurrent offers, offline extension, cancellation, expiry and closes all pending state', () => {
    const x = setup();
    const id = x.begin();
    expect(x.begin).toThrow('temporarily_unavailable');
    x.authority.cancel('wrong');
    expect(x.finish).not.toHaveBeenCalled();
    x.authority.cancel(id);
    expect(String(x.finish.mock.calls[0]?.[0])).toContain('access_denied');
    expect(x.begin).toThrow('temporarily_unavailable');
    x.advance(11_000);
    x.bridge.offer.mockReturnValueOnce([]);
    expect(x.begin).toThrow('temporarily_unavailable');
    x.advance(11_000);
    x.begin();
    x.advance(120_000);
    x.authority.sweep();
    expect(x.approve()).toBe(false);
    x.advance(300_000);
    x.begin();
    expect(x.approve(false)).toBe(true);
    x.advance(11_000);
    x.begin();
    x.authority.close();
    expect(x.approve()).toBe(false);
  });
  it.each([
    'client_id',
    'redirect_uri',
    'code_verifier',
    'resource',
    'grant_type',
    'code',
  ])('rejects token exchange with invalid %s', (key) => {
    const x = setup();
    x.begin();
    x.approve();
    const values = x.exchange();
    values.set(key, 'bad');
    expect(() => x.authority.exchange(values)).toThrow('invalid_grant');
    expect(x.authority.grants()).toEqual([]);
  });
  it('prevents intercepted code reuse, expires codes/tokens and revokes when pairing removed', () => {
    const x = setup();
    x.begin();
    x.approve();
    const values = x.exchange();
    const token = x.authority.exchange(values);
    expect(() => x.authority.exchange(values)).toThrow('invalid_grant');
    expect(
      x.authority.authenticate(`Bearer ${token.access_token}`),
    ).toBeUndefined();
    x.advance(61_000);
    expect(() => x.authority.exchange(values)).toThrow();
    const y = setup();
    y.begin();
    y.approve();
    y.bridge.active.mockReturnValue(false);
    expect(() => y.authority.exchange(y.exchange())).toThrow();
    y.bridge.active.mockReturnValue(true);
    const second = y.authority.exchange(y.exchange());
    y.advance(600_001);
    expect(
      y.authority.authenticate(`Bearer ${second.access_token}`),
    ).toBeUndefined();
    const z = setup();
    z.begin();
    z.approve();
    const third = z.authority.exchange(z.exchange());
    z.bridge.active.mockReturnValue(false);
    expect(
      z.authority.authenticate(`Bearer ${third.access_token}`),
    ).toBeUndefined();
  });
  it('revocation is client-bound and unknown tokens remain indistinguishable', () => {
    const x = setup();
    x.begin();
    x.approve();
    const token = x.authority.exchange(x.exchange());
    x.authority.revokeToken(
      new URLSearchParams({ token: token.access_token, client_id: 'other' }),
    );
    expect(x.authority.grants()).toHaveLength(1);
    x.authority.revokeToken(new URLSearchParams());
    expect(x.authority.grants()).toHaveLength(1);
    x.authority.revokeToken(
      new URLSearchParams({ token: token.access_token, client_id: 'client' }),
    );
    expect(x.authority.grants()).toEqual([]);
    x.authority.close();
  });
});

it('caps popup requests across repeated denials and preserves replay tombstones until token expiry', () => {
  const x = setup();
  for (let i = 0; i < 3; i++) {
    x.begin();
    x.approve(false);
    x.advance(11_000);
  }
  expect(x.begin).toThrow('temporarily_unavailable');
  x.advance(300_000);
  expect(x.begin()).toBeTruthy();
  x.authority.close();
  const y = setup();
  y.begin();
  y.approve();
  const values = y.exchange();
  const token = y.authority.exchange(values);
  y.advance(61_000);
  expect(() => y.authority.exchange(values)).toThrow('invalid_grant');
  expect(
    y.authority.authenticate(`Bearer ${token.access_token}`),
  ).toBeUndefined();
});
