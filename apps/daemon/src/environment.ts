import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, posix, win32 } from 'node:path';
import {
  channelPort,
  releaseChannel,
} from '../../../packages/protocol/environment.js';
import type { ReleaseChannel } from '../../../packages/protocol/environment.js';

export function runtimeChannel(value: string | undefined): ReleaseChannel {
  const channel = releaseChannel();
  if (value !== undefined && value !== channel)
    throw new Error('Runtime channel does not match this build');
  return channel;
}
export function runtimePort(channel: ReleaseChannel, value?: string): number {
  const port = Number(value ?? channelPort(channel));
  if (
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    port === channelPort(channel === 'dev' ? 'prod' : 'dev')
  )
    throw new Error('Invalid or other-channel AVRU_PORT');
  return port;
}
async function rejectOwnedLinks(root: string): Promise<void> {
  for (const file of [
    '.avru-channel',
    'browsers.sqlite',
    'browsers.sqlite-wal',
    'browsers.sqlite-shm',
    'runtime.json',
    'daemon.log',
  ]) {
    try {
      if ((await lstat(join(root, file))).isSymbolicLink())
        throw new Error('Linked Avru state file');
    } catch (error) {
      if (!(
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ))
        throw error;
    }
  }
}
export async function verifyDataRoot(
  root: string,
  channel: ReleaseChannel,
): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await lstat(root)).isSymbolicLink()) throw new Error('Linked data root');
  await rejectOwnedLinks(root);
  const marker = join(root, '.avru-channel');
  const entries = await readdir(root);
  if (!entries.length)
    await writeFile(marker, channel, { flag: 'wx', mode: 0o600 });
  if (
    (await lstat(marker)).isSymbolicLink() ||
    (await readFile(marker, 'utf8')) !== channel
  )
    throw new Error(
      'Unowned or different-channel data directory; no automatic migration',
    );
}
export function defaultDataRoot(
  home: string,
  platform: string,
  localAppData?: string,
): string {
  if (platform === 'win32')
    return win32.resolve(
      localAppData ?? win32.join(home, 'AppData', 'Local'),
      'Avru',
      releaseChannel(),
    );
  if (platform === 'darwin')
    return posix.resolve(
      home,
      'Library',
      'Application Support',
      'Avru',
      releaseChannel(),
    );
  // Source development/CI only. Public installer rejects unsupported platforms.
  return posix.resolve(home, '.local', 'share', 'Avru', releaseChannel());
}
