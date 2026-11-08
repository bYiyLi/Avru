import {
  releaseChannel,
  RELEASE_VERSION,
} from '../../../packages/protocol/environment.js';
import {
  defaultDataRoot,
  previousDataRoot,
  rejectLegacyDefault,
} from './channel-root.js';
import * as clack from '@clack/prompts';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFlow } from './flow.js';
import { install, openInstalled, uninstall } from './install.js';
import type { ActiveRelease } from './install.js';
import { inspectInstallation } from './inspection.js';
import type { InstallationState } from './inspection.js';
import { installLauncher } from './launcher.js';
import {
  enableAutostart,
  disableAutostart,
  verifyAutostart,
} from './autostart-io.js';
import { startRuntime, stopRuntime, openManagement } from './runtime.js';
const args = process.argv.slice(2);
const source =
  process.env.AVRU_PACKAGE_ROOT ?? dirname(fileURLToPath(import.meta.url));
const home = homedir();
const channel = releaseChannel();
const root = defaultDataRoot({
  platform: process.platform,
  home,
  channel,
  ...(process.env.AVRU_DATA_DIR ? { custom: process.env.AVRU_DATA_DIR } : {}),
});
const launcherPath = join(root, 'program', 'launcher.mjs');
const auto = {
  ...(process.env.APPDATA ? { roamingDir: process.env.APPDATA } : {}),
  channel,
  platform: process.platform,
  home,
  execPath: process.execPath,
  launcherPath,
};
const start = async (active: ActiveRelease) =>
  (
    await startRuntime({
      dataRoot: root,
      channel,
      payloadRoot: join(root, 'program', 'releases', active.release),
      execPath: active.execPath,
    })
  ).url;
const open = (url: string) => openManagement(url, process.platform);
const verifyStartup = (state: InstallationState) =>
  verifyAutostart(
    { ...auto, execPath: state.active?.execPath ?? process.execPath },
    state.autostart,
  );
const autostart = async (active: ActiveRelease, state: InstallationState) => {
  await verifyStartup(state);
  const undo = await installLauncher(
    join(root, 'program', 'releases', active.release, 'launcher.mjs'),
    launcherPath,
  );
  try {
    await enableAutostart({ ...auto, execPath: active.execPath }, () =>
      verifyStartup(state),
    );
  } catch (error) {
    await undo();
    throw error;
  }
};
if (args.includes('--help') || args.includes('--version')) {
  console.log(
    args.includes('--version')
      ? RELEASE_VERSION
      : '用法：avru [--yes] | avru uninstall [--yes] [--remove-data]\n安装或管理本机 Avru；--yes 跳过交互选择，--remove-data 清除已知 Avru 数据。',
  );
} else if (process.platform !== 'darwin' && process.platform !== 'win32') {
  console.error('Avru 目前仅支持 Windows 和 macOS。本次没有更改任何内容。');
  process.exitCode = 1;
} else {
  process.exitCode = await runFlow(
    args,
    {
      intro: clack.intro,
      note: clack.note,
      confirm: async (message, active, inactive) => {
        const answer = await clack.confirm({
          message,
          active,
          inactive,
          initialValue: false,
          vertical: true,
        });
        return clack.isCancel(answer) ? undefined : answer;
      },
      select: async (message, options) => {
        const answer = await clack.select({
          message: `${message}（↑/↓ 选择，回车确认）`,
          options,
          showInstructions: false,
        });
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
      inspect: async (removing) => {
        if (!removing && !process.env.AVRU_DATA_DIR)
          await rejectLegacyDefault(
            home,
            previousDataRoot({
              platform: process.platform,
              home,
              channel,
              ...(process.env.LOCALAPPDATA
                ? { localAppData: process.env.LOCALAPPDATA }
                : {}),
            }),
          );
        return inspectInstallation({
          root,
          channel,
          packageVersion: RELEASE_VERSION,
          autostart: auto,
        });
      },
      install: (state) =>
        install({
          root,
          channel,
          sourceRoot: join(source, 'payload'),
          version: RELEASE_VERSION,
          execPath: process.execPath,
          expected: state.active ?? null,
          expectedProgram: state.programPresent,
          hooks: {
            beforeChange: () => verifyStartup(state),
            stop: () => stopRuntime(root, channel),
            start,
            autostart: (active) => autostart(active, state),
            open,
          },
        }),
      open: (state) => {
        if (!state.active) throw new Error('未找到已安装的 Avru 程序');
        return openInstalled({
          root,
          channel,
          expected: state.active,
          hooks: { start, open },
        });
      },
      uninstall: (state, removeData) =>
        uninstall({
          root,
          channel,
          removeData,
          expected: state.active ?? null,
          expectedProgram: state.programPresent,
          hooks: {
            beforeChange: () => verifyStartup(state),
            stop: () => stopRuntime(root, channel),
            removeAutostart: async () => {
              await verifyStartup(state);
              await disableAutostart(auto, () => verifyStartup(state));
            },
          },
        }),
    },
    process.stdin.isTTY && process.stdout.isTTY,
  );
}
