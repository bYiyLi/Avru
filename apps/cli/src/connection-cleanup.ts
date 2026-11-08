import { rmdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isMissing, rejectLinks } from './install-files.js';
export async function removeConnectionData(root: string): Promise<void> {
  const directory = join(root, 'connection');
  await rejectLinks(directory);
  for (const name of [
    'configuration.json',
    'process.json',
    'frpc.json',
    'ca.pem',
    'certificate.pem',
    'key.pem',
  ]) {
    const path = join(directory, name);
    await rejectLinks(path);
    await rm(path, { force: true });
  }
  try {
    await rmdir(directory);
  } catch (error) {
    if (
      !isMissing(error) &&
      !(error instanceof Error && 'code' in error && error.code === 'ENOTEMPTY')
    )
      throw error;
  }
}
