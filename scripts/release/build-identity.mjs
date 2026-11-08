import { readFile } from 'node:fs/promises';
export function releaseIdentity(version) {
  return {
    name: 'avru-build-identity',
    setup(build) {
      build.onLoad(
        { filter: /packages[/\\]protocol[/\\]environment\.js$/ },
        async ({ path }) => ({
          contents: (await readFile(path, 'utf8')).replace(
            "export const RELEASE_VERSION = '0.1.0-dev.1';",
            `export const RELEASE_VERSION = '${version}';`,
          ),
          loader: 'js',
        }),
      );
    },
  };
}
