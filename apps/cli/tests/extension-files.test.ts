import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { prepareExtension, validateExtension } from '../src/extension-files.js';
const roots: string[] = [];
const keys = JSON.parse(
  await readFile('apps/extension/manifest-keys.json', 'utf8'),
) as Record<'dev' | 'prod', string>;
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'extension-'));
  roots.push(root);
  const source = join(root, 'source');
  await mkdir(source);
  await writeFile(
    join(source, 'manifest.json'),
    JSON.stringify({ manifest_version: 3, version: '0.0.1', key: keys.dev }),
  );
  return { root, source };
}
it('keeps a stable path, rolls back updates and removes an unactivated candidate', async () => {
  const { root, source } = await fixture();
  const first = await prepareExtension(root, source, 'dev');
  await first.activate();
  const target = join(root, 'extension/manifest.json');
  const original = await readFile(target, 'utf8');
  await writeFile(
    join(source, 'manifest.json'),
    original.replace('0.0.1', '0.0.2'),
  );
  const update = await prepareExtension(root, source, 'dev');
  await update.activate();
  expect(await readFile(target, 'utf8')).toContain('0.0.2');
  await update.rollback();
  expect(await readFile(target, 'utf8')).toBe(original);
  const unused = await prepareExtension(root, source, 'dev');
  await unused.rollback();
  expect(await readFile(target, 'utf8')).toBe(original);
});
it('rolls back a first install without modifying unrelated files', async () => {
  const { root, source } = await fixture();
  await writeFile(join(root, 'user-data'), 'preserved');
  const tx = await prepareExtension(root, source, 'dev');
  await tx.activate();
  await tx.rollback();
  await expect(
    readFile(join(root, 'extension/manifest.json')),
  ).rejects.toThrow();
  expect(await readFile(join(root, 'user-data'), 'utf8')).toBe('preserved');
});
it('rejects cross-channel manifests, malformed inputs and unknown directory owners', async () => {
  const { root, source } = await fixture();
  await expect(validateExtension(source, 'prod')).rejects.toThrow('identity');
  for (const manifest of [
    null,
    {},
    { manifest_version: 2 },
    { manifest_version: 3, key: 1 },
    { manifest_version: 3, key: keys.dev, version: 'dev' },
  ]) {
    await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest));
    await expect(validateExtension(source, 'dev')).rejects.toThrow('Invalid');
  }
  await writeFile(
    join(source, 'manifest.json'),
    JSON.stringify({ manifest_version: 3, key: keys.dev, version: '0.0.1' }),
  );
  await mkdir(join(root, 'extension'));
  await writeFile(join(root, 'extension/.avru-owned'), 'not ours');
  await expect(prepareExtension(root, source, 'dev')).rejects.toThrow('owner');
});
it('restores previous directory if candidate activation fails', async () => {
  const { root, source } = await fixture();
  const first = await prepareExtension(root, source, 'dev');
  await first.activate();
  const update = await prepareExtension(root, source, 'dev');
  // Removing only this test-created staging candidate simulates an interrupted filesystem operation.
  const { readdir } = await import('node:fs/promises');
  for (const name of await readdir(root))
    if (name.startsWith('.extension-'))
      await rm(join(root, name), { recursive: true });
  await expect(update.activate()).rejects.toThrow();
  expect(await readFile(join(root, 'extension/.avru-owned'), 'utf8')).toBe(
    'avru-extension-v1',
  );
});
