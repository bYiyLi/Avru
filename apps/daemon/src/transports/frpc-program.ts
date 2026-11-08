import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { frpcAsset } from '../../../../packages/protocol/frpc-assets.js';
export async function verifiedProgram(payloadRoot: string): Promise<string> {
  const asset = frpcAsset();
  const root = join(payloadRoot, 'frpc');
  const directory = join(root, asset.id);
  const path = join(directory, asset.file);
  for (const item of [root, directory, path]) {
    const info = await lstat(item);
    if (info.isSymbolicLink()) throw new Error('untrusted_frpc_program');
  }
  const bytes = await readFile(path);
  if (
    bytes.length !== asset.size ||
    createHash('sha256').update(bytes).digest('hex') !== asset.sha256
  )
    throw new Error('untrusted_frpc_program');
  return path;
}
