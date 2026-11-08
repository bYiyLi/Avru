import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, posix, win32 } from 'node:path';
import { isMissing, rejectLinks } from './install-files.js';

import type { ReleaseChannel } from '../../../packages/protocol/environment.js';
export type { ReleaseChannel } from '../../../packages/protocol/environment.js';
export const channelMarker = '.avru-channel';

export function defaultDataRoot(options: {
  platform: string;
  home: string;
  channel: ReleaseChannel;
  custom?: string;
}): string {
  const paths = options.platform === 'win32' ? win32 : posix;
  if (options.custom) {
    if (!paths.isAbsolute(options.custom))
      throw new Error('AVRU_DATA_DIR must be absolute');
    return options.custom;
  }
  return paths.join(options.home, 'Avru', options.channel);
}

/** Previous unpublished layout, used only to refuse silently leaving an old installation running. */
export function previousDataRoot(options: {
  platform: string;
  home: string;
  channel: ReleaseChannel;
  localAppData?: string;
}): string {
  if (options.platform === 'win32')
    return win32.join(
      options.localAppData ?? win32.join(options.home, 'AppData', 'Local'),
      'Avru',
      options.channel,
    );
  return posix.join(
    options.home,
    'Library',
    'Application Support',
    'Avru',
    options.channel,
  );
}

export async function readRootChannel(root: string): Promise<ReleaseChannel> {
  const path = join(root, channelMarker);
  await rejectLinks(path);
  const value = await readFile(path, 'utf8');
  if (value !== 'dev' && value !== 'prod')
    throw new Error('Invalid Avru channel marker');
  return value;
}

/** Caller holds the root installation lock. Never adopts existing unmarked data. */
export async function claimRoot(
  root: string,
  channel: ReleaseChannel,
): Promise<void> {
  try {
    if ((await readRootChannel(root)) !== channel)
      throw new Error('Avru channel mismatch; use a separate data directory');
    return;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const entries = await readdir(root);
  if (entries.some((entry) => entry !== '.install.lock')) {
    throw new Error(
      'Unmarked legacy Avru data: stop the old installation and back up the directory before explicit migration; no data was adopted',
    );
  }
  await writeFile(join(root, channelMarker), channel, {
    flag: 'wx',
    mode: 0o600,
  });
}

/** Do not leave an old default installation running invisibly beside the new layout. */
export async function rejectLegacyDefault(
  home: string,
  previous?: string,
): Promise<void> {
  for (const legacy of [join(home, '.avru'), ...(previous ? [previous] : [])])
    await rejectPrevious(legacy);
}
async function rejectPrevious(legacy: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(legacy);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  if (
    entries.some((name) =>
      ['program', 'runtime.json', 'browsers.sqlite'].includes(name),
    )
  ) {
    throw new Error(
      'Legacy Avru installation detected: stop the old daemon, remove its old Avru startup entry, and back up its data before migrating to ~/Avru. The new installation needs fresh browser pairing; no data or authorization was moved.',
    );
  }
}
