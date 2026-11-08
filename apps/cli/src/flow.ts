import type { Actions, Terminal } from './flow-types.js';
import { failure } from './flow-output.js';
import { installationFlow } from './flow-install.js';
import { uninstallationFlow } from './flow-uninstall.js';
export type { Actions, Choice, Terminal } from './flow-types.js';

/** UI policy is separate from OS effects, including cancellation and non-TTY use. */
export async function runFlow(
  args: readonly string[],
  terminal: Terminal,
  actions: Actions,
  interactive: boolean,
): Promise<number> {
  const removing = args[0] === 'uninstall';
  const accepted = args.includes('--yes');
  const purge = args.includes('--remove-data');
  const valid = args.every((arg, index) =>
    arg === 'uninstall'
      ? index === 0
      : ['--yes', '--remove-data'].includes(arg),
  );
  if (!valid || (purge && !removing)) {
    terminal.error(
      '用法：avru [--yes] | avru uninstall [--yes] [--remove-data]',
    );
    return 1;
  }
  if (!accepted && !interactive) {
    terminal.error('非交互终端需要 --yes。删除数据还需 --remove-data。');
    return 1;
  }
  let state;
  try {
    state = await actions.inspect(removing);
  } catch (error) {
    return failure(terminal, error, '检查安装状态');
  }
  terminal.intro(`Avru ${state.channel === 'dev' ? '开发版' : '正式版'}`);
  if (state.service === 'unknown')
    return failure(
      terminal,
      Object.assign(new Error('unverified'), {
        code: 'AVRU_RUNTIME_UNVERIFIED',
      }),
      '检查服务',
    );
  if (removing)
    return uninstallationFlow(terminal, actions, state, { accepted, purge });
  return installationFlow(terminal, actions, state, accepted);
}
