import * as clack from '@clack/prompts';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFlow } from './flow.js';
import { install, uninstall } from './install.js';
import { installLauncher } from './launcher.js';
import { enableAutostart, disableAutostart } from './autostart-io.js';
import { startRuntime, stopRuntime, openManagement } from './runtime.js';
const args = process.argv.slice(2);
const source =
  process.env.AVRU_PACKAGE_ROOT ?? dirname(fileURLToPath(import.meta.url));
const home = homedir();
const root = process.env.AVRU_DATA_DIR ?? join(home, '.avru');
const launcherPath = join(root, 'program', 'launcher.mjs');
const auto = {
  ...(process.env.APPDATA ? { roamingDir: process.env.APPDATA } : {}),
  platform: process.platform,
  home,
  execPath: process.execPath,
  launcherPath,
};
if (args.includes('--help') || args.includes('--version')) {
  console.log(
    args.includes('--version')
      ? '0.1.0-dev (unpublished)'
      : 'Usage: avru [--yes] | avru uninstall [--yes] [--remove-data]\nInstalls, starts and configures user-login startup on Windows/macOS.',
  );
} else if (process.platform !== 'darwin' && process.platform !== 'win32') {
  console.error('Avru supports Windows and macOS only. No changes were made.');
  process.exitCode = 1;
} else {
  process.exitCode = await runFlow(
    args,
    {
      intro: clack.intro,
      note: clack.note,
      confirm: async (message) => {
        const answer = await clack.confirm({ message, initialValue: false });
        return clack.isCancel(answer) ? undefined : answer;
      },
      progress: (message) => {
        const spinner = clack.spinner();
        spinner.start(message);
        return spinner;
      },
      end: clack.outro,
      error: clack.log.error,
    },
    {
      install: () =>
        install({
          root,
          sourceRoot: join(source, 'payload'),
          version: '0.1.0-dev',
          execPath: process.execPath,
          hooks: {
            stop: () => stopRuntime(root),
            start: async (active) =>
              (
                await startRuntime({
                  dataRoot: root,
                  payloadRoot: join(
                    root,
                    'program',
                    'releases',
                    active.release,
                  ),
                  execPath: active.execPath,
                })
              ).url,
            autostart: async (active) => {
              const undo = await installLauncher(
                join(
                  root,
                  'program',
                  'releases',
                  active.release,
                  'launcher.mjs',
                ),
                launcherPath,
              );
              try {
                await enableAutostart(auto);
              } catch (error) {
                await undo();
                throw error;
              }
            },
            open: (url) => openManagement(url, process.platform),
          },
        }),
      uninstall: (removeData) =>
        uninstall({
          root,
          removeData,
          hooks: {
            stop: () => stopRuntime(root),
            removeAutostart: () => disableAutostart(auto),
          },
        }),
    },
    process.stdin.isTTY && process.stdout.isTTY,
  );
}
