import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import {
  extensionId,
  type ReleaseChannel,
} from '../../../packages/protocol/environment.js';
import { record } from './messages.js';

export interface InstalledExtension {
  directory: string;
  version: string;
  extensionId: string;
}
/** Reports prepared files, never proof of installation or a running browser version. */
export async function installedExtension(
  root: string,
  channel: ReleaseChannel,
): Promise<InstalledExtension | null> {
  const directory = resolve(root, 'extension');
  try {
    for (const path of [
      directory,
      resolve(directory, 'manifest.json'),
      resolve(directory, '.avru-owned'),
    ]) {
      if ((await lstat(path)).isSymbolicLink()) return null;
    }
    if (
      (await readFile(resolve(directory, '.avru-owned'), 'utf8')) !==
      'avru-extension-v1'
    )
      return null;
    const manifest: unknown = JSON.parse(
      await readFile(resolve(directory, 'manifest.json'), 'utf8'),
    );
    if (
      !record(manifest) ||
      manifest.manifest_version !== 3 ||
      typeof manifest.version !== 'string' ||
      typeof manifest.key !== 'string'
    )
      return null;
    const id = createHash('sha256')
      .update(Buffer.from(manifest.key, 'base64'))
      .digest('hex')
      .slice(0, 32)
      .replace(/[0-9a-f]/g, (digit) =>
        String.fromCharCode(97 + parseInt(digit, 16)),
      );
    if (id !== extensionId(channel)) return null;
    return { directory, version: manifest.version, extensionId: id };
  } catch {
    return null;
  }
}
