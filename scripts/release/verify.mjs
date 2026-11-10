import { readdir, readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  frpcAssets,
  FRPC_VERSION,
} from '../../packages/protocol/frpc-assets.js';
import {
  verifyFrpc,
  verifyFrpcLicense,
  verifyFrpcNotices,
} from './frpc-integrity.mjs';
const exact = new Set([
  'cli.mjs',
  'launcher.mjs',
  'package.json',
  'THIRD_PARTY_NOTICES.txt',
  'README.md',
  'payload/daemon.cjs',
  'payload/runner/worker.mjs',
  'payload/runner/dist/worker.js',
  'payload/runner/dist/emscripten-module.wasm',
  'payload/launcher.mjs',
  'payload/release.json',
  'payload/frpc/LICENSE',
  'payload/frpc/NOTICES.txt',
  ...frpcAssets.map((asset) => `payload/frpc/${asset.id}/${asset.file}`),
  'payload/web/index.html',
  'payload/extension/manifest.json',
  'payload/extension/background.js',
  'payload/extension/consent.html',
  'payload/extension/content-scripts/visual.js',
  'payload/extension/_locales/en/messages.json',
  'payload/extension/_locales/zh_CN/messages.json',
  'payload/extension/_locales/zh_TW/messages.json',
]);
export async function verifyPackage(root, channel = 'private') {
  await verifyIdentity(root, channel);
  const files = [];
  async function walk(dir, prefix = '') {
    for (const name of await readdir(dir)) {
      const path = prefix + name;
      const info = await lstat(join(dir, name));
      if (info.isSymbolicLink()) throw new Error(`Symlink prohibited: ${path}`);
      if (info.isDirectory()) await walk(join(dir, name), `${path}/`);
      else files.push(path);
    }
  }
  await walk(root);
  for (const path of files) await verifyFile(root, path);
  for (const path of exact)
    if (!files.includes(path)) throw new Error(`Missing package file: ${path}`);
  return files.sort();
}
async function verifyIdentity(root, channel) {
  const manifest = JSON.parse(
    await readFile(join(root, 'package.json'), 'utf8'),
  );
  const release = JSON.parse(
    await readFile(join(root, 'payload/release.json'), 'utf8'),
  );
  if (
    manifest.name !== (channel === 'npm-scoped-dev' ? '@avru/setup' : 'avru') ||
    manifest.version !== release.version ||
    release.frpcVersion !== FRPC_VERSION ||
    (release.channel === 'prod'
      ? channel !== 'private' || release.version !== '0.1.0'
      : release.channel !== 'dev' || release.version !== '0.1.0-dev.1') ||
    (channel === 'private'
      ? manifest.private !== true
      : !['npm-dev', 'npm-scoped-dev'].includes(channel) ||
        manifest.private !== false ||
        manifest.publishConfig?.tag !== 'dev' ||
        manifest.publishConfig?.access !== 'public' ||
        manifest.publishConfig?.registry !== 'https://registry.npmjs.org/' ||
        manifest.repository?.url !== 'git+https://github.com/bYiyLi/Avru.git')
  )
    throw new Error('Unexpected release identity or publication guard');
}
async function verifyFile(root, path) {
  if (
    !exact.has(path) &&
    !/^payload\/web\/assets\/[\w-]+\.(js|css)$/.test(path) &&
    !/^payload\/extension\/(?:chunks|assets)\/[\w-]+\.(js|css)$/.test(path) &&
    !/^payload\/extension\/_locales\/(?:en|zh_CN|zh_TW)\/messages\.json$/.test(
      path,
    )
  )
    throw new Error(`Unexpected package file: ${path}`);
  if (path.startsWith('payload/frpc/')) {
    await verifyNative(root, path);
    return;
  }
  if (path === 'payload/runner/dist/emscripten-module.wasm') {
    const bytes = await readFile(join(root, path));
    if (
      createHash('sha256').update(bytes).digest('hex') !==
      '105c3bed22d457e43e3d1c3c1c6959fda62a8fe06f0fc8a985303c3a2be72232'
    )
      throw new Error('QuickJS WASM digest mismatch');
    return;
  }
  const body = await readFile(join(root, path), 'utf8');
  if (
    /sourceMappingURL|sourcesContent|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}/.test(
      body,
    )
  )
    throw new Error(`Prohibited package content: ${path}`);
  if (
    /\.(?:m?js|cjs)$/.test(path) &&
    /\/workspace\/|\/home\/agent\/|apps\/(?:daemon|cli)\/src\//.test(body)
  )
    throw new Error(`Source path in executable: ${path}`);
}
async function verifyNative(root, path) {
  const bytes = await readFile(join(root, path));
  if (path.endsWith('/LICENSE')) verifyFrpcLicense(bytes);
  else if (path.endsWith('/NOTICES.txt')) verifyFrpcNotices(bytes);
  else {
    const asset = frpcAssets.find(
      (item) => path === `payload/frpc/${item.id}/${item.file}`,
    );
    if (!asset) throw new Error('Unexpected native asset');
    verifyFrpc(bytes, asset.id);
  }
}
