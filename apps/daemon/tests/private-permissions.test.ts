import { expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { restrictPrivate } from '../src/transports/private-files.js';
const { command } = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  return { execFile: Object.assign(() => {}, { [promisify.custom]: command }) };
});
it('limits Windows connection files to the resolved current user SID and fails closed on missing identity', async () => {
  command.mockResolvedValue({
    stdout: '"user","S-1-5-21-123-456-1001"',
    stderr: '',
  });
  await restrictPrivate('C:\\Avru\\private', false, 'win32');
  expect(command).toHaveBeenLastCalledWith(
    'icacls.exe',
    [
      'C:\\Avru\\private',
      '/inheritance:r',
      '/grant:r',
      '*S-1-5-21-123-456-1001:F',
    ],
    { windowsHide: true },
  );
  await restrictPrivate('C:\\Avru\\directory', true, 'win32');
  expect(command).toHaveBeenLastCalledWith(
    'icacls.exe',
    expect.arrayContaining(['*S-1-5-21-123-456-1001:(OI)(CI)F']),
    expect.any(Object),
  );
  command.mockResolvedValueOnce({ stdout: 'unknown identity' });
  await expect(
    restrictPrivate('C:\\Avru\\private', false, 'win32'),
  ).rejects.toThrow('private_permissions_failed');
  command.mockRejectedValueOnce(new Error('access denied'));
  await expect(
    restrictPrivate('C:\\Avru\\private', false, 'win32'),
  ).rejects.toThrow();
  const root = await mkdtemp(join(tmpdir(), 'avru-permissions-'));
  try {
    await restrictPrivate(root, true, 'darwin');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
