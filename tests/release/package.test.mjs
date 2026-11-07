import assert from 'node:assert/strict';
import { mkdtemp, cp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifyPackage } from '../../scripts/release/verify.mjs';

test('candidate whitelist and negative leakage probes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'avru-release-'));
  try {
    await cp('artifacts/avru', dir, { recursive: true });
    assert.ok((await verifyPackage(dir)).length >= 10);
    for (const name of [
      'source.ts',
      'debug.map',
      '.env',
      'payload/web/assets/source.ts',
    ]) {
      await writeFile(join(dir, name), 'forbidden');
      await assert.rejects(verifyPackage(dir), /Unexpected package file/);
      await rm(join(dir, name));
    }
    await writeFile(
      join(dir, 'payload/web/assets/leak.js'),
      '//# sourceMappingURL=private.map',
    );
    await assert.rejects(verifyPackage(dir), /Prohibited package content/);
    await rm(join(dir, 'payload/web/assets/leak.js'));
    const manifestPath = join(dir, 'package.json');
    const manifest = await readFile(manifestPath, 'utf8');
    await writeFile(manifestPath, manifest.replace('0.1.0-dev.1', '0.1.0'));
    await assert.rejects(verifyPackage(dir), /Unexpected release identity/);
    await writeFile(manifestPath, manifest);
    await rm(join(dir, 'THIRD_PARTY_NOTICES.txt'));
    await assert.rejects(verifyPackage(dir), /Missing package file/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
