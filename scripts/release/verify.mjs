import { readdir, readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
const exact = new Set([
  'cli.mjs',
  'launcher.mjs',
  'package.json',
  'THIRD_PARTY_NOTICES.txt',
  'README.md',
  'payload/daemon.cjs',
  'payload/launcher.mjs',
  'payload/web/index.html',
]);
export async function verifyPackage(root, channel = 'private') {
  const manifest = JSON.parse(
    await readFile(join(root, 'package.json'), 'utf8'),
  );
  if (
    manifest.name !== 'avru' ||
    manifest.version !== '0.1.0-dev.1' ||
    (channel === 'private'
      ? manifest.private !== true
      : channel !== 'npm-dev' ||
        manifest.private !== false ||
        manifest.publishConfig?.tag !== 'dev' ||
        manifest.publishConfig?.access !== 'public' ||
        manifest.publishConfig?.registry !== 'https://registry.npmjs.org/' ||
        manifest.repository?.url !== 'git+https://github.com/bYiyLi/Avru.git')
  )
    throw new Error('Unexpected release identity or publication guard');
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
  for (const path of files) {
    if (
      !exact.has(path) &&
      !/^payload\/web\/assets\/[\w-]+\.(js|css)$/.test(path)
    )
      throw new Error(`Unexpected package file: ${path}`);
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
  for (const path of exact)
    if (!files.includes(path)) throw new Error(`Missing package file: ${path}`);
  return files.sort();
}
