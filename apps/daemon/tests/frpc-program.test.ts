import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { frpcAsset } from '../../../packages/protocol/frpc-assets.js';
import { verifiedProgram } from '../src/transports/frpc-program.js';
it('checks the pinned executable bytes before launch and rejects corrupt or linked programs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'avru-native-'));
  const asset = frpcAsset();
  const directory = join(root, 'frpc', asset.id);
  const path = join(directory, asset.file);
  try {
    await mkdir(directory, { recursive: true });
    await expect(verifiedProgram(root)).rejects.toThrow();
    await writeFile(path, 'not an executable');
    await expect(verifiedProgram(root)).rejects.toThrow(
      'untrusted_frpc_program',
    );
    await cp(resolve('artifacts/frpc', asset.id, asset.file), path);
    expect(await verifiedProgram(root)).toBe(path);
    await rm(join(root, 'frpc'), { recursive: true });
    await symlink(
      resolve('artifacts/frpc'),
      join(root, 'frpc'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(verifiedProgram(root)).rejects.toThrow(
      'untrusted_frpc_program',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
