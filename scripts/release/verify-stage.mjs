import { readFile, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { verifyPackage } from './verify.mjs';

const dir = 'artifacts/stage-input';
const file = 'avru-0.1.0-dev.1.tgz';
const record = JSON.parse(await readFile(`${dir}/release.json`, 'utf8'));
if (
  record.sourceCommit !== '2f87b5a7407b0ff266a8b28b73c87fbd48590fa9' ||
  record.run !== '42394455061' ||
  record.version !== '0.1.0-dev.1' ||
  record.channel !== 'dev' ||
  record.publishedToNpm !== false ||
  record.platform !== 'macOS'
)
  throw new Error('Unapproved candidate identity');
const hash = createHash('sha256')
  .update(await readFile(`${dir}/${file}`))
  .digest('hex');
if (
  hash !== record.sha256 ||
  (await readFile(`${dir}/SHA256SUMS`, 'utf8')).trim() !== `${hash}  ${file}`
) {
  throw new Error('Candidate checksum mismatch');
}
const entries = execFileSync('tar', ['-tzf', `${dir}/${file}`], {
  encoding: 'utf8',
})
  .trim()
  .split('\n');
if (
  entries.some(
    (path) =>
      !path.startsWith('package/') ||
      path.includes('..') ||
      path.includes('\\'),
  )
) {
  throw new Error('Unsafe archive path');
}
const types = execFileSync('tar', ['-tvzf', `${dir}/${file}`], {
  encoding: 'utf8',
})
  .trim()
  .split('\n');
if (types.some((line) => !['-', 'd'].includes(line[0])))
  throw new Error('Archive links prohibited');
const target = 'artifacts/stage-inspect';
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
execFileSync('tar', [
  '-xzf',
  `${dir}/${file}`,
  '-C',
  target,
  '--strip-components=1',
]);
await verifyPackage(target, 'npm-dev');
console.log(`Verified ${file} sha256:${hash}; no npm upload performed.`);
