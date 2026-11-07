import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
async function packageRoot(input) {
  let dir = dirname(resolve(input));
  while (dir !== dirname(dir)) {
    try {
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
      if (pkg.name && pkg.version) return { dir, pkg };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    dir = dirname(dir);
  }
  throw new Error(`Cannot identify bundled dependency: ${input}`);
}
async function licenseText(id, dir) {
  const names = (await readdir(dir)).filter((name) =>
    /^(licen[sc]e|copying|notice)(\.|$|-)/i.test(name),
  );
  const texts = [];
  for (const name of names) {
    if ((await stat(join(dir, name))).isFile())
      texts.push(await readFile(join(dir, name), 'utf8'));
  }
  if (!texts.length) texts.push(await overrideLicense(id));
  return texts.join('\n\n');
}
async function overrideLicense(id) {
  const names = {
    'abstract-logging@2.0.1': 'abstract-logging-2.0.1',
    '@wxt-dev/browser@0.3.7': 'wxt-browser-0.3.7',
    'wxt@0.21.5': 'wxt-0.21.5',
  };
  const name = names[id];
  if (!name) throw new Error(`Missing third-party license: ${id}`);
  const root = 'scripts/release/license-overrides';
  const metadata = JSON.parse(
    await readFile(join(root, `${name}.json`), 'utf8'),
  );
  const text = await readFile(join(root, `${name}.LICENSE.txt`), 'utf8');
  const sha = createHash('sha256').update(text).digest('hex');
  if (
    `${metadata.package}@${metadata.version}` !== id ||
    sha !== metadata.sha256
  )
    throw new Error('License override identity/integrity mismatch');
  return text;
}
export async function collectLicenses(metafiles) {
  const roots = new Map();
  const inputs = new Set(metafiles.flatMap((meta) => Object.keys(meta.inputs)));
  for (const input of inputs) {
    if (!input.includes('node_modules/')) continue;
    const value = await packageRoot(input);
    roots.set(`${value.pkg.name}@${value.pkg.version}`, value);
  }
  const sections = [];
  for (const [id, { dir, pkg }] of [...roots].sort()) {
    sections.push(
      `## ${id}\nDeclared license: ${pkg.license ?? 'unspecified'}\n\n${await licenseText(id, dir)}`,
    );
  }
  if (!sections.length) throw new Error('No third-party licenses collected');
  return (
    '# Third-party notices\n\nThese licenses apply to bundled dependencies, not Avru source.\n\n' +
    sections.join('\n\n')
  );
}
