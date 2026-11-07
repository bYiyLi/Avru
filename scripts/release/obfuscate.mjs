import { transform } from 'esbuild';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { readFile } from 'node:fs/promises';

// Only this first-party module is transformed. Never process vendor bundles.
export const protectedModule = 'apps/daemon/src/http-security.ts';
export const obfuscationPlugin = {
  name: 'local-first-party-obfuscation',
  setup(builder) {
    builder.onLoad(
      { filter: /[\\/]daemon[\\/]src[\\/]http-security\.ts$/ },
      async (args) => {
        const source = await readFile(args.path, 'utf8');
        const js = await transform(source, {
          loader: 'ts',
          format: 'esm',
          target: 'node24',
        });
        const result = JavaScriptObfuscator.obfuscate(js.code, {
          target: 'node',
          seed: 1,
          compact: true,
          renameGlobals: false,
          renameProperties: false,
          controlFlowFlattening: false,
          deadCodeInjection: false,
          debugProtection: false,
          debugProtectionInterval: 0,
          disableConsoleOutput: false,
          selfDefending: false,
          sourceMap: false,
          stringArray: false,
          identifierNamesGenerator: 'hexadecimal',
        });
        return { contents: result.getObfuscatedCode(), loader: 'js' };
      },
    );
  },
};
