import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const file = 'avru-setup-0.1.0-dev.1.tgz';
const root = 'artifacts/npm-distribution';
const bytes = await readFile(`${root}/${file}`);
const sha256 = createHash('sha256').update(bytes).digest('hex');
await writeFile(`${root}/SHA256SUMS`, `${sha256}  ${file}\n`);
await writeFile(
  `${root}/release.json`,
  JSON.stringify(
    {
      sourceCommit: process.env.GITHUB_SHA,
      run: process.env.GITHUB_RUN_ID,
      attempt: process.env.GITHUB_RUN_ATTEMPT,
      platform: 'macOS',
      version: '0.1.0-dev.1',
      channel: 'dev',
      publishedToNpm: false,
      packageName: '@avru/setup',
      extensionIncluded: true,
      frpcVersion: '0.72.0',
      sha256,
    },
    null,
    2,
  ),
);
if (process.env.GITHUB_OUTPUT)
  await appendFile(process.env.GITHUB_OUTPUT, `sha256=${sha256}\n`);
console.log(`Candidate recorded: ${sha256}; no publication performed.`);
