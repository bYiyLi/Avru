import {
  mkdtemp,
  writeFile,
  mkdir,
  rm,
  symlink,
  chmod,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  ownedDirectory,
  writePrivate,
  readPrivate,
  removePrivate,
  noLink,
  missing,
} from '../src/transports/private-files.js';
it('keeps owned connection files private and atomic and preserves unrelated content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'avru-private-'));
  try {
    const directory = await ownedDirectory(root);
    const path = join(directory, 'configuration.json');
    expect(await readPrivate(path)).toBeUndefined();
    await writePrivate(path, 'first');
    await writePrivate(path, 'second');
    expect(await readPrivate(path)).toBe('second');
    await removePrivate(path);
    expect(await readPrivate(path)).toBeUndefined();
    await writeFile(path, 'x'.repeat(262145));
    await expect(readPrivate(path)).rejects.toThrow();
    await rm(path);
    await mkdir(path);
    await expect(noLink(path)).rejects.toThrow();
    await rm(path, { recursive: true });
    if (process.platform !== 'win32') {
      await symlink(join(root, 'outside'), path);
      await expect(writePrivate(path, 'no')).rejects.toThrow();
      await rm(path);
      await writePrivate(path, 'private');
      await chmod(path, 0o644);
      await expect(readPrivate(path)).rejects.toThrow();
    }
    expect(missing(null)).toBe(false);
    const linked = join(root, 'linked');
    await mkdir(linked);
    await symlink(
      directory,
      join(linked, 'connection'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(ownedDirectory(linked)).rejects.toThrow(
      'unsafe_connection_path',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
