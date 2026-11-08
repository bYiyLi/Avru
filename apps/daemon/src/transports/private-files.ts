import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, win32 } from 'node:path';
import { randomUUID } from 'node:crypto';
const execute = promisify(execFile);
export async function restrictPrivate(
  path: string,
  directory = false,
  platform = process.platform,
): Promise<void> {
  if (platform !== 'win32') {
    await chmod(path, directory ? 0o700 : 0o600);
    return;
  }
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (!systemRoot || !win32.isAbsolute(systemRoot))
    throw new Error('private_permissions_failed');
  const systemDirectory = win32.join(systemRoot, 'System32');
  const { stdout } = await execute(
    win32.join(systemDirectory, 'whoami.exe'),
    ['/user', '/fo', 'csv', '/nh'],
    { windowsHide: true },
  );
  const sid = /S-1-\d+(?:-\d+)+/.exec(stdout)?.[0];
  if (!sid) throw new Error('private_permissions_failed');
  const icacls = win32.join(systemDirectory, 'icacls.exe');
  await execute(icacls, [path, '/reset'], { windowsHide: true });
  await execute(
    icacls,
    [
      path,
      '/inheritance:r',
      '/grant:r',
      `*${sid}:${directory ? '(OI)(CI)F' : 'F'}`,
    ],
    { windowsHide: true },
  );
}
export async function ownedDirectory(root: string): Promise<string> {
  const path = join(root, 'connection');
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error('unsafe_connection_path');
  await restrictPrivate(path, true);
  return path;
}
export async function noLink(path: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error('unsafe_connection_path');
  } catch (error) {
    if (!missing(error)) throw error;
  }
}
export function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
export async function readPrivate(path: string): Promise<string | undefined> {
  await noLink(path);
  try {
    const info = await lstat(path);
    if (process.platform === 'win32') await restrictPrivate(path);
    if (
      info.size > 262144 ||
      (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
    )
      throw new Error('unsafe_connection_file');
    return await readFile(path, 'utf8');
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
}
export async function writePrivate(path: string, body: string): Promise<void> {
  await noLink(path);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, body, { flag: 'wx', mode: 0o600 });
    await restrictPrivate(temporary);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
export async function removePrivate(path: string): Promise<void> {
  await noLink(path);
  await rm(path, { force: true });
}
