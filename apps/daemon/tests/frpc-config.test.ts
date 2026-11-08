import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ownedDirectory } from '../src/transports/private-files.js';
import { prepareProcess } from '../src/transports/frpc-config.js';
import { connectionBundle } from './connection-fixture.js';
it('escapes environment substitution as JSON content without allowing credentials to inject configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'avru-template-'));
  try {
    const directory = await ownedDirectory(root);
    const bundle = connectionBundle();
    bundle.frp.token = 'opaque"\\value{{ literal }}';
    const prepared = await prepareProcess(directory, bundle, 43822);
    const body = await readFile(prepared.configPath, 'utf8');
    expect(body).not.toContain(bundle.frp.token);
    const expanded = body.replace(
      '{{ .Envs.AVRU_DEV_FRP_TOKEN }}',
      prepared.env.AVRU_DEV_FRP_TOKEN ?? '',
    );
    const config = JSON.parse(expanded) as {
      auth: { token: string };
      proxies: unknown[];
    };
    expect(config.auth.token).toBe(bundle.frp.token);
    expect(config.proxies).toHaveLength(1);
    expect(prepared.env).not.toHaveProperty('NODE_AUTH_TOKEN');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
