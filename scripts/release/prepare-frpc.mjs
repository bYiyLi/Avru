import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { frpcAssets } from '../../packages/protocol/frpc-assets.js';
import {
  sha256,
  verifyFrpc,
  verifyFrpcLicense,
  verifyFrpcNotices,
} from './frpc-integrity.mjs';
const root = 'artifacts/frpc';
const cache = 'artifacts/frpc-downloads';
await mkdir(cache, { recursive: true });
await mkdir(root, { recursive: true });
for (const asset of frpcAssets) await prepare(asset);
const notices = await readFile(new URL('./frpc-licenses.txt', import.meta.url));
verifyFrpcNotices(notices);
await writeFile(join(root, 'NOTICES.txt'), notices);
async function prepare(asset) {
  const path = join(cache, asset.archive);
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(
      `https://github.com/fatedier/frp/releases/download/v0.72.0/${asset.archive}`,
    );
    if (!response.ok) throw new Error('FRPC download failed', { cause: error });
    bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== asset.archiveSha256)
      throw new Error('FRPC archive mismatch', { cause: error });
    await writeFile(path, bytes, { flag: 'wx' });
  }
  if (sha256(bytes) !== asset.archiveSha256)
    throw new Error('FRPC archive mismatch');
  const prefix = `frp_0.72.0_${asset.id.replace('-', '_')}`;
  const program = execFileSync(
    'tar',
    ['-xOf', path, `${prefix}/${asset.file}`],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  const license = execFileSync('tar', ['-xOf', path, `${prefix}/LICENSE`]);
  verifyFrpc(program, asset.id);
  verifyFrpcLicense(license);
  await mkdir(join(root, asset.id), { recursive: true });
  await writeFile(join(root, asset.id, asset.file), program, { mode: 0o700 });
  await writeFile(join(root, 'LICENSE'), license);
  console.log(
    `Prepared and statically verified FRPC ${asset.id}; no executable run.`,
  );
}
