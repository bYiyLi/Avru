import {
  mkdtemp,
  rm,
  writeFile,
  readFile,
  symlink,
  mkdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  defaultDataRoot,
  runtimeChannel,
  runtimePort,
  verifyDataRoot,
} from '../src/environment.js';
it('binds the runtime build, paths and ports to its channel', () => {
  expect(runtimeChannel(undefined)).toBe('dev');
  expect(runtimeChannel('dev')).toBe('dev');
  expect(() => runtimeChannel('prod')).toThrow();
  expect(runtimePort('dev')).toBe(43822);
  expect(runtimePort('prod')).toBe(43821);
  for (const value of ['43821', '80', '65536', 'no'])
    expect(() => runtimePort('dev', value)).toThrow();
  expect(runtimePort('dev', '45000')).toBe(45000);
  expect(defaultDataRoot('/users/a', 'darwin')).toContain('/users/a/Avru/dev');
  expect(defaultDataRoot('/users/a', 'linux')).toContain(
    '.local/share/Avru/dev',
  );
  expect(defaultDataRoot('C:\\Users\\a', 'win32')).toContain(
    'C:\\Users\\a\\Avru\\dev',
  );
});
it('rejects legacy and cross-channel roots without changing data', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'avru-channel-'));
  try {
    await verifyDataRoot(join(dir, 'dev'), 'dev');
    await verifyDataRoot(join(dir, 'dev'), 'dev');
    await expect(verifyDataRoot(join(dir, 'dev'), 'prod')).rejects.toThrow();
    expect(await readFile(join(dir, 'dev', '.avru-channel'), 'utf8')).toBe(
      'dev',
    );
    await writeFile(join(dir, 'legacy.sqlite'), 'preserve');
    await expect(verifyDataRoot(dir, 'dev')).rejects.toThrow();
    expect(await readFile(join(dir, 'legacy.sqlite'), 'utf8')).toBe('preserve');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('refuses linked state before opening the other environment database', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'avru-linked-'));
  try {
    const dev = join(dir, 'dev');
    await verifyDataRoot(dev, 'dev');
    const prodRoot = join(dir, 'prod');
    await mkdir(prodRoot);
    const prod = join(prodRoot, 'browsers.sqlite');
    await writeFile(prod, 'prod preserved');
    // Directory junctions require no Windows symlink privilege.
    await symlink(prodRoot, join(dev, 'browsers.sqlite'), 'junction');
    await expect(verifyDataRoot(dev, 'dev')).rejects.toThrow(
      'Linked Avru state',
    );
    expect(await readFile(prod, 'utf8')).toBe('prod preserved');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
