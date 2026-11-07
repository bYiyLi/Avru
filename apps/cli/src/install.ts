import { prepareExtension } from './extension-files.js';
import { releaseChannel } from '../../../packages/protocol/environment.js';
import { claimRoot, type ReleaseChannel } from './channel-root.js';
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  assertPayload,
  lockRoot,
  ownedProgram,
  readActive,
  rejectLinks,
  writeActive,
} from './install-files.js';
import type { ActiveRelease } from './install-files.js';
export type { ActiveRelease } from './install-files.js';

export interface InstallHooks {
  stop(): Promise<void>;
  start(active: ActiveRelease): Promise<string>;
  autostart(active: ActiveRelease): Promise<void>;
  open(url: string): Promise<void>;
}
export interface InstallOptions {
  root: string;
  channel?: ReleaseChannel;
  sourceRoot: string;
  version: string;
  execPath: string;
  hooks: InstallHooks;
}
export interface InstallResult {
  mode: 'install' | 'update' | 'repair';
  active: ActiveRelease;
  managementUrl: string;
  browserOpened: boolean;
}
async function stage(
  options: InstallOptions,
  program: string,
): Promise<ActiveRelease> {
  if (!isAbsolute(options.execPath) || !options.version.trim())
    throw new Error('Runtime path and version are required');
  await assertPayload(options.sourceRoot);
  if (
    !(await stat(join(options.sourceRoot, 'daemon.cjs'))).isFile() ||
    !(await stat(join(options.sourceRoot, 'web', 'index.html'))).isFile()
  )
    throw new Error('Incomplete installation payload');
  const active = {
    release: randomUUID(),
    version: options.version,
    execPath: options.execPath,
  };
  await rejectLinks(join(program, 'releases'));
  await mkdir(join(program, 'releases'), { recursive: true, mode: 0o700 });
  await cp(options.sourceRoot, join(program, 'releases', active.release), {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  return active;
}
async function activate(
  options: InstallOptions,
  program: string,
  active: ActiveRelease,
  previous: ActiveRelease | undefined,
): Promise<string> {
  const extension = await prepareExtension(
    options.root,
    join(program, 'releases', active.release, 'extension'),
    options.channel ?? releaseChannel(),
  );
  try {
    await options.hooks.stop();
  } catch (error) {
    await extension.rollback();
    throw error;
  }
  try {
    await extension.activate();
    await writeActive(program, active);
    const url = await options.hooks.start(active);
    await options.hooks.autostart(active);
    return url;
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'AVRU_PROCESS_EXIT_UNCONFIRMED'
    )
      throw error;
    // A failed stop leaves the candidate state intact rather than deleting a possibly running release.
    await options.hooks.stop();
    await extension.rollback();
    await writeActive(program, previous);
    if (previous) {
      await options.hooks.start(previous);
      await options.hooks.autostart(previous);
    }
    await rm(join(program, 'releases', active.release), { recursive: true });
    throw error;
  }
}
export async function install(options: InstallOptions): Promise<InstallResult> {
  const unlock = await lockRoot(options.root);
  try {
    await claimRoot(options.root, options.channel ?? releaseChannel());
    const program = await ownedProgram(options.root);
    const previous = await readActive(program);
    const active = await stage(options, program);
    const managementUrl = await activate(options, program, active, previous);
    let browserOpened = true;
    try {
      await options.hooks.open(managementUrl);
    } catch {
      browserOpened = false;
    }
    return {
      mode: previous
        ? previous.version === active.version
          ? 'repair'
          : 'update'
        : 'install',
      active,
      managementUrl,
      browserOpened,
    };
  } finally {
    await unlock();
  }
}
export interface UninstallOptions {
  root: string;
  channel?: ReleaseChannel;
  removeData?: boolean;
  hooks: { stop(): Promise<void>; removeAutostart(): Promise<void> };
}
export async function uninstall(options: UninstallOptions): Promise<void> {
  const unlock = await lockRoot(options.root);
  try {
    await claimRoot(options.root, options.channel ?? releaseChannel());
    const program = await ownedProgram(options.root);
    await options.hooks.stop();
    await options.hooks.removeAutostart();
    await rm(program, { recursive: true });
    if (options.removeData) {
      // Delete only Avru-owned database files, not arbitrary files under a caller-supplied root.
      for (const name of [
        'browsers.sqlite',
        'browsers.sqlite-wal',
        'browsers.sqlite-shm',
      ]) {
        const path = join(options.root, name);
        await rejectLinks(path);
        await rm(path, { force: true });
      }
    }
  } finally {
    await unlock();
  }
}
