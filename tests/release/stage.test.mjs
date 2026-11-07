import assert from 'node:assert/strict';
import { mkdtemp, cp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

test('staging checks exact source, dev metadata and tarball checksum', async () => {
  const root = await mkdtemp(join(tmpdir(), 'avru-stage-'));
  const verifier = resolve('scripts/release/verify-stage.mjs');
  const input = join(root, 'artifacts/stage-input');
  try {
    await mkdir(input, { recursive: true });
    await cp('artifacts/avru', join(root, 'package'), { recursive: true });
    const manifestPath = join(root, 'package/package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.private = false;
    manifest.repository = { url: 'git+https://github.com/bYiyLi/Avru.git' };
    manifest.publishConfig = {
      tag: 'dev',
      access: 'public',
      registry: 'https://registry.npmjs.org/',
    };
    await writeFile(manifestPath, JSON.stringify(manifest));
    const file = 'avru-0.1.0-dev.1.tgz';
    execFileSync('tar', ['-czf', `artifacts/stage-input/${file}`, 'package'], {
      cwd: root,
    });
    const hash = createHash('sha256')
      .update(await readFile(join(input, file)))
      .digest('hex');
    const record = {
      sourceCommit: '2f87b5a7407b0ff266a8b28b73c87fbd48590fa9',
      run: '42394455061',
      platform: 'macOS',
      version: '0.1.0-dev.1',
      channel: 'dev',
      publishedToNpm: false,
      sha256: hash,
    };
    await writeFile(join(input, 'release.json'), JSON.stringify(record));
    await writeFile(join(input, 'SHA256SUMS'), `${hash}  ${file}\n`);
    assert.match(
      execFileSync(process.execPath, [verifier], {
        cwd: root,
        encoding: 'utf8',
      }),
      /Verified/,
    );
    record.sourceCommit = 'unapproved';
    await writeFile(join(input, 'release.json'), JSON.stringify(record));
    assert.throws(() =>
      execFileSync(process.execPath, [verifier], { cwd: root, stdio: 'pipe' }),
    );
    record.sourceCommit = '2f87b5a7407b0ff266a8b28b73c87fbd48590fa9';
    await writeFile(join(input, 'release.json'), JSON.stringify(record));
    await writeFile(join(input, file), 'tampered');
    assert.throws(() =>
      execFileSync(process.execPath, [verifier], { cwd: root, stdio: 'pipe' }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
