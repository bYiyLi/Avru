import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { install, uninstall } from '../src/install.js';
import {
  assertPayload,
  isSystemAlias,
  lockRoot,
  ownedProgram,
  readActive,
  rejectLinks,
  writeActive,
} from '../src/install-files.js';
const manifestKeys = JSON.parse(
  await readFile('apps/extension/manifest-keys.json', 'utf8'),
) as Record<'dev' | 'prod', string>;
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
  roots.length = 0;
});
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'avru-install-'));
  roots.push(base);
  const root = join(base, 'avru');
  const sourceRoot = join(base, 'payload');
  await mkdir(join(sourceRoot, 'web'), { recursive: true });
  await writeFile(join(sourceRoot, 'daemon.cjs'), '// payload');
  await writeFile(join(sourceRoot, 'web/index.html'), 'web');
  await mkdir(join(sourceRoot, 'extension'));
  await writeFile(
    join(sourceRoot, 'extension/manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      version: '0.0.1',
      key: manifestKeys.dev,
    }),
  );
  const hooks = {
    stop: vi.fn<() => Promise<void>>().mockResolvedValue(),
    start: vi
      .fn<() => Promise<string>>()
      .mockResolvedValue('http://127.0.0.1:43821/#key=private'),
    autostart: vi.fn<() => Promise<void>>().mockResolvedValue(),
    open: vi.fn<() => Promise<void>>().mockResolvedValue(),
  };
  return {
    root,
    sourceRoot,
    version: '0.1.0',
    execPath: process.execPath,
    hooks,
  };
}
it('installs a stable payload, repairs and upgrades preserving data', async () => {
  const options = await fixture();
  const first = await install(options);
  expect(first.mode).toBe('install');
  expect(first.browserOpened).toBe(true);
  expect(
    await readFile(
      join(
        options.root,
        'program/releases',
        first.active.release,
        'daemon.cjs',
      ),
      'utf8',
    ),
  ).toBe('// payload');
  await writeFile(join(options.root, 'browsers.sqlite'), 'preserved');
  expect((await install(options)).mode).toBe('repair');
  options.version = '0.2.0';
  options.hooks.open.mockRejectedValue(new Error('browser unavailable'));
  expect(await install(options)).toMatchObject({
    mode: 'update',
    browserOpened: false,
  });
  expect(await readFile(join(options.root, 'browsers.sqlite'), 'utf8')).toBe(
    'preserved',
  );
});
it('rolls back a failed candidate and restarts the previous release', async () => {
  const options = await fixture();
  const first = await install(options);
  options.hooks.start.mockRejectedValueOnce(new Error('failed start'));
  await expect(install(options)).rejects.toThrow('failed start');
  expect(await readActive(join(options.root, 'program'))).toEqual(first.active);
  expect(options.hooks.start).toHaveBeenLastCalledWith(first.active);
});
it('first-install failure leaves no active pointer and can be retried', async () => {
  const options = await fixture();
  options.hooks.autostart.mockRejectedValueOnce(
    new Error('registration failed'),
  );
  await expect(install(options)).rejects.toThrow('registration failed');
  expect(await readActive(join(options.root, 'program'))).toBeUndefined();
  await expect(install(options)).resolves.toMatchObject({ mode: 'install' });
});
it('uninstall defaults to retaining data and removes only known files when requested', async () => {
  const options = await fixture();
  await install(options);
  await writeFile(join(options.root, 'browsers.sqlite'), 'data');
  await writeFile(join(options.root, 'notes.txt'), 'keep');
  const hooks = {
    stop: options.hooks.stop,
    removeAutostart: vi.fn<() => Promise<void>>().mockResolvedValue(),
  };
  await uninstall({ root: options.root, hooks });
  expect(await readFile(join(options.root, 'browsers.sqlite'), 'utf8')).toBe(
    'data',
  );
  await install(options);
  await uninstall({ root: options.root, hooks, removeData: true });
  await expect(
    readFile(join(options.root, 'browsers.sqlite')),
  ).rejects.toThrow();
  expect(await readFile(join(options.root, 'notes.txt'), 'utf8')).toBe('keep');
});
it('rejects concurrent runs, invalid payload/runtime and unowned directories', async () => {
  const options = await fixture();
  const release = await lockRoot(options.root);
  await expect(install(options)).rejects.toThrow();
  await release();
  await expect(install({ ...options, execPath: 'node' })).rejects.toThrow(
    'Runtime',
  );
  await expect(install({ ...options, version: ' ' })).rejects.toThrow(
    'Runtime',
  );
  await rm(join(options.sourceRoot, 'daemon.cjs'));
  await expect(install(options)).rejects.toThrow();
  await mkdir(join(options.sourceRoot, 'daemon.cjs'));
  await expect(install(options)).rejects.toThrow('Incomplete');
  await rm(join(options.root, 'program/.avru-owned'));
  await expect(ownedProgram(options.root)).rejects.toThrow('unowned');
  await writeFile(join(options.root, 'program/.avru-owned'), 'wrong');
  await expect(ownedProgram(options.root)).rejects.toThrow('Unknown');
});
it('validates pointer contents and filesystem ownership', async () => {
  const options = await fixture();
  await install(options);
  const program = join(options.root, 'program');
  await writeFile(join(program, 'active.json'), '{}');
  await expect(readActive(program)).rejects.toThrow('Invalid');
  await writeFile(join(program, 'active.json'), '{');
  await expect(readActive(program)).rejects.toThrow();
  await expect(lockRoot('/')).rejects.toThrow('filesystem root');
  await expect(
    rejectLinks(join(options.sourceRoot, 'daemon.cjs', 'child')),
  ).rejects.toThrow();
});
it('rejects links in root and payload without following them', async () => {
  const options = await fixture();
  const linked = join(options.sourceRoot, 'link');
  await symlink(options.sourceRoot, linked, 'junction');
  await expect(assertPayload(options.sourceRoot)).rejects.toThrow('symbolic');
  await expect(rejectLinks(linked)).rejects.toThrow('Symbolic');
  await expect(lockRoot(linked)).rejects.toThrow('Symbolic');
});
it('fails closed if stop or unregister fails', async () => {
  const options = await fixture();
  const first = await install(options);
  options.hooks.stop.mockRejectedValueOnce(new Error('cannot stop'));
  await expect(install(options)).rejects.toThrow('cannot stop');
  expect(await readActive(join(options.root, 'program'))).toEqual(first.active);
  await expect(
    uninstall({
      root: options.root,
      hooks: {
        stop: options.hooks.stop,
        removeAutostart: () => Promise.reject(new Error('cannot unregister')),
      },
    }),
  ).rejects.toThrow('cannot unregister');
  expect(await readActive(join(options.root, 'program'))).toEqual(first.active);
  await writeActive(join(options.root, 'program'), undefined);
});

