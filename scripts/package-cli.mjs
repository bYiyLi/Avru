import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { releaseChannel } from '../packages/protocol/environment.js';
import { cp, mkdir, writeFile, rm } from 'node:fs/promises';
import { obfuscationPlugin } from './release/obfuscate.mjs';
import { collectLicenses } from './release/licenses.mjs';
import { verifyPackage } from './release/verify.mjs';
const metas = [];
const out = 'artifacts/avru';
await rm(out, { recursive: true, force: true });
await mkdir(`${out}/payload`, { recursive: true });
const common = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  sourcemap: false,
  minify: true,
  metafile: true,
};
metas.push(
  (
    await build({
      ...common,
      entryPoints: ['apps/cli/src/main.ts'],
      outfile: `${out}/cli.mjs`,
      format: 'esm',
      banner: {
        js: '#!/usr/bin/env node\nimport {createRequire as __createRequire} from "node:module";const require=__createRequire(import.meta.url);',
      },
    })
  ).metafile,
);
metas.push(
  (
    await build({
      ...common,
      entryPoints: ['apps/cli/src/background.ts'],
      outfile: `${out}/launcher.mjs`,
      format: 'esm',
      banner: {
        js: 'import {createRequire as __createRequire} from "node:module";const require=__createRequire(import.meta.url);',
      },
    })
  ).metafile,
);
metas.push(
  (
    await build({
      ...common,
      entryPoints: ['apps/daemon/src/main.ts'],
      plugins: [obfuscationPlugin],
      outfile: `${out}/payload/daemon.cjs`,
      format: 'cjs',
    })
  ).metafile,
);
await cp(`${out}/launcher.mjs`, `${out}/payload/launcher.mjs`);
await cp('apps/web/dist', `${out}/payload/web`, { recursive: true });
await cp(
  `apps/extension/.output/${releaseChannel()}/chrome-mv3`,
  `${out}/payload/extension`,
  { recursive: true },
);
await writeFile(
  `${out}/package.json`,
  JSON.stringify(
    {
      name: 'avru',
      version: '0.1.0-dev.1',
      private: true,
      type: 'module',
      bin: { avru: 'cli.mjs' },
      engines: { node: '>=24.22.1 <25' },
      files: [
        'cli.mjs',
        'launcher.mjs',
        'payload',
        'THIRD_PARTY_NOTICES.txt',
        'README.md',
      ],
    },
    null,
    2,
  ) + '\n',
);
const web = await build({
  entryPoints: ['apps/web/src/main.tsx'],
  bundle: true,
  write: false,
  metafile: true,
  outdir: 'artifacts/license-analysis',
  loader: { '.css': 'css' },
});
metas.push(web.metafile);
const extension = await build({
  entryPoints: [
    'apps/extension/entrypoints/background.ts',
    'apps/extension/entrypoints/popup/main.ts',
    'apps/extension/entrypoints/consent/main.ts',
  ],
  bundle: true,
  write: false,
  metafile: true,
  outdir: 'artifacts/extension-license-analysis',
  external: ['wxt/browser'],
  loader: { '.css': 'css' },
});
metas.push(extension.metafile);
// WXT's generated bootstrap bundles its browser API shim.
const browserShim = await build({
  entryPoints: ['wxt/browser'],
  absWorkingDir: fileURLToPath(new URL('../apps/extension/', import.meta.url)),
  bundle: true,
  write: false,
  metafile: true,
});
metas.push({
  inputs: Object.fromEntries(
    Object.entries(browserShim.metafile.inputs).map(([path, value]) => [
      `apps/extension/${path}`,
      value,
    ]),
  ),
});
await writeFile(`${out}/THIRD_PARTY_NOTICES.txt`, await collectLicenses(metas));
await writeFile(
  `${out}/README.md`,
  'Avru 0.1.0-dev.1 private test package. Windows/macOS, Node >=24.22.1 <25.\nLocal CLI/daemon/Web only. Includes prebuilt browser extension; user must manually Load unpacked from the stable installation directory. QuickJS and remote transport setup are not included.\nNot a public npm release. Bundling and obfuscation are not secrecy guarantees.\n',
);
await verifyPackage(out);
console.log('Local package prepared; no npm publication performed.');
