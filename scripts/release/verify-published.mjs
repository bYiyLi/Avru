import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { sha256 } from './frpc-integrity.mjs';
import { verifyPackage } from './verify.mjs';
const response = await fetch('https://registry.npmjs.org/@avru%2fsetup');
if (!response.ok) throw new Error('Published registry metadata unavailable');
const data = await response.json();
const version = data.versions?.['0.1.0-dev.1'];
if (
  data['dist-tags']?.dev !== '0.1.0-dev.1' ||
  !version?.dist ||
  new URL(version.dist.tarball).origin !== 'https://registry.npmjs.org'
)
  throw new Error('Published version or dev tag mismatch');
const archive = await fetch(version.dist.tarball);
if (!archive.ok) throw new Error('Published archive unavailable');
const bytes = Buffer.from(await archive.arrayBuffer());
if (
  sha256(bytes) !== process.env.AVRU_EXPECTED_SHA256 ||
  version.dist.integrity !==
    `sha512-${createHash('sha512').update(bytes).digest('base64')}`
)
  throw new Error('Published integrity mismatch; do not republish');
const directory = 'artifacts/registry';
await mkdir(directory, { recursive: true });
await writeFile(`${directory}/setup.tgz`, bytes);
execFileSync('tar', ['-xf', `${directory}/setup.tgz`, '-C', directory]);
await verifyPackage(`${directory}/package`, 'npm-scoped-dev');
const output = execFileSync(
  process.execPath,
  [`${directory}/package/cli.mjs`, '--version'],
  { encoding: 'utf8' },
).trim();
if (output !== '0.1.0-dev.1') throw new Error('Published CLI version mismatch');
console.log(
  'Registry dev tag, exact archive integrity, embedded assets and CLI version verified.',
);
