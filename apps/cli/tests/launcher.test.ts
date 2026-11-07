import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installLauncher } from '../src/launcher.js';

const roots: string[] = [];
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'avru-launcher-'));
  roots.push(root);
  const source = join(root, 'source.mjs');
  const target = join(root, 'launcher.mjs');
  await writeFile(source, 'new launcher');
  return { root, source, target };
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('transactional stable launcher', () => {
  it('installs atomically, restores old bytes and supports repeated undo', async () => {
    const { root, source, target } = await setup();
    await writeFile(target, 'previous launcher');
    const undo = await installLauncher(source, target);
    expect(await readFile(target, 'utf8')).toBe('new launcher');
    await undo();
    await undo();
    expect(await readFile(target, 'utf8')).toBe('previous launcher');
    expect(await readdir(root)).toEqual(['launcher.mjs', 'source.mjs']);
  });
  it('removes a newly installed launcher on rollback', async () => {
    const { source, target } = await setup();
    const undo = await installLauncher(source, target);
    await undo();
    await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('does not overwrite a launcher changed by someone else during recovery', async () => {
    const { source, target } = await setup();
    const undo = await installLauncher(source, target);
    await writeFile(target, 'external change');
    await expect(undo()).rejects.toThrow('changed after installation');
    expect(await readFile(target, 'utf8')).toBe('external change');
  });
  it('does not change an existing launcher when the source is missing', async () => {
    const { source, target } = await setup();
    await writeFile(target, 'previous launcher');
    await rm(source);
    await expect(installLauncher(source, target)).rejects.toThrow();
    expect(await readFile(target, 'utf8')).toBe('previous launcher');
  });
  it('rejects an existing directory target', async () => {
    const { source, target } = await setup();
    await mkdir(target);
    await expect(installLauncher(source, target)).rejects.toThrow();
  });
  it('propagates write failure and leaves no temporary artifact', async () => {
    const { root, source } = await setup();
    await expect(
      installLauncher(source, join(root, 'missing', 'launcher.mjs')),
    ).rejects.toThrow();
    expect(await readdir(root)).toEqual(['source.mjs']);
  });
  it.skipIf(process.platform === 'win32')(
    'rejects symbolic links in source and target',
    async () => {
      const { root, source, target } = await setup();
      const link = join(root, 'link');
      await symlink(source, link);
      await expect(installLauncher(link, target)).rejects.toThrow(
        'Symbolic link',
      );
      await symlink(source, target);
      await expect(installLauncher(source, target)).rejects.toThrow(
        'Symbolic link',
      );
      expect(await readFile(source, 'utf8')).toBe('new launcher');
    },
  );
});
