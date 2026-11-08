import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import {
  releaseChannel,
  RELEASE_VERSION,
} from '../packages/protocol/environment.js';
import { FRPC_VERSION } from '../packages/protocol/frpc-assets.js';
import { releaseIdentity } from './release/build-identity.mjs';
import { cp, mkdir, writeFile, rm } from 'node:fs/promises';
import { obfuscationPlugin } from './release/obfuscate.mjs';
import { collectLicenses } from './release/licenses.mjs';
import { verifyPackage } from './release/verify.mjs';
const metas = [];
const version = process.argv.includes('--prod') ? '0.1.0' : RELEASE_VERSION;
const channel = releaseChannel(version);
const out = channel === 'prod' ? 'artifacts/avru-prod' : 'artifacts/avru';
await rm(out, { recursive: true, force: true });
await mkdir(`${out}/payload`, { recursive: true });
const common = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  sourcemap: false,
  minify: true,
  metafile: true,
  plugins: [releaseIdentity(version)],
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
      plugins: [releaseIdentity(version), obfuscationPlugin],
      outfile: `${out}/payload/daemon.cjs`,
      format: 'cjs',
    })
  ).metafile,
);
await cp(`${out}/launcher.mjs`, `${out}/payload/launcher.mjs`);
await cp('apps/web/dist', `${out}/payload/web`, { recursive: true });
await cp(
  `apps/extension/.output/${channel}/chrome-mv3`,
  `${out}/payload/extension`,
  { recursive: true },
);
await cp('artifacts/frpc', `${out}/payload/frpc`, { recursive: true });
await writeFile(
  `${out}/payload/release.json`,
  JSON.stringify({ version, channel, frpcVersion: FRPC_VERSION }),
);
await writeFile(
  `${out}/package.json`,
  JSON.stringify(
    {
      name: 'avru',
      version,
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
await writeFile(
  `${out}/THIRD_PARTY_NOTICES.txt`,
  `${await collectLicenses(metas)}\nFRP ${FRPC_VERSION}: Apache-2.0; see payload/frpc/LICENSE. Go runtime and embedded dependency notices: payload/frpc/NOTICES.txt.\n`,
);
await writeFile(
  `${out}/README.md`,
  `Avru ${version} local candidate. Windows/macOS, Node >=24.22.1 <25.\nIncludes browser extension and FRPC ${FRPC_VERSION} for both architectures. Load the extension from the stable installation directory. Import a connection file in Avru; its connection lifecycle is automatic.\nBrowser actions, public FRP and real ChatGPT integration have not been accepted. Official FRPC executables have not been run in this acceptance. Bundling and obfuscation are not secrecy guarantees.\n`,
);
await verifyPackage(out);
console.log('Local package prepared; no npm publication performed.');
