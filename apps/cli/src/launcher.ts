import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isMissing, rejectLinks } from './install-files.js';

async function readPrevious(target: string): Promise<Buffer | undefined> {
  try {
    return await readFile(target);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function replace(target: string, content: Buffer): Promise<void> {
  await rejectLinks(target);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Caller holds the installation lock and has verified ownership of the program directory. */
export async function installLauncher(
  source: string,
  target: string,
): Promise<() => Promise<void>> {
  await rejectLinks(source);
  await rejectLinks(target);
  const candidate = await readFile(source);
  const previous = await readPrevious(target);
  await replace(target, candidate);
  let restored = false;
  return async () => {
    if (restored) return;
    await rejectLinks(target);
    if (!(await readFile(target)).equals(candidate)) {
      throw new Error(
        'Launcher changed after installation; refusing to overwrite it during recovery',
      );
    }
    if (previous) await replace(target, previous);
    else await rm(target);
    restored = true;
  };
}
