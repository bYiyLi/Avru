import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { Authority } from '../src/oauth/authority.js';
import type { Consent } from '../src/oauth/authority.js';
import { buildRemote } from '../src/oauth/http.js';
import { mcpResponse } from '../src/oauth/mcp.js';
const apps: ReturnType<typeof buildRemote>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
function fixture() {
  let consent: Consent | undefined;
  const authority = new Authority(
    {
      issuer: 'https://avru.example',
      clients: [
        {
          id: 'client',
          name: 'Client',
          redirectUris: ['https://client.example/callback'],
        },
      ],
    },
    {
      offer: (value) => {
        consent = value;
        return ['session'];
      },
      dismiss: () => undefined,
      active: () => true,
    },
  );
  const app = buildRemote(authority, () => ({ browsers: [] }));
  apps.push(app);
  const headers = { host: 'avru.example' };
  return { authority, app, headers, consent: () => consent };
}
it('separates remote routes from local management, metadata and error boundaries', async () => {
  const { app, headers } = fixture();
  expect(
    (
      await app.inject({
        url: '/.well-known/oauth-authorization-server',
        headers,
      })
    ).json<unknown>(),
  ).toMatchObject({
    issuer: 'https://avru.example',
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
  });
  expect(
    (
      await app.inject({
        url: '/.well-known/oauth-protected-resource/mcp',
        headers,
      })
    ).json<unknown>(),
  ).toMatchObject({
    resource: 'https://avru.example/mcp',
    authorization_servers: ['https://avru.example'],
  });
  expect((await app.inject({ url: '/api/browsers', headers })).statusCode).toBe(
    404,
  );
  expect(
    (await app.inject({ url: '/oauth/authorize', headers })).statusCode,
  ).toBe(400);
  expect((await app.inject({ url: '/mcp', headers })).statusCode).toBe(405);
  expect((await app.inject({ url: '/oauth/authorize' })).statusCode).toBe(403);
  expect(
    (
      await app.inject({
        url: '/mcp',
        headers: { ...headers, origin: 'https://evil.test' },
      })
    ).statusCode,
  ).toBe(403);
  const denied = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers,
    payload: {},
  });
  expect(denied.statusCode).toBe(401);
  expect(denied.headers['www-authenticate']).toContain(
    'oauth-protected-resource/mcp',
  );
  for (const path of ['/oauth/token', '/oauth/revoke']) {
    expect(
      (await app.inject({ method: 'POST', url: path, headers, payload: {} }))
        .statusCode,
    ).toBe(400);
  }
});
it('keeps approval off HTTP, redirects only after extension, protects each call and revokes', async () => {
  const x = fixture();
  const verifier = 'v'.repeat(43);
  const params = new URLSearchParams({
    client_id: 'client',
    response_type: 'code',
    redirect_uri: 'https://client.example/callback',
    resource: x.authority.resource,
    scope: 'browser:read',
    state: 'state',
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  });
  const waiting = x.app.inject({
    url: `/oauth/authorize?${params.toString()}`,
    headers: x.headers,
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const consent = x.consent();
  expect(consent).toBeDefined();
  expect(
    (
      await x.app.inject({
        method: 'POST',
        url: '/oauth/approve',
        headers: x.headers,
        payload: {},
      })
    ).statusCode,
  ).toBe(404);
  x.authority.decide('session', 'browser', {
    requestId: consent?.requestId ?? '',
    nonce: consent?.nonce ?? '',
    approved: true,
  });
  const redirected = await waiting;
  expect(redirected.statusCode).toBe(302);
  const code =
    new URL(String(redirected.headers.location)).searchParams.get('code') ?? '';
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: 'client',
    code_verifier: verifier,
    resource: x.authority.resource,
    redirect_uri: 'https://client.example/callback',
  });
  const headers = {
    ...x.headers,
    'content-type': 'application/x-www-form-urlencoded',
  };
  const issued = await x.app.inject({
    method: 'POST',
    url: '/oauth/token',
    headers,
    payload: body.toString(),
  });
  expect(issued.statusCode).toBe(200);
  const { access_token: token } = issued.json<{ access_token: string }>();
  const call = {
    method: 'POST' as const,
    url: '/mcp',
    headers: { ...x.headers, authorization: `Bearer ${token}` },
    payload: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'browsers_list' },
    },
  };
  expect(
    (
      await x.app.inject({
        ...call,
        headers: { ...call.headers, 'mcp-protocol-version': 'bad' },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await x.app.inject({
        ...call,
        headers: { ...call.headers, accept: 'text/html' },
      })
    ).statusCode,
  ).toBe(406);
  expect(
    (
      await x.app.inject({
        ...call,
        headers: {
          ...call.headers,
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-11-25',
        },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await x.app.inject({
        ...call,
        headers: { ...call.headers, accept: '*/*' },
      })
    ).statusCode,
  ).toBe(200);
  expect((await x.app.inject(call)).json<unknown>()).toMatchObject({
    result: { content: [{ type: 'text', text: '{"browsers":[]}' }] },
  });
  expect(
    (
      await x.app.inject({
        method: 'POST',
        url: '/oauth/revoke',
        headers,
        payload: new URLSearchParams({ client_id: 'client', token }).toString(),
      })
    ).statusCode,
  ).toBe(200);
  expect((await x.app.inject(call)).statusCode).toBe(401);
});
it('handles stateless MCP discovery, notification, errors and tool schema', () => {
  const run = (method: string, params?: unknown) =>
    mcpResponse({ jsonrpc: '2.0', id: 1, method, params }, () => []);
  expect(run('initialize').body).toMatchObject({
    result: { capabilities: { tools: {} } },
  });
  expect(run('ping').status).toBe(200);
  expect(run('tools/list').body).toMatchObject({
    result: { tools: [{ name: 'browsers_list' }] },
  });
  expect(run('unknown').body).toMatchObject({ error: { code: -32601 } });
  for (const params of [
    null,
    {},
    { name: 'x' },
    { name: 'browsers_list', arguments: [] },
    { name: 'browsers_list', arguments: { unexpected: 1 } },
  ])
    expect(run('tools/call', params).body).toMatchObject({
      error: { code: -32602 },
    });
  expect(
    run('tools/call', { name: 'browsers_list', arguments: {} }).status,
  ).toBe(200);
  expect(
    mcpResponse(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      () => [],
    ),
  ).toEqual({ status: 202 });
  for (const raw of [null, {}, { jsonrpc: '2.0', method: 'ping', id: {} }])
    expect(mcpResponse(raw, () => []).status).toBe(400);
});

it('sweeps pending deadlines without exposing an HTTP approval route', async () => {
  vi.useFakeTimers();
  const x = fixture();
  const sweep = vi.spyOn(x.authority, 'sweep');
  try {
    await x.app.ready();
    await vi.advanceTimersByTimeAsync(1001);
    expect(sweep).toHaveBeenCalled();
  } finally {
    await x.app.close();
    apps.splice(apps.indexOf(x.app), 1);
    vi.useRealTimers();
  }
});
