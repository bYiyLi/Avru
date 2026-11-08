import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { CallTraces } from '../src/call-traces.js';
import type { CallTrace } from '../src/call-traces.js';
type History = { calls: CallTrace[]; retention: { persistent: boolean } };

it('exposes persistent history only to the matching local management capability', async () => {
  const root = mkdtempSync(join(tmpdir(), 'avru-history-isolation-'));
  const devPath = join(root, 'dev.sqlite');
  const prodPath = join(root, 'prod.sqlite');
  const traces = new CallTraces(devPath);
  const call = traces.begin({ method: 'ping' });
  call.step('authorization', 'rejected', 'invalid_token');
  call.finish('rejected', 'invalid_token');
  traces.close();
  const dev = buildApp({
    channel: 'dev',
    port: 43822,
    adminKey: 'dev-key',
    databasePath: devPath,
  });
  const prod = buildApp({
    channel: 'prod',
    port: 43821,
    adminKey: 'prod-key',
    databasePath: prodPath,
  });
  const headers = (port: number, key: string) => ({
    host: `127.0.0.1:${String(port)}`,
    origin: `http://127.0.0.1:${String(port)}`,
    authorization: `Bearer ${key}`,
  });
  try {
    expect(
      (
        await dev.inject({
          url: '/api/calls',
          headers: headers(43822, 'prod-key'),
        })
      ).statusCode,
    ).toBe(401);
    const saved = (
      await dev.inject({
        url: '/api/calls',
        headers: headers(43822, 'dev-key'),
      })
    ).json<History>();
    expect(saved.retention.persistent).toBe(true);
    expect(saved.calls[0]?.requestId).toBe(call.requestId);
    const other = (
      await prod.inject({
        url: '/api/calls',
        headers: headers(43821, 'prod-key'),
      })
    ).json<History>();
    expect(other.calls).toEqual([]);
  } finally {
    await dev.close();
    await prod.close();
    rmSync(root, { recursive: true, force: true });
  }
});
