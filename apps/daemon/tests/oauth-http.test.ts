import { CallTraces } from '../src/call-traces.js';
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Authority } from '../src/oauth/authority.js';
import type { Consent } from '../src/oauth/authority.js';
import { buildRemote } from '../src/oauth/http.js';
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
  const traces = new CallTraces();
  const app = buildRemote(authority, traces);
  apps.push(app);
  const headers = { host: 'avru.example' };
  return { authority, app, headers, traces, consent: () => consent };
}
/** A grant the mocked authenticate() returns (both M1 scopes). */
function grant() {
  return {
    id: 'grant',
    browserId: 'browser',
    clientId: 'client',
    expiresAt: Date.now() + 1000,
    scopes: ['browser:read', 'browser:control'],
  };
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
    headers: {
      ...x.headers,
      authorization: `Bearer ${token}`,
      accept: 'application/json, text/event-stream',
    },
    payload: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'browser_sdk_docs' },
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
  ).toBe(406);
  const docs = (await x.app.inject(call)).json<{
    result: { content: { text: string }[] };
  }>();
  const index = JSON.parse(docs.result.content[0]?.text ?? '{}') as {
    version: string;
    index: { topic: string }[];
  };
  expect(index.version).toBe('0.1.0-dev.1');
  expect(index.index.map((item) => item.topic)).toContain('mcp.browser_list');
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
  const events = x.traces.snapshot().calls;
  expect(events.map((value) => value.status)).toContain('succeeded');
  expect(events[0]?.status).toBe('rejected');
  expect(events[0]?.spans.map((value) => value.name)).toEqual([
    'request',
    'authorization',
  ]);
  expect(JSON.stringify(events)).not.toContain(token);
  expect(
    events.some(
      (value) =>
        value.spans[0]?.events[0]?.code === 'unsupported_protocol_version',
    ),
  ).toBe(true);
  expect(
    events.some(
      (value) => value.spans[0]?.events[0]?.code === 'not_acceptable',
    ),
  ).toBe(true);
});
it('handles stateless MCP discovery, notification, errors and tool schema', async () => {
  const x = fixture();
  vi.spyOn(x.authority, 'authenticate').mockReturnValue(grant());
  const headers = {
    ...x.headers,
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2025-11-25',
  };
  const call = async (method: string, params?: unknown, id: unknown = 1) => {
    const payload: Record<string, unknown> = { jsonrpc: '2.0', method };
    if (id !== undefined) payload.id = id;
    if (params !== undefined) payload.params = params;
    return x.app.inject({ method: 'POST', url: '/mcp', headers, payload });
  };
  const init = await call('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  });
  expect(init.statusCode).toBe(200);
  const initBody = init.json<{
    result: {
      capabilities: { tools: Record<string, unknown> };
      protocolVersion: string;
    };
  }>();
  expect(initBody.result.capabilities.tools).toEqual({});
  expect(initBody.result.protocolVersion).toBe('2025-11-25');
  expect((await call('ping')).statusCode).toBe(200);
  const list = await call('tools/list');
  expect(list.statusCode).toBe(200);
  expect(
    list
      .json<{ result: { tools: { name: string }[] } }>()
      .result.tools.map((tool) => tool.name),
  ).toEqual([
    'browser_list',
    'browser_claim_tab',
    'browser_run_script',
    'browser_get_execution',
    'browser_cancel_execution',
    'browser_sdk_docs',
  ]);
  const unknown = await call('unknown');
  expect(unknown.json<{ error: { code: number } }>().error.code).toBe(-32601);
  // A null params fails the JSON-RPC message schema itself (parse error).
  const nullParams = await call('tools/call', null);
  expect(nullParams.json<{ error: { code: number } }>().error.code).toBe(
    -32700,
  );
  // Malformed tools/call params are rejected by the SDK before the handler.
  // (The SDK surfaces schema failures as -32603, not -32602: the thrown
  // Zod error carries no numeric code, so the protocol layer falls back
  // to InternalError. The tool is never executed.)
  for (const params of [{}, { name: 'browser_sdk_docs', arguments: [] }]) {
    const response = await call('tools/call', params);
    expect(response.json<{ error: { code: number } }>().error.code).toBe(
      -32603,
    );
  }
  // Unknown tool names and extra arguments are tool errors, not protocol errors.
  for (const params of [
    { name: 'x' },
    { name: 'browser_sdk_docs', arguments: { unexpected: 1 } },
  ]) {
    const response = await call('tools/call', params);
    const body = response.json<{
      result: { isError?: boolean; content: { text: string }[] };
    }>();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]?.text).toBe('INVALID_ARGUMENT');
  }
  const docs = await call('tools/call', {
    name: 'browser_sdk_docs',
    arguments: {},
  });
  expect(docs.statusCode).toBe(200);
  const docsBody = docs.json<{
    result: { isError?: boolean; content: { text: string }[] };
  }>();
  expect(docsBody.result.isError).not.toBe(true);
  expect(JSON.parse(docsBody.result.content[0]?.text ?? '{}')).toMatchObject({
    version: '0.1.0-dev.1',
  });
  // Notifications are accepted (202) and never execute a tool. (Built
  // directly: the call() helper defaults id to 1, which would make this
  // a request instead of a notification.)
  const notification = await x.app.inject({
    method: 'POST',
    url: '/mcp',
    headers,
    payload: { jsonrpc: '2.0', method: 'notifications/initialized' },
  });
  expect(notification.statusCode).toBe(202);
  // Malformed raw bodies are rejected (sent as JSON strings so Fastify
  // parses them to the exact malformed value instead of an empty body).
  for (const raw of [
    'null',
    '{}',
    '{"jsonrpc":"2.0","method":"ping","id":{}}',
  ]) {
    const response = await x.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { ...headers, 'content-type': 'application/json' },
      payload: raw,
    });
    expect(response.statusCode).toBe(400);
  }
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
it('records protocol failures and sanitized internal errors instead of logging exceptions', async () => {
  const x = fixture();
  vi.spyOn(x.authority, 'authenticate').mockReturnValue(grant());
  const input = {
    method: 'POST' as const,
    url: '/mcp',
    headers: {
      ...x.headers,
      accept: 'application/json, text/event-stream',
    },
    payload: {
      jsonrpc: '2.0',
      id: 'private-id',
      method: 'tools/call',
      params: { name: 'browser_sdk_docs' },
    },
  };
  vi.spyOn(
    StreamableHTTPServerTransport.prototype,
    'handleRequest',
  ).mockRejectedValueOnce(new Error('sensitive transport failure'));
  const failed = await x.app.inject(input);
  expect(failed.statusCode).toBe(500);
  expect(failed.json<{ error: string }>()).toEqual({
    error: 'internal_error',
  });
  expect(x.traces.snapshot().calls[0]?.status).toBe('failed');
  expect(failed.headers['x-avru-request-id']).toBe(
    x.traces.snapshot().calls[0]?.requestId,
  );
  await x.app.inject({
    ...input,
    payload: { ...input.payload, method: 'private-method' },
  });
  expect(x.traces.snapshot().calls[0]?.status).toBe('rejected');
  const serialized = JSON.stringify(x.traces.snapshot());
  expect(serialized).not.toContain('sensitive transport failure');
  expect(serialized).not.toContain('private-id');
  expect(serialized).not.toContain('private-method');
});
it('records notification acceptance without pretending a tool was executed', async () => {
  const x = fixture();
  vi.spyOn(x.authority, 'authenticate').mockReturnValue(grant());
  const reply = await x.app.inject({
    method: 'POST',
    url: '/mcp',
    headers: {
      ...x.headers,
      accept: 'application/json, text/event-stream',
    },
    payload: {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'browser_sdk_docs' },
    },
  });
  expect(reply.statusCode).toBe(202);
  const call = x.traces.snapshot().calls[0];
  expect(call?.tool).toBeNull();
  expect(call?.spans[0]?.events[0]?.code).toBe('notification_accepted');
});
