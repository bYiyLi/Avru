import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { releaseInfo } from '../src/release-info.js';
it('keeps the console versions aligned with actual release and extension build inputs', () => {
  const read = (path: string) => readFileSync(path, 'utf8');
  const manifest = read('apps/extension/wxt.config.ts');
  const packaging = read('scripts/package-cli.mjs');
  const cli = read('apps/cli/src/main.ts');
  expect(manifest).toContain(
    `version: '${releaseInfo.expectedExtensionVersion}'`,
  );
  expect(read('apps/extension/package.json')).toContain(
    `"version": "${releaseInfo.expectedExtensionVersion}"`,
  );
  expect(packaging).toContain(`version: '${releaseInfo.daemonVersion}'`);
  expect(cli).toContain(`version: '${releaseInfo.daemonVersion}'`);
});
