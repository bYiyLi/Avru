import { execFileSync } from 'node:child_process';
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error('Run via pnpm package:prod');
execFileSync(process.execPath, [pnpm, '--filter', '@avru/extension', 'build'], {
  env: { ...process.env, AVRU_BUILD_CHANNEL: 'prod' },
  stdio: 'inherit',
});
execFileSync(process.execPath, ['scripts/package-cli.mjs', '--prod'], {
  stdio: 'inherit',
});
