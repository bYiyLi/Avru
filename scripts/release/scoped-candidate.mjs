import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { verifyPackage } from './verify.mjs';

// Only re-identify the previously reviewed archive; never rebuild current main.
await import('./verify-stage.mjs');
const root = 'artifacts/stage-inspect';
const manifest = JSON.parse(await readFile(`${root}/package.json`, 'utf8'));
const files = await verifyPackage(root, 'npm-dev');
const original = new Map(
  await Promise.all(
    files.map(async (file) => [file, await readFile(`${root}/${file}`)]),
  ),
);
manifest.name = '@avru/setup';
await writeFile(
  `${root}/package.json`,
  JSON.stringify(manifest, null, 2) + '\n',
);
await writeFile(
  `${root}/README.md`,
  (await readFile(`${root}/README.md`, 'utf8')).replace(
    'npx -y avru@dev',
    'npx -y @avru/setup@dev',
  ),
);
await mkdir('artifacts/scoped-distribution', { recursive: true });
const result = JSON.parse(
  execFileSync(
    'npm',
    [
      'pack',
      './' + root,
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      'artifacts/scoped-distribution',
    ],
    { encoding: 'utf8', shell: process.platform === 'win32' },
  ),
);
if (
  result.length !== 1 ||
  result[0].name !== '@avru/setup' ||
  result[0].version !== '0.1.0-dev.1'
)
  throw Error('Wrong scoped identity');
if (
  result[0].files
    .map((x) => x.path)
    .sort()
    .join('\n') !== files.join('\n')
)
  throw Error('Package file set changed');
for (const file of files) {
  if (file === 'package.json' || file === 'README.md') continue;
  if (!original.get(file).equals(await readFile(`${root}/${file}`)))
    throw Error(`Payload changed: ${file}`);
}
const file = result[0].filename;
const bytes = await readFile(`artifacts/scoped-distribution/${file}`);
const sha256 = createHash('sha256').update(bytes).digest('hex');
await writeFile(
  'artifacts/scoped-distribution/scoped-release.json',
  JSON.stringify(
    {
      name: manifest.name,
      version: manifest.version,
      tag: 'dev',
      file,
      sha256,
      shasum: result[0].shasum,
      integrity: result[0].integrity,
      sourceArchiveSha256:
        'aa76c1e620b0a817c79f1c82476aab6570d013f25b6641425679e51b43fe3b39',
      changedFiles: ['package.json', 'README.md'],
      extensionIncluded: false,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Scoped candidate ${file} sha256:${sha256}; payload and license bytes unchanged.`,
);
