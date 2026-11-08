import { cp, readFile, writeFile, rm } from 'node:fs/promises';
import { verifyPackage } from './verify.mjs';

// Separate opt-in output. The source package remains unpublishable.
const source = 'artifacts/avru';
const target = 'artifacts/npm-dev';
await verifyPackage(source);
await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });
const manifest = JSON.parse(await readFile(`${target}/package.json`, 'utf8'));
const scoped = process.argv.includes('--scope');
manifest.private = false;
if (scoped) manifest.name = '@avru/setup';
manifest.description = 'Avru local browser assistant development preview';
manifest.repository = {
  type: 'git',
  url: 'git+https://github.com/bYiyLi/Avru.git',
};
manifest.publishConfig = {
  access: 'public',
  tag: 'dev',
  registry: 'https://registry.npmjs.org/',
};
await writeFile(
  `${target}/package.json`,
  JSON.stringify(manifest, null, 2) + '\n',
);
await writeFile(
  `${target}/README.md`,
  'Avru 0.1.0-dev.1 development preview. Windows/macOS, Node >=24.22.1 <25.\n' +
    `After npm publication: npx -y ${scoped ? '@avru/setup' : 'avru'}@dev\n` +
    'Includes local browser extension, persistent bounded call history, isolated environments and FRPC 0.72.0 for Windows/macOS x64/ARM64. Load the unpacked extension from the stable installed directory. Import a connection file in Avru; Avru manages the connection automatically.\n' +
    'Official FRPC programs have only been checked statically in this acceptance; real FRP and ChatGPT connectivity are unverified. Browser SDK actions and QuickJS production integration are not included.\n' +
    'Bundling and obfuscation are not secrecy guarantees. Third-party licenses are in THIRD_PARTY_NOTICES.txt.\n',
);
await verifyPackage(target, scoped ? 'npm-scoped-dev' : 'npm-dev');
console.log('Prepared npm dev candidate locally. No publication performed.');
