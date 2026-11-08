import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { verifiedRun } from '../../scripts/release/verify-release-run.mjs';
function publicManifest(manifest) {
  return {
    ...manifest,
    name: '@avru/setup',
    private: false,
    repository: { url: 'git+https://github.com/bYiyLi/Avru.git' },
    publishConfig: {
      tag: 'dev',
      access: 'public',
      registry: 'https://registry.npmjs.org/',
    },
  };
}
test('publishing requires both platforms from the same successful main run and matching artifact', () => {
  const sha = 'a'.repeat(40);
  const run = {
    conclusion: 'success',
    head_branch: 'main',
    repository: { full_name: 'bYiyLi/Avru' },
    path: '.github/workflows/npm-dev-prepare.yml',
    head_sha: sha,
  };
  const jobs = ['macos-latest', 'windows-latest'].map((os) => ({
    name: `validate (${os})`,
    conclusion: 'success',
  }));
  const artifact = { expired: false, workflow_run: { id: 123, head_sha: sha } };
  assert.equal(verifiedRun(run, jobs, artifact, '123'), sha);
  for (const invalid of [
    { ...run, conclusion: 'failure' },
    { ...run, head_branch: 'other' },
    { ...run, head_sha: 'unreviewed' },
    { ...run, path: '.github/workflows/ci.yml' },
  ])
    assert.throws(() => verifiedRun(invalid, jobs, artifact, '123'));
  assert.throws(() => verifiedRun(run, jobs.slice(0, 1), artifact, '123'));
  assert.throws(() =>
    verifiedRun(run, jobs, { ...artifact, expired: true }, '123'),
  );
  assert.throws(() => verifiedRun(run, jobs, artifact, '124'));
});
test('canonical tarball verification rejects source drift, checksum drift and modified embedded binaries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'avru-canonical-'));
  const distribution = join(root, 'artifacts/npm-distribution');
  const verify = resolve('scripts/release/verify-npm-candidate.mjs');
  const file = 'avru-setup-0.1.0-dev.1.tgz';
  const env = {
    ...process.env,
    AVRU_EXPECTED_SOURCE: 'a'.repeat(40),
    AVRU_EXPECTED_RUN: '123',
  };
  try {
    await mkdir(distribution, { recursive: true });
    await cp('artifacts/avru', join(root, 'package'), { recursive: true });
    const path = join(root, 'package/package.json');
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify(publicManifest(manifest)));
    const pack = async () => {
      execFileSync(
        'tar',
        ['-czf', `artifacts/npm-distribution/${file}`, 'package'],
        { cwd: root },
      );
      const sha = createHash('sha256')
        .update(await readFile(join(distribution, file)))
        .digest('hex');
      await writeFile(join(distribution, 'SHA256SUMS'), `${sha}  ${file}\n`);
      await writeFile(
        join(distribution, 'release.json'),
        JSON.stringify({
          sourceCommit: env.AVRU_EXPECTED_SOURCE,
          run: '123',
          platform: 'macOS',
          packageName: '@avru/setup',
          version: '0.1.0-dev.1',
          channel: 'dev',
          extensionIncluded: true,
          frpcVersion: '0.72.0',
          publishedToNpm: false,
          sha256: sha,
        }),
      );
      return { ...env, AVRU_EXPECTED_SHA256: sha };
    };
    const selection = await pack();
    assert.match(
      execFileSync(process.execPath, [verify], {
        cwd: root,
        env: selection,
        encoding: 'utf8',
      }),
      /Verified/,
    );
    assert.throws(() =>
      execFileSync(process.execPath, [verify], {
        cwd: root,
        env: { ...selection, AVRU_EXPECTED_SOURCE: 'b'.repeat(40) },
        stdio: 'pipe',
      }),
    );
    await writeFile(join(distribution, file), 'tampered');
    assert.throws(() =>
      execFileSync(process.execPath, [verify], {
        cwd: root,
        env: selection,
        stdio: 'pipe',
      }),
    );
    await writeFile(
      join(root, 'package/payload/frpc/darwin-arm64/frpc'),
      'modified program',
    );
    const modified = await pack();
    assert.throws(() =>
      execFileSync(process.execPath, [verify], {
        cwd: root,
        env: modified,
        stdio: 'pipe',
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
