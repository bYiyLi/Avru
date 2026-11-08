import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReleaseChannel } from './channel-root.js';
import { readRootChannel } from './channel-root.js';
import type { AutostartOptions } from './autostart.js';
import { inspectAutostart } from './autostart-io.js';
import {
  isMissing,
  readActive,
  readOwnedProgram,
  rejectLinks,
} from './install-files.js';
import type { ActiveRelease } from './install-files.js';
import { inspectRuntime } from './runtime.js';

export interface InstallationState {
  root: string;
  channel: ReleaseChannel;
  packageVersion: string;
  active: ActiveRelease | undefined;
  programPresent: boolean;
  service: 'running' | 'not_detected' | 'unknown';
  autostart: 'configured' | 'missing' | 'unknown';
  retainedData: boolean;
}
export interface InspectionOptions {
  root: string;
  channel: ReleaseChannel;
  packageVersion: string;
  autostart: AutostartOptions;
}

async function rootExists(
  root: string,
  channel: ReleaseChannel,
): Promise<boolean> {
  await rejectLinks(root);
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
  if (entries.includes('.install.lock'))
    throw Object.assign(new Error('检测到其他安装操作，请先确认该操作已结束'), {
      code: 'AVRU_INSTALL_BUSY',
    });
  try {
    if ((await readRootChannel(root)) !== channel)
      throw Object.assign(
        new Error('Avru 环境不匹配，请使用对应环境的安装目录'),
        { code: 'AVRU_CHANNEL_MISMATCH' },
      );
  } catch (error) {
    if (!isMissing(error)) throw error;
    if (entries.length > 0)
      throw Object.assign(
        new Error('安装目录归属无法确认，请先检查并备份原有数据'),
        { code: 'AVRU_ROOT_UNOWNED' },
      );
  }
  return true;
}

async function retainedData(root: string): Promise<boolean> {
  for (const relative of [
    'browsers.sqlite',
    'browsers.sqlite-wal',
    'browsers.sqlite-shm',
    'connection/configuration.json',
    'connection/process.json',
    'connection/frpc.json',
    'connection/ca.pem',
    'connection/certificate.pem',
    'connection/key.pem',
  ]) {
    const path = join(root, relative);
    await rejectLinks(path);
    try {
      if ((await lstat(path)).isFile()) return true;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  return false;
}

async function serviceState(
  root: string,
  channel: ReleaseChannel,
): Promise<InstallationState['service']> {
  const descriptor = join(root, 'runtime.json');
  await rejectLinks(descriptor);
  try {
    if (!(await lstat(descriptor)).isFile()) return 'unknown';
  } catch (error) {
    if (isMissing(error)) return 'not_detected';
    throw error;
  }
  return (await inspectRuntime(root, channel)) ? 'running' : 'unknown';
}

export async function inspectInstallation(
  options: InspectionOptions,
): Promise<InstallationState> {
  const exists = await rootExists(options.root, options.channel);
  const program = exists ? await readOwnedProgram(options.root) : undefined;
  const active = program ? await readActive(program) : undefined;
  const service = exists
    ? await serviceState(options.root, options.channel)
    : 'not_detected';
  return {
    root: options.root,
    channel: options.channel,
    packageVersion: options.packageVersion,
    active,
    programPresent: program !== undefined,
    service: !active && service !== 'not_detected' ? 'unknown' : service,
    autostart: await inspectAutostart({
      ...options.autostart,
      execPath: active?.execPath ?? options.autostart.execPath,
    }),
    retainedData: exists && (await retainedData(options.root)),
  };
}
