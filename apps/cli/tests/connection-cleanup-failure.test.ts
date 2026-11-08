import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import type * as Files from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { removeConnectionData } from '../src/connection-cleanup.js';
vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof Files>()),
  rmdir: () =>
    Promise.reject(
      Object.assign(new Error('permission denied'), { code: 'EACCES' }),
    ),
}));
it('reports an unsuccessful purge instead of claiming removal when directory permissions deny it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'avru-denied-purge-'));
  try {
    await mkdir(join(root, 'connection'));
    await expect(removeConnectionData(root)).rejects.toThrow(
      'permission denied',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
