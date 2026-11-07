import { cp, readFile, writeFile, rm } from 'node:fs/promises';
import { verifyPackage } from './verify.mjs';

// Separate opt-in output. The source package remains unpublishable.
const source = 'artifacts/avru';
const target = 'artifacts/npm-dev';
await verifyPackage(source);
await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });
const manifest = JSON.parse(await readFile(`${target}/package.json`, 'utf8'));
manifest.private = false;
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
    'After npm publication: npx -y avru@dev\n' +
    'Local CLI/daemon/Web only. Browser extension must be built/loaded separately. MCP, QuickJS and local extension installation guide are not included.\n' +
    'Bundling and obfuscation are not secrecy guarantees. Third-party licenses are in THIRD_PARTY_NOTICES.txt.\n',
);
await verifyPackage(target, 'npm-dev');
console.log('Prepared npm dev candidate locally. No publication performed.');
