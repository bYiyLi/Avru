import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loadOAuthConfig } from '../src/oauth/load-config.js';
it('loads an explicit HTTPS public origin and allowlisted clients, otherwise fails closed', async () => {
  expect(await loadOAuthConfig(undefined)).toBeUndefined();
  const dir = await mkdtemp(join(tmpdir(), 'avru-oauth-'));
  const path = join(dir, 'config.json');
  try {
    const valid = {
      issuer: 'https://avru.example',
      port: 43822,
      clients: [
        {
          id: 'client',
          name: 'Client',
          redirectUris: ['https://client.example/callback'],
        },
      ],
    };
    await writeFile(path, JSON.stringify(valid));
    expect(await loadOAuthConfig(path)).toEqual(valid);
    for (const value of [
      null,
      { ...valid, port: 80 },
      { ...valid, clients: [null] },
      { ...valid, clients: [{ id: 1 }] },
      { ...valid, clients: [{ id: 'x', name: 'X', redirectUris: [1] }] },
    ]) {
      await writeFile(path, JSON.stringify(value));
      await expect(loadOAuthConfig(path)).rejects.toThrow();
    }
    await writeFile(path, 'broken');
    await expect(loadOAuthConfig(path)).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
