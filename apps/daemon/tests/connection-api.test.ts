import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { unusedAdminPort } from '../src/transports/frpc-admin.js';
import { connectionBundle } from './connection-fixture.js';
const headers = {
  host: '127.0.0.1:43822',
  origin: 'http://127.0.0.1:43822',
  authorization: 'Bearer dev-key',
};
it('protects imported credentials, auto-applies only the matching environment and closes the listener on clear', async () => {
  const root = await mkdtemp(join(tmpdir(), 'avru-api-'));
  const driver = {
    start: vi.fn<() => Promise<void>>().mockResolvedValue(),
    stop: vi.fn<() => Promise<void>>().mockResolvedValue(),
    registered: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
  };
  const app = buildApp({
    channel: 'dev',
    adminKey: 'dev-key',
    port: 43822,
    databasePath: join(root, 'data.sqlite'),
    connection: { dataRoot: root, payloadRoot: root, driver },
  });
  const bundle = connectionBundle();
  bundle.oauth.port = await unusedAdminPort();
  try {
    expect(
      (
        await app.inject({
          url: '/api/connection',
          headers: { host: headers.host },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/connection/import',
          headers: { ...headers, origin: 'http://attacker.example' },
          payload: bundle,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/connection/import',
          headers,
          payload: { ...bundle, channel: 'prod' },
        })
      ).statusCode,
    ).toBe(400);
    expect(driver.start).not.toHaveBeenCalled();
    const result = await app.inject({
      method: 'POST',
      url: '/api/connection/import',
      headers,
      payload: bundle,
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      state: 'connecting',
      configured: true,
    });
    expect(result.body).not.toContain(bundle.frp.token);
    expect(result.body).not.toContain(bundle.frp.privateKeyPem);
    expect(driver.start).toHaveBeenCalledTimes(1);
    expect(
      (await app.inject({ url: '/api/status', headers })).json(),
    ).toMatchObject({
      frpc: 'managed',
      mcp: 'oauthReadOnly',
      chatgpt: 'notVerified',
    });
    expect(
      (await app.inject({ url: '/api/connection', headers })).json(),
    ).toMatchObject({ configured: true });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/connection/import',
          headers,
          payload: { content: 'x'.repeat(262144) },
        })
      ).statusCode,
    ).toBe(413);
    driver.stop.mockRejectedValueOnce(new Error('ownership_unknown'));
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/connection', headers }))
        .statusCode,
    ).toBe(409);
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/connection', headers }))
        .statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ url: '/api/connection', headers })).json(),
    ).toMatchObject({ configured: false });
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
it('returns safe failures when connection storage is absent and sanitizes unexpected local failures', async () => {
  const app = buildApp({ port: 43822, adminKey: 'dev-key' });
  app.get('/api/failure', () => {
    throw new Error('private internal exception');
  });
  app.get('/api/failure-status', () => {
    throw Object.assign(new Error('secret'), { statusCode: 200 });
  });
  try {
    for (const method of ['GET', 'POST', 'DELETE'] as const) {
      const response = await app.inject({
        method,
        url: method === 'POST' ? '/api/connection/import' : '/api/connection',
        headers,
        ...(method === 'POST' ? { payload: {} } : {}),
      });
      expect(response.statusCode).toBe(503);
    }
    for (const path of ['/api/failure', '/api/failure-status']) {
      const response = await app.inject({ url: path, headers });
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain('private');
      expect(response.json()).toEqual({ error: 'request_failed' });
    }
  } finally {
    await app.close();
  }
});
