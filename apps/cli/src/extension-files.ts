import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  extensionId,
  type ReleaseChannel,
} from '../../../packages/protocol/environment.js';
import { assertPayload, isMissing, rejectLinks } from './install-files.js';
const owner = 'avru-extension-v1';

export async function validateExtension(
  source: string,
  channel: ReleaseChannel,
): Promise<void> {
  await assertPayload(source);
  const manifest: unknown = JSON.parse(
    await readFile(join(source, 'manifest.json'), 'utf8'),
  );
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    !('manifest_version' in manifest) ||
    manifest.manifest_version !== 3 ||
    !('key' in manifest) ||
    typeof manifest.key !== 'string' ||
    !('version' in manifest) ||
    typeof manifest.version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version)
  )
    throw new Error('Invalid extension manifest');
  const id = createHash('sha256')
    .update(Buffer.from(manifest.key, 'base64'))
    .digest('hex')
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (digit) =>
      String.fromCharCode(97 + parseInt(digit, 16)),
    );
  if (id !== extensionId(channel))
    throw new Error('Extension channel identity mismatch');
}

/** Caller holds the environment installation lock. Never loads or enables an extension. */
export async function prepareExtension(
  root: string,
  source: string,
  channel: ReleaseChannel,
) {
  await validateExtension(source, channel);
  const target = join(root, 'extension');
  await rejectLinks(target);
  let previous = true;
  try {
    await lstat(target);
  } catch (error) {
    if (!isMissing(error)) throw error;
    previous = false;
  }
  if (previous) {
    if ((await readFile(join(target, '.avru-owned'), 'utf8')) !== owner)
      throw new Error('Unknown extension directory owner');
    await assertPayload(target);
  }
  const candidate = join(root, `.extension-staging-${randomUUID()}`);
  const backup = join(root, `.extension-backup-${randomUUID()}`);
  await cp(source, candidate, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  await writeFile(join(candidate, '.avru-owned'), owner, {
    flag: 'wx',
    mode: 0o600,
  });
  let activated = false;
  return {
    async activate() {
      if (previous) await rename(target, backup);
      try {
        await rename(candidate, target);
        activated = true;
      } catch (error) {
        if (previous) await rename(backup, target);
        throw error;
      }
    },
    async rollback() {
      if (activated) {
        await rm(target, { recursive: true });
        if (previous) await rename(backup, target);
      }
      await rm(candidate, { recursive: true, force: true });
    },
  };
}
