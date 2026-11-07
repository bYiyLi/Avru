import { build } from 'esbuild';
import { cp, mkdir, writeFile, rm } from 'node:fs/promises';
const out = 'artifacts/avru';
await rm(out, { recursive: true, force: true });
await mkdir(`${out}/payload`, { recursive: true });
const common = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  sourcemap: false,
};
await build({
  ...common,
  entryPoints: ['apps/cli/src/main.ts'],
  outfile: `${out}/cli.mjs`,
  format: 'esm',
  banner: {
    js: '#!/usr/bin/env node\nimport {createRequire as __createRequire} from "node:module";const require=__createRequire(import.meta.url);',
  },
});
await build({
  ...common,
  entryPoints: ['apps/cli/src/background.ts'],
  outfile: `${out}/launcher.mjs`,
  format: 'esm',
  banner: {
    js: 'import {createRequire as __createRequire} from "node:module";const require=__createRequire(import.meta.url);',
  },
});
await build({
  ...common,
  entryPoints: ['apps/daemon/src/main.ts'],
  outfile: `${out}/payload/daemon.cjs`,
  format: 'cjs',
});
await cp('apps/web/dist', `${out}/payload/web`, { recursive: true });
await writeFile(
  `${out}/package.json`,
  JSON.stringify(
    {
      name: 'avru',
      version: '0.1.0-dev',
      private: true,
      type: 'module',
      bin: { avru: 'cli.mjs' },
      engines: { node: '>=24.22.1 <25' },
      files: ['cli.mjs', 'launcher.mjs', 'payload'],
    },
    null,
    2,
  ) + '\n',
);
console.log('Local package prepared; no npm publication performed.');
