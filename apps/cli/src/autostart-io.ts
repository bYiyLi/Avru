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

export async function inspectAutostart(
  options: AutostartOptions,
): Promise<'configured' | 'missing' | 'unknown'> {
  try {
    const plan = planAutostart(options);
    if (!(await inspectManaged(plan.filePath))) return 'missing';
    return (await readFile(plan.filePath, 'utf8')) === plan.content
      ? 'configured'
      : 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function verifyAutostart(
  options: AutostartOptions,
  expected: 'configured' | 'missing' | 'unknown',
): Promise<void> {
  const current = await inspectAutostart(options);
  if (current === 'unknown' || expected === 'unknown')
    throw Object.assign(
      new Error('Autostart ownership could not be verified'),
      {
        code: 'AVRU_AUTOSTART_UNVERIFIED',
      },
    );
  if (current !== expected)
    throw Object.assign(new Error('Autostart changed since inspection'), {
      code: 'AVRU_STATE_CHANGED',
    });
}

/** Writes the next-login entry; does not invoke launchctl or start a process. */
export async function enableAutostart(
  options: AutostartOptions,
  beforeWrite?: () => Promise<void>,
): Promise<AutostartPlan> {
  const plan = planAutostart(options);
  const exists = await inspectManaged(plan.filePath);
  await beforeWrite?.();
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
  beforeRemove?: () => Promise<void>,
): Promise<void> {
  const { filePath } = planAutostart(options);
  const exists = await inspectManaged(filePath);
  await beforeRemove?.();
  if (exists) await unlink(filePath);
}
