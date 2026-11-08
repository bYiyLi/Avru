import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  disableAutostart,
  enableAutostart,
  inspectAutostart,
  verifyAutostart,
} from '../src/autostart-io.js';
import { planAutostart } from '../src/autostart.js';

const roots: string[] = [];
async function options() {
  const home = await mkdtemp(join(tmpdir(), 'avru-autostart-'));
  roots.push(home);
  return {
    platform:
      process.platform === 'win32' ? ('win32' as const) : ('darwin' as const),
    home,
    execPath: process.execPath,
    launcherPath: join(home, 'launcher.cjs'),
  };
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('autostart managed files in temporary directories', () => {
  it('rejects unknown ownership and changes since the user inspected the state', async () => {
    const opts = await options();
    await expect(verifyAutostart(opts, 'missing')).resolves.toBeUndefined();
    await expect(verifyAutostart(opts, 'configured')).rejects.toMatchObject({
      code: 'AVRU_STATE_CHANGED',
    });
    const plan = await enableAutostart(opts);
    await expect(verifyAutostart(opts, 'configured')).resolves.toBeUndefined();
    await expect(verifyAutostart(opts, 'missing')).rejects.toMatchObject({
      code: 'AVRU_STATE_CHANGED',
    });
    await expect(verifyAutostart(opts, 'unknown')).rejects.toMatchObject({
      code: 'AVRU_AUTOSTART_UNVERIFIED',
    });
    await writeFile(plan.filePath, 'foreign startup');
    await expect(verifyAutostart(opts, 'configured')).rejects.toMatchObject({
      code: 'AVRU_AUTOSTART_UNVERIFIED',
    });
    expect(await readFile(plan.filePath, 'utf8')).toBe('foreign startup');
  });
  it('checks ownership again immediately before replacing or removing an entry', async () => {
    const opts = await options();
    const other = await enableAutostart({
      ...opts,
      launcherPath: join(opts.home, 'other-installation', 'launcher.cjs'),
    });
    await expect(
      enableAutostart(opts, () => verifyAutostart(opts, 'missing')),
    ).rejects.toMatchObject({ code: 'AVRU_AUTOSTART_UNVERIFIED' });
    await expect(
      disableAutostart(opts, () => verifyAutostart(opts, 'configured')),
    ).rejects.toMatchObject({ code: 'AVRU_AUTOSTART_UNVERIFIED' });
    expect(await readFile(other.filePath, 'utf8')).toBe(other.content);
  });
  it('does not overwrite a startup entry created after the ownership check', async () => {
    const opts = await options();
    const { filePath } = planAutostart(opts);
    await expect(
      enableAutostart(opts, async () => {
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, 'another installation');
      }),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(filePath, 'utf8')).toBe('another installation');
  });
  it('creates, updates and removes a managed file, and removal is idempotent', async () => {
    const opts = await options();
    expect(await inspectAutostart(opts)).toBe('missing');
    const first = await enableAutostart(opts);
    expect(await inspectAutostart(opts)).toBe('configured');
    expect(await readFile(first.filePath, 'utf8')).toBe(first.content);
    const update = await enableAutostart({
      ...opts,
      execPath: join(opts.home, 'node'),
    });
    expect(await readFile(first.filePath, 'utf8')).toBe(update.content);
    expect(await inspectAutostart(opts)).toBe('unknown');
    await disableAutostart(opts);
    await expect(readFile(first.filePath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await disableAutostart(opts);
  });
  it('never overwrites or deletes a foreign file', async () => {
    const opts = await options();
    const { filePath } = planAutostart(opts);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, 'unrelated configuration');
    expect(await inspectAutostart(opts)).toBe('unknown');
    await expect(enableAutostart(opts)).rejects.toThrow('not managed');
    await expect(disableAutostart(opts)).rejects.toThrow('not managed');
    expect(await readFile(filePath, 'utf8')).toBe('unrelated configuration');
  });
  it('refuses directories at the managed filename', async () => {
    const opts = await options();
    const { filePath } = planAutostart(opts);
    await mkdir(filePath, { recursive: true });
    await expect(enableAutostart(opts)).rejects.toThrow('non-regular');
  });
  it.skipIf(process.platform === 'win32')(
    'refuses symbolic links without changing their target',
    async () => {
      const opts = await options();
      const { filePath } = planAutostart(opts);
      const target = join(opts.home, 'target');
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(target, 'foreign');
      await symlink(target, filePath);
      await expect(enableAutostart(opts)).rejects.toThrow('non-regular');
      expect(await readFile(target, 'utf8')).toBe('foreign');
    },
  );
  it('propagates filesystem errors rather than claiming success', async () => {
    const opts = await options();
    await writeFile(
      join(opts.home, process.platform === 'win32' ? 'AppData' : 'Library'),
      'not a directory',
    );
    await expect(enableAutostart(opts)).rejects.toThrow();
  });
});