it('recognizes only canonical macOS filesystem aliases', () => {
  expect(isSystemAlias('/var', '/private/var', 'darwin')).toBe(true);
  expect(isSystemAlias('/tmp', '/private/tmp', 'darwin')).toBe(true);
  expect(isSystemAlias('/var', '/private/var', 'linux')).toBe(false);
  expect(isSystemAlias('/var', '/malicious', 'darwin')).toBe(false);
  expect(isSystemAlias('/custom', '/private/custom', 'darwin')).toBe(false);
});
it('keeps candidate untouched when spawned process exit is unconfirmed', async () => {
  const options = await fixture();
  const first = await install(options);
  options.hooks.start.mockRejectedValueOnce(
    Object.assign(new Error('unknown exit'), {
      code: 'AVRU_PROCESS_EXIT_UNCONFIRMED',
    }),
  );
  await expect(install(options)).rejects.toThrow('unknown exit');
  const current = await readActive(join(options.root, 'program'));
  expect(current?.release).not.toBe(first.active.release);
  expect(options.hooks.start).toHaveBeenCalledTimes(2);
  expect(options.hooks.stop).toHaveBeenCalledTimes(2);
});
it('rejects linked active records and release directories', async () => {
  const options = await fixture();
  await install(options);
  const program = join(options.root, 'program');
  const record = await readFile(join(program, 'active.json'));
  await rm(join(program, 'active.json'));
  await writeFile(join(options.root, 'saved.json'), record);
  // Directory junctions are supported without elevated privileges on Windows.
  await rm(join(program, 'releases'), { recursive: true });
  await symlink(options.sourceRoot, join(program, 'releases'), 'junction');
  await expect(install(options)).rejects.toThrow('Symbolic');
  await rm(join(program, 'releases'));
  await symlink(options.sourceRoot, join(program, 'active.json'), 'junction');
  await expect(readActive(program)).rejects.toThrow('Symbolic');
  await expect(writeActive(program, undefined)).rejects.toThrow('Symbolic');
  await rm(join(program, 'active.json'));
  await mkdir(join(options.root, 'records'));
  await writeFile(join(options.root, 'records', 'active.json'), record);
  await rm(join(program, '.avru-owned'));
  await symlink(
    join(options.root, 'records'),
    join(program, '.avru-owned'),
    'junction',
  );
  await expect(ownedProgram(options.root)).rejects.toThrow('Symbolic');
});
