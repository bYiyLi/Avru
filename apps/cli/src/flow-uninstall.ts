import type { InstallationState } from './inspection.js';
import type { Actions, Terminal } from './flow-types.js';
import { canChange, cancel, edition, failure } from './flow-output.js';

function clearNote(terminal: Terminal, state: InstallationState): void {
  terminal.note(
    `将清除以下 Avru ${edition(state)}数据：\n\n  • 已保存的浏览器连接信息\n  • 已导入的连接配置及相关凭据\n  • 调用记录和连接活动记录\n\n浏览器里的插件、保留的插件文件和其他个人文件不会自动删除。\n此操作只影响 Avru ${edition(state)}。`,
    '清除 Avru 数据',
  );
}
async function chooseData(
  terminal: Terminal,
  state: InstallationState,
): Promise<boolean | undefined> {
  const select = () =>
    terminal.select('请选择如何处理 Avru 数据：', [
      { value: 'keep', label: '卸载程序，保留连接设置和记录' },
      { value: 'delete', label: '卸载程序，并清除 Avru 的连接设置和记录' },
      { value: 'exit', label: '取消' },
    ]);
  let choice = await select();
  while (choice === 'delete') {
    clearNote(terminal, state);
    const answer = await terminal.confirm(
      '确认卸载并清除这些数据吗？',
      '是，卸载并清除',
      '否，返回',
    );
    if (answer === undefined) return undefined;
    if (answer) return true;
    choice = await select();
  }
  return choice === 'keep' ? false : undefined;
}
async function dataDecision(
  terminal: Terminal,
  state: InstallationState,
  flags: { accepted: boolean; purge: boolean },
): Promise<boolean | undefined> {
  if (!flags.purge) {
    if (!flags.accepted) return chooseData(terminal, state);
    terminal.note('将保留已有的连接设置和记录。', '数据处理');
    return false;
  }
  clearNote(terminal, state);
  if (flags.accepted) return true;
  const answer = await terminal.confirm(
    '确认卸载并清除这些数据吗？',
    '是，卸载并清除',
    '否，返回',
  );
  if (answer === undefined) return undefined;
  return answer ? true : chooseData(terminal, state);
}
export async function uninstallationFlow(
  terminal: Terminal,
  actions: Actions,
  state: InstallationState,
  flags: { accepted: boolean; purge: boolean },
): Promise<number> {
  if (
    !state.programPresent &&
    state.autostart === 'missing' &&
    !state.retainedData
  ) {
    terminal.end(
      `没有检测到已安装的 Avru ${edition(state)}程序或可清理的数据，没有更改当前安装。`,
    );
    return 0;
  }
  if (!canChange(terminal, state)) return 1;
  terminal.note(
    '卸载将停止本机服务，并移除程序和登录启动项。\n浏览器里的插件不会自动卸载，插件文件也会保留。',
    `卸载 Avru ${edition(state)}`,
  );
  const removeData = await dataDecision(terminal, state, flags);
  if (removeData === undefined) return cancel(terminal);
  const progress = terminal.progress('正在卸载…');
  try {
    await actions.uninstall(state, removeData);
    progress.stop('程序已移除');
    terminal.end(
      removeData
        ? `Avru ${edition(state)}已卸载，指定的 Avru 数据已清理。`
        : `Avru ${edition(state)}已卸载，已有连接设置和记录未被清除。`,
    );
    return 0;
  } catch (error) {
    progress.stop('卸载未完成');
    return failure(terminal, error, '卸载');
  }
}
