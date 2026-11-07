import { CallTraces } from '../src/call-traces.js';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { expect, it, vi } from 'vitest';
import { Connections } from '../src/connections.js';
import { BrowserStore } from '../src/store.js';
import { parseMessage } from '../src/messages.js';
import { buildApp } from '../src/app.js';
import { attachOAuth } from '../src/oauth/integration.js';
import { Authority } from '../src/oauth/authority.js';
import type { Consent } from '../src/oauth/authority.js';
import Fastify from 'fastify';
const consent: Consent = {
  requestId: 'request',
  nonce: 'nonce',
  clientName: 'Client',
  redirectUri: 'https://client.example/callback',
  resource: 'https://avru.example/mcp',
  scope: 'browser:read',
  expiresAt: Date.now() + 10_000,
};
it('only authenticated, current WS session reaches OAuth decision and revoked pairing loses grant authority', () => {
  const store = new BrowserStore(':memory:');
  const decide = vi.fn();
  const connections = new Connections(store, Date.now, decide);
  const messages: string[] = [];
  const peer = connections.attach(
    {
      send: (value) => {
        messages.push(value);
      },
      close: vi.fn(),
    },
    'chrome-extension://' + 'a'.repeat(32),
  );
  try {
    expect(connections.offerConsent(consent)).toEqual([]);
    peer.receive(
      JSON.stringify({
        v: 1,
        type: 'pair',
        name: 'Browser',
        profileId: 'profile',
      }),
    );
    connections.approve(connections.pairings()[0]?.id ?? '');
    const browserId = connections.browsers()[0]?.id ?? '';
    expect(connections.ownsBrowser(browserId)).toBe(true);
    expect(connections.offerConsent(consent)).toHaveLength(1);
    expect(messages.at(-1)).toContain('oauth-request');
    peer.receive(
      JSON.stringify({
        v: 1,
        type: 'oauth-decision',
        requestId: 'request',
        nonce: 'nonce',
        approved: true,
      }),
    );
    expect(decide).toHaveBeenCalledWith(
      expect.any(String),
      browserId,
      expect.objectContaining({ requestId: 'request' }),
    );
    connections.dismissConsent('request');
    expect(messages.at(-1)).toContain('oauth-close');
    connections.revoke(browserId);
    expect(connections.ownsBrowser(browserId)).toBe(false);
    peer.receive(
      JSON.stringify({
        v: 1,
        type: 'oauth-decision',
        requestId: 'request',
        nonce: 'nonce',
        approved: true,
      }),
    );
    expect(decide).toHaveBeenCalledTimes(1);
    expect(() =>
      parseMessage(
        JSON.stringify({
          v: 1,
          type: 'oauth-decision',
          requestId: 'r',
          nonce: 'n',
          approved: 'yes',
        }),
      ),
    ).toThrow();
  } finally {
    connections.close();
    store.close();
  }
});
it('guards optional remote startup and retains local-only grant management', async () => {
  const store = new BrowserStore(':memory:');
  const connections = new Connections(store);
  const app = Fastify();
  const config = {
    issuer: 'https://avru.example',
    clients: [
      {
        id: 'client',
        name: 'Client',
        redirectUris: ['https://client.example/callback'],
      },
    ],
  };
  try {
    expect(attachOAuth(app, connections, undefined, 43821)).toBeUndefined();
    for (const port of [0, 65536, 43821, 2.5])
      expect(() =>
        attachOAuth(app, connections, { ...config, port }, 43821),
      ).toThrow();
    // Inspect lifecycle using a real unused loopback port allocated by Fastify below.
    const reservation = Fastify();
    await reservation.listen({ host: '127.0.0.1', port: 0 });
    const address = reservation.server.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    const port = address.port;
    await reservation.close();
    const authority = attachOAuth(
      app,
      connections,
      { ...config, port },
      { port: 43821, traces: new CallTraces() },
    );
    expect(authority).toBeInstanceOf(Authority);
    if (!authority) throw new Error('Missing authority');
    const offer = vi
      .spyOn(connections, 'offerConsent')
      .mockReturnValue(['session']);
    vi.spyOn(connections, 'ownsBrowser').mockReturnValue(true);
    const dismiss = vi.spyOn(connections, 'dismissConsent');
    const finish = vi.fn();
    const verifier = 'v'.repeat(43);
    authority.authorize(
      new URLSearchParams({
        client_id: 'client',
        response_type: 'code',
        redirect_uri: 'https://client.example/callback',
        scope: 'browser:read',
        resource: authority.resource,
        state: 'state',
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256')
          .update(verifier)
          .digest('base64url'),
      }),
      finish,
    );
    const offered = offer.mock.calls[0]?.[0];
    if (!offered) throw new Error('No consent');
    authority.decide('session', 'browser', {
      requestId: offered.requestId,
      nonce: offered.nonce,
      approved: true,
    });
    expect(dismiss).toHaveBeenCalled();
    const code =
      new URL(String(finish.mock.calls[0]?.[0])).searchParams.get('code') ?? '';
    const token = authority.exchange(
      new URLSearchParams({
        client_id: 'client',
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: 'https://client.example/callback',
        resource: authority.resource,
      }),
    ).access_token;

    await app.ready();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        `http://127.0.0.1:${String(port)}/.well-known/oauth-authorization-server`,
        { headers: { host: 'avru.example' } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(200);
    const toolStatus = await new Promise<number | undefined>(
      (resolve, reject) => {
        const req = request(
          `http://127.0.0.1:${String(port)}/mcp`,
          {
            method: 'POST',
            headers: {
              host: 'avru.example',
              authorization: `Bearer ${token}`,
              'content-type': 'application/json',
            },
          },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        );
        req.on('error', reject);
        req.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'browsers_list' },
          }),
        );
      },
    );
    expect(toolStatus).toBe(200);
  } finally {
    await app.close();
    store.close();
  }
  const local = buildApp({ adminKey: 'key' });
  const headers = {
    host: '127.0.0.1:43821',
    authorization: 'Bearer key',
    origin: 'http://127.0.0.1:43821',
  };
  try {
    expect(
      (await local.inject({ url: '/api/grants', headers })).json<unknown>(),
    ).toEqual({ grants: [] });
    expect(
      (
        await local.inject({
          method: 'DELETE',
          url: '/api/grants/unknown',
          headers,
        })
      ).statusCode,
    ).toBe(204);
  } finally {
    await local.close();
  }
});
