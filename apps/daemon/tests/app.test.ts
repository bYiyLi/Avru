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
