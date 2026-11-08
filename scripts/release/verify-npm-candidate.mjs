import { readFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { sha256 } from './frpc-integrity.mjs';
import { verifyPackage } from './verify.mjs';
const root = 'artifacts/npm-distribution';
const file = 'avru-setup-0.1.0-dev.1.tgz';
const record = JSON.parse(await readFile(`${root}/release.json`, 'utf8'));
const expected = process.env.AVRU_EXPECTED_SHA256;
if (
  !expected ||
  !/^[a-f0-9]{64}$/.test(expected) ||
  record.sha256 !== expected ||
  record.sourceCommit !== process.env.AVRU_EXPECTED_SOURCE ||
  record.run !== process.env.AVRU_EXPECTED_RUN ||
  record.packageName !== '@avru/setup' ||
  record.version !== '0.1.0-dev.1' ||
  record.channel !== 'dev' ||
  record.extensionIncluded !== true ||
  record.frpcVersion !== '0.72.0' ||
  record.publishedToNpm !== false ||
  record.platform !== 'macOS' ||
  sha256(await readFile(`${root}/${file}`)) !== expected ||
  (await readFile(`${root}/SHA256SUMS`, 'utf8')).trim() !==
    `${expected}  ${file}`
)
  throw new Error('Candidate identity or checksum mismatch');
const listing = execFileSync('tar', ['-tf', `${root}/${file}`], {
  encoding: 'utf8',
})
  .trim()
  .split(/\r?\n/);
if (
  listing.some(
    (path) =>
      !path.startsWith('package/') ||
      path.includes('..') ||
      path.includes('\\'),
  )
)
  throw new Error('Unsafe candidate archive');
const types = execFileSync('tar', ['-tvf', `${root}/${file}`], {
  encoding: 'utf8',
})
  .trim()
  .split(/\r?\n/);
if (types.some((line) => !/^[d-]/.test(line)))
  throw new Error('Linked candidate archive');
await rm('artifacts/avru', { recursive: true, force: true });
await mkdir('artifacts/avru', { recursive: true });
execFileSync('tar', [
  '-xf',
  `${root}/${file}`,
  '-C',
  'artifacts/avru',
  '--strip-components=1',
]);
await verifyPackage('artifacts/avru', 'npm-scoped-dev');
console.log(
  'Verified the exact scoped candidate and embedded assets; no executable run.',
);
