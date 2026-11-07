import assert from 'node:assert/strict';
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

// Real negative probes. Never overwrite existing files, even after interruption.
function withFiles(entries, check) {
  const created = [];
  try {
    for (const [path, content] of entries) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, { flag: 'wx' });
      created.push(path);
    }
    check();
  } finally {
    for (const path of created) unlinkSync(path);
  }
}

function runTool(packageName, args) {
  const root = resolve('node_modules', packageName);
  const manifest = JSON.parse(
    readFileSync(resolve(root, 'package.json'), 'utf8'),
  );
  const bin =
    typeof manifest.bin === 'string'
      ? manifest.bin
      : Object.values(manifest.bin)[0];
  const result = spawnSync(process.execPath, [resolve(root, bin), ...args], {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.error, undefined, 'probe must run, not fail to spawn');
  assert.notEqual(result.status, null, 'probe must exit, not time out');
  return { status: result.status, output: result.stdout + result.stderr };
}

function expectRejected(packageName, args, reason) {
  const result = runTool(packageName, args);
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, reason);
}

const cliProbe = 'apps/cli/src/__quality_probe__.ts';

test('ESLint rejects file size, function size, depth, params, statements and complexity', () => {
  const lines = Array.from(
    { length: 501 },
    (_, i) => `export const n${i} = ${i};`,
  ).join('\n');
  const body = Array.from({ length: 95 }, () => 'value++;').join('\n');
  const branches = Array.from(
    { length: 16 },
    (_, i) => `if (value === ${i}) value++;`,
  ).join('\n');
  const nested = 'if(a){if(b){if(c){if(d){if(e){return 1;}}}}}return 0;';
  withFiles(
    [
      [
        cliProbe,
        `${lines}\nexport function long(value: number) {${body}\nreturn value;}\nexport function complex(value: number) {${branches}\nreturn value;}\nexport function deep(a: boolean,b: boolean,c: boolean,d: boolean,e: boolean) {${nested}}`,
      ],
    ],
    () => {
      const result = runTool('eslint', [
        cliProbe,
        '--max-warnings',
        '0',
        '--format',
        'json',
      ]);
      assert.notEqual(result.status, 0);
      for (const rule of [
        'max-lines',
        'max-lines-per-function',
        'max-depth',
        'max-params',
        'max-statements',
        'sonarjs/cognitive-complexity',
      ])
        assert.ok(
          JSON.parse(result.output)
            .flatMap((file) => file.messages)
            .some((message) => message.ruleId === rule),
          result.output,
        );
    },
  );
});

test('ESLint rejects any and unhandled promises', () => {
  withFiles(
    [[cliProbe, 'export const unsafe: any = 1;\nPromise.resolve(1);\n']],
    () => {
      const result = runTool('eslint', [cliProbe]);
      assert.notEqual(result.status, 0);
      assert.match(result.output, /no-explicit-any/);
      assert.match(result.output, /no-floating-promises/);
    },
  );
});

test('dependency rules reject cross-app imports and circular dependencies', () => {
  const other = 'apps/cli/src/__quality_cycle__.ts';
  withFiles(
    [
      [
        cliProbe,
        "import './__quality_cycle__.js';\nimport '../../daemon/src/app.js';\n",
      ],
      [other, "import './__quality_probe__.js';\n"],
    ],
    () => {
      const result = runTool('dependency-cruiser', [
        '--config',
        'config/quality/dependency-cruiser.cjs',
        'apps',
        'packages',
      ]);
      assert.notEqual(result.status, 0);
      assert.match(result.output, /no-circular/);
      assert.match(result.output, /cli-does-not-import-other-apps/);
    },
  );
});

test('production cannot import tests', () => {
  withFiles([[cliProbe, "import '../tests/command.test.js';\n"]], () => {
    expectRejected(
      'dependency-cruiser',
      ['--config', 'config/quality/dependency-cruiser.cjs', 'apps', 'packages'],
      /no-test-imports-in-production/,
    );
  });
});

test('coverage includes a new unimported production module and rejects it', () => {
  withFiles(
    [
      [
        cliProbe,
        'export function untested(value: boolean) { return value ? 1 : 2; }\n',
      ],
    ],
    () => {
      const output = 'coverage/gate-probe';
      try {
        expectRejected(
          'vitest',
          ['run', '--coverage', `--coverage.reportsDirectory=${output}`],
          /Coverage for (lines|functions|statements|branches).*does not meet/i,
        );
      } finally {
        rmSync(output, { recursive: true, force: true });
      }
    },
  );
});

test('Secretlint rejects a deliberately synthetic credential', () => {
  const probe = 'apps/cli/src/__quality_secret_probe__.txt';
  // Synthetic PEM-shaped bytes, not a usable key or credential.
  withFiles(
    [
      [
        probe,
        `-----BEGIN ${'RSA'} ${'PRIVATE'} KEY-----\nMI${'A'.repeat(120)}\n-----END ${'RSA'} ${'PRIVATE'} KEY-----\n`,
      ],
    ],
    () => {
      const result = runTool('secretlint', [probe, '--format', 'json']);
      assert.notEqual(result.status, 0);
      assert.ok(
        JSON.parse(result.output)
          .flatMap((file) => file.messages)
          .some(
            (message) =>
              message.ruleId === '@secretlint/secretlint-rule-privatekey',
          ),
        result.output,
      );
    },
  );
});

test('duplicate production code is rejected', () => {
  const body = Array.from({ length: 20 }, (_, i) => `value += ${i};`).join(
    '\n',
  );
  const content = `export function duplicated(value: number) {\n${body}\nreturn value;\n}`;
  withFiles(
    [
      [cliProbe, content],
      ['apps/cli/src/__quality_duplicate__.ts', content],
    ],
    () => {
      expectRejected(
        'jscpd',
        ['--config', 'config/quality/jscpd.json', 'apps', 'packages'],
        /threshold|duplicates/i,
      );
    },
  );
});
