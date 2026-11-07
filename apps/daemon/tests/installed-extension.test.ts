import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { installedExtension } from '../src/installed-extension.js';
it('reports only real prepared same-channel files, not browser installation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'avru-extension-info-'));
  try {
    expect(await installedExtension(root, 'dev')).toBeNull();
    const directory = join(root, 'extension');
    await mkdir(directory);
    const keys = JSON.parse(
      await readFile('apps/extension/manifest-keys.json', 'utf8'),
    ) as Record<'dev', string>;
    const manifest = { manifest_version: 3, version: '0.0.1', key: keys.dev };
    await writeFile(join(directory, '.avru-owned'), 'unknown');
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    expect(await installedExtension(root, 'dev')).toBeNull();
    await writeFile(join(directory, '.avru-owned'), 'avru-extension-v1');
    expect(await installedExtension(root, 'dev')).toEqual({
      directory,
      version: '0.0.1',
      extensionId: 'cbjgomelhiahmdadpkeijpbkldblanei',
    });
    expect(await installedExtension(root, 'prod')).toBeNull();
    for (const value of [
      null,
      {},
      { ...manifest, manifest_version: 2 },
      { ...manifest, version: 2 },
      { ...manifest, key: 3 },
    ]) {
      await writeFile(join(directory, 'manifest.json'), JSON.stringify(value));
      expect(await installedExtension(root, 'dev')).toBeNull();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
