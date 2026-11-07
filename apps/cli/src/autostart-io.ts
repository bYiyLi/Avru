import { lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { autostartMarker, planAutostart } from './autostart.js';
import type { AutostartOptions, AutostartPlan } from './autostart.js';

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function inspectManaged(filePath: string): Promise<boolean> {
  try {
    const stat = await lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('Refusing to modify a non-regular autostart file');
    }
    const content = await readFile(filePath, 'utf8');
    if (!content.includes(autostartMarker)) {
      throw new Error('Existing autostart file is not managed by Avru');
    }
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

/** Writes the next-login entry; does not invoke launchctl or start a process. */
export async function enableAutostart(
  options: AutostartOptions,
): Promise<AutostartPlan> {
  const plan = planAutostart(options);
  const exists = await inspectManaged(plan.filePath);
  await mkdir(dirname(plan.filePath), { recursive: true });
  await writeFile(plan.filePath, plan.content, {
    encoding: 'utf8',
    mode: 0o600,
    flag: exists ? 'w' : 'wx',
  });
  return plan;
}

/** Removes only an Avru-owned next-login entry, preserving unrelated files. */
export async function disableAutostart(
  options: AutostartOptions,
): Promise<void> {
  const { filePath } = planAutostart(options);
  if (await inspectManaged(filePath)) await unlink(filePath);
}
