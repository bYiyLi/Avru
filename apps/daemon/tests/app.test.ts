import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
const apps: ReturnType<typeof buildApp>[] = [];
const key = 'a'.repeat(64);
const host = '127.0.0.1:43821';
const headers = {
  host,
  authorization: `Bearer ${key}`,
  origin: `http://${host}`,
};
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
function app() {
  const instance = buildApp({ adminKey: key });
  apps.push(instance);
  return instance;
}
describe('local daemon HTTP trust boundary', () => {
  it('requires literal Host and the startup capability, never enables remote services', async () => {
    const instance = app();
    const health = await instance.inject({
      method: 'GET',
      url: '/health',
      headers: { host },
    });
    expect(health.json<unknown>()).toEqual({
      service: 'avru',
      state: 'browser-connection',
      browserControl: false,
    });
    expect(
      (await instance.inject({ url: '/api/status', headers: { host } }))
        .statusCode,
    ).toBe(401);
    expect(
      (await instance.inject({ url: '/api/status', headers })).json<unknown>(),
    ).toEqual({
      daemonVersion: '0.1.0-dev.1',
      expectedExtensionVersion: '0.0.1',
      extensionFiles: null,
      mcp: 'notImplemented',
      chatgpt: 'notVerified',
      frpc: 'notImplemented',
    });
    expect(health.headers['cache-control']).toBe('no-store');
    expect(health.headers['content-security-policy']).toContain(
      "frame-ancestors 'none'",
    );
    expect((await instance.inject({ url: '/health' })).statusCode).toBe(403);
    expect(
      (await instance.inject({ url: '/api/browsers', headers: { host } }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await instance.inject({
          url: '/api/browsers',
          headers: { host, authorization: `Bearer ${'b'.repeat(64)}` },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await instance.inject({
          url: '/api/browsers',
          headers: { ...headers, origin: 'https://evil.test' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await instance.inject({ url: '/api/browsers', headers })
      ).json<unknown>(),
    ).toEqual({ browsers: [] });
    expect(
      (
        await instance.inject({ url: '/api/pairings', headers })
      ).json<unknown>(),
    ).toEqual({ pairings: [] });
    for (const url of ['/mcp', '/oauth/authorize', '/pair'])
      expect(
        (await instance.inject({ method: 'POST', url, headers })).statusCode,
      ).toBe(404);
  });
  it('requires same Origin for mutations and handles absent identities without effects', async () => {
    const instance = app();
    expect(
      (
        await instance.inject({
          method: 'DELETE',
          url: '/api/browsers/id',
          headers: { host, authorization: headers.authorization },
        })
      ).statusCode,
    ).toBe(403);
    for (const url of ['/api/browsers/id', '/api/pairings/id'])
      expect(
        (await instance.inject({ method: 'DELETE', url, headers })).statusCode,
      ).toBe(404);
    expect(
      (
        await instance.inject({
          method: 'POST',
          url: '/api/pairings/id/approve',
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
    expect((await instance.inject({ url: '/', headers })).statusCode).toBe(503);
    expect(
      (await instance.inject({ url: '/assets/missing.js', headers }))
        .statusCode,
    ).toBe(404);
    const defaults = buildApp();
    apps.push(defaults);
    expect(
      (await defaults.inject({ url: '/api/browsers', headers })).statusCode,
    ).toBe(401);
  });
});
describe('management Web assets', () => {
  it('serves only the built entry and bounded assets, not files outside the root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'avru-web-'));
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'index.html'), '<h1>Avru</h1>');
    writeFileSync(join(root, 'assets', 'app.js'), 'console.log("Avru")');
    const instance = buildApp({ adminKey: key, webRoot: root });
    apps.push(instance);
    expect((await instance.inject({ url: '/', headers })).body).toContain(
      'Avru',
    );
    expect(
      (await instance.inject({ url: '/assets/app.js', headers })).headers[
        'content-type'
      ],
    ).toContain('javascript');
    for (const url of [
      '/assets/missing.js',
      '/assets/file.map',
      '/assets/..%2Findex.html',
    ])
      expect((await instance.inject({ url, headers })).statusCode).toBe(404);
    rmSync(root, { recursive: true });
    expect((await instance.inject({ url: '/', headers })).statusCode).toBe(503);
  });
});

it('rejects an empty JSON DELETE but accepts a bodyless mutation without content type', async () => {
  const instance = app();
  const bad = await instance.inject({
    method: 'DELETE',
    url: '/api/browsers/missing',
    headers: { ...headers, 'content-type': 'application/json' },
  });
  expect(bad.statusCode).toBe(400);
  expect(bad.json<{ error: string }>().error).toBe('request_failed');
  const valid = await instance.inject({
    method: 'DELETE',
    url: '/api/browsers/missing',
    headers,
  });
  expect(valid.statusCode).toBe(404);
});

it('exposes call history only through authenticated local management', async () => {
  const instance = app();
  expect(
    (await instance.inject({ url: '/api/calls', headers: { host } }))
      .statusCode,
  ).toBe(401);
  expect(
    (await instance.inject({ url: '/api/calls', headers })).json<unknown>(),
  ).toEqual({ calls: [], retention: { limit: 200, persistent: false } });
});

it('requires management authentication and same origin to issue a scoped connection ticket', async () => {
  const instance = app();
  const url = '/api/connection-ticket';
  const payload = { challenge: 'a'.repeat(64) };
  expect(
    (
      await instance.inject({
        method: 'POST',
        url,
        payload,
        headers: { host, origin: headers.origin },
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await instance.inject({
        method: 'POST',
        url,
        payload,
        headers: { ...headers, origin: 'https://evil.test' },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await instance.inject({
        method: 'POST',
        url,
        payload,
        headers: { host, authorization: headers.authorization },
      })
    ).statusCode,
  ).toBe(403);
  for (const value of [null, {}, { challenge: 2 }, { challenge: 'short' }])
    expect(
      (
        await instance.inject({
          method: 'POST',
          url,
          payload: JSON.stringify(value),
          headers: { ...headers, 'content-type': 'application/json' },
        })
      ).statusCode,
    ).toBe(400);
  expect(
    (await instance.inject({ method: 'POST', url, payload, headers }))
      .statusCode,
  ).toBe(404);
});
