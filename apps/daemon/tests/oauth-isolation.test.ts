import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { Authority } from '../src/oauth/authority.js';
import type { Consent } from '../src/oauth/authority.js';
it('keeps requests, codes and grants within their issuer/daemon', () => {
  let consent: Consent | undefined;
  const bridge = {
    offer: (value: Consent) => {
      consent = value;
      return ['session'];
    },
    dismiss: () => {},
    active: () => true,
  };
  const clients = [
    {
      id: 'client',
      name: 'Client',
      redirectUris: ['https://client.example/callback'],
    },
  ];
  const dev = new Authority({ issuer: 'https://dev.example', clients }, bridge);
  const prod = new Authority(
    { issuer: 'https://prod.example', clients },
    bridge,
  );
  const verifier = 'v'.repeat(43);
  let redirect = '';
  dev.authorize(
    new URLSearchParams({
      client_id: 'client',
      redirect_uri: clients[0]?.redirectUris[0] ?? '',
      response_type: 'code',
      state: 'state',
      scope: 'browser:read',
      resource: dev.resource,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    }),
    (value) => {
      redirect = value;
    },
  );
  if (!consent) throw new Error('Missing consent');
  const decision = {
    requestId: consent.requestId,
    nonce: consent.nonce,
    approved: true,
  };
  expect(prod.decide('session', 'browser', decision)).toBe(false);
  expect(dev.decide('session', 'browser', decision)).toBe(true);
  const exchange = new URLSearchParams({
    code: new URL(redirect).searchParams.get('code') ?? '',
    grant_type: 'authorization_code',
    client_id: 'client',
    redirect_uri: clients[0]?.redirectUris[0] ?? '',
    resource: dev.resource,
    code_verifier: verifier,
  });
  expect(() => prod.exchange(exchange)).toThrow();
  const token = dev.exchange(exchange).access_token;
  expect(prod.authenticate(`Bearer ${token}`)).toBeUndefined();
  expect(dev.authenticate(`Bearer ${token}`)).toBeDefined();
  prod.close();
  expect(dev.authenticate(`Bearer ${token}`)).toBeDefined();
  dev.close();
});
