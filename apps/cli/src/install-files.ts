import {
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface ActiveRelease {
  release: string;
  version: string;
  execPath: string;
}
export function isSystemAlias(
  path: string,
  target: string,
  platform: string,
): boolean {
  return (
    platform === 'darwin' &&
    ['/var', '/tmp', '/etc'].includes(path) &&
    target === `/private${path}`
  );
}
export async function rejectLinks(path: string): Promise<void> {
  const absolute = resolve(path);
  let cursor = parse(absolute).root;
  for (const part of absolute
    .slice(cursor.length)
    .split(/[\\/]/)
    .filter(Boolean)) {
    cursor = join(cursor, part);
    try {
      const entry = await lstat(cursor);
      if (
        cursor !== absolute &&
        !entry.isDirectory() &&
        !entry.isSymbolicLink()
      )
        throw new Error(`Parent path is not a directory: ${cursor}`);
      if (
        entry.isSymbolicLink() &&
        !isSystemAlias(
          cursor,
          resolve(dirname(cursor), await readlink(cursor)),
          process.platform,
        )
      )
        throw new Error(`Symbolic link is not allowed: ${cursor}`);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
}
export function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
export async function assertPayload(path: string): Promise<void> {
  await rejectLinks(path);
  for (const item of await readdir(path, { withFileTypes: true })) {
    if (item.isSymbolicLink())
      throw new Error('Payload must not contain symbolic links');
    if (item.isDirectory()) await assertPayload(join(path, item.name));
    else if (!item.isFile()) throw new Error('Payload contains a special file');
  }
}
export async function readActive(
  program: string,
): Promise<ActiveRelease | undefined> {
  try {
    await rejectLinks(join(program, 'active.json'));
    const value: unknown = JSON.parse(
      await readFile(join(program, 'active.json'), 'utf8'),
    );
    if (
      !value ||
      typeof value !== 'object' ||
      !('release' in value) ||
      typeof value.release !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(value.release) ||
      !('version' in value) ||
      typeof value.version !== 'string' ||
      !('execPath' in value) ||
      typeof value.execPath !== 'string' ||
      !isAbsolute(value.execPath)
    ) {
      throw new Error('Invalid active installation record');
    }
    return {
      release: value.release,
      version: value.version,
      execPath: value.execPath,
    };
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}
export async function writeActive(
  program: string,
  value: ActiveRelease | undefined,
): Promise<void> {
  const path = join(program, 'active.json');
  await rejectLinks(path);
  if (!value) {
    await rm(path, { force: true });
    return;
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), {
    mode: 0o600,
    flag: 'wx',
  });
  await rename(temporary, path);
}
export async function lockRoot(root: string): Promise<() => Promise<void>> {
  const absolute = resolve(root);
  if (dirname(absolute) === absolute)
    throw new Error('Installation root must not be filesystem root');
  await rejectLinks(absolute);
  await mkdir(absolute, { recursive: true, mode: 0o700 });
  const path = join(absolute, '.install.lock');
  const handle = await open(path, 'wx', 0o600);
  await handle.writeFile(
    JSON.stringify({ pid: process.pid, started: new Date().toISOString() }),
  );
  return async () => {
    await handle.close();
    await rm(path);
  };
}
export async function ownedProgram(root: string): Promise<string> {
  const program = join(root, 'program');
  await rejectLinks(program);
  const marker = join(program, '.avru-owned');
  await rejectLinks(marker);
  try {
    if ((await readFile(marker, 'utf8')) !== 'avru-program-v1')
      throw new Error('Unknown installation owner');
  } catch (error) {
    if (!isMissing(error)) throw error;
    try {
      await lstat(program);
    } catch (missing) {
      if (!isMissing(missing)) throw missing;
      await mkdir(program, { mode: 0o700 });
      await writeFile(marker, 'avru-program-v1', { mode: 0o600, flag: 'wx' });
      return program;
    }
    throw new Error('Refusing to modify an unowned program directory', {
      cause: error,
    });
  }
  return program;
}
