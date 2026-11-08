import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { removeConnectionData } from '../src/connection-cleanup.js';
it('purges only the enumerated Avru connection files, retaining unrelated files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'avru-purge-'));
  try {
    await removeConnectionData(root);
    const dir = join(root, 'connection');
    await mkdir(dir);
    await writeFile(join(dir, 'configuration.json'), 'private');
    await writeFile(join(dir, 'notes'), 'preserve');
    await removeConnectionData(root);
    await expect(readFile(join(dir, 'configuration.json'))).rejects.toThrow();
    expect(await readFile(join(dir, 'notes'), 'utf8')).toBe('preserve');
    await rm(join(dir, 'notes'));
    await removeConnectionData(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
