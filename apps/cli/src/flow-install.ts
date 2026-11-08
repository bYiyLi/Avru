import type { InstallationState } from './inspection.js';
import type { Actions, Choice, Terminal } from './flow-types.js';
import { cancel, edition, performInstall, performOpen } from './flow-output.js';
import { compareVersions } from './version-order.js';

function loginStatus(state: InstallationState): string {
  if (state.autostart === 'configured') return '已设置';
  if (state.autostart === 'missing') return '未设置';
  return '无法确认';
}
function status(state: InstallationState): string {
  const service = state.service === 'running' ? '运行中' : '未检测到运行';
  return `当前版本：${state.active?.version ?? '未知'}\n本次安装包：${state.packageVersion}\n本机服务：${service}\n登录后启动：${loginStatus(state)}`;
}
function firstInstall(terminal: Terminal, state: InstallationState): void {
  const beginning = state.programPresent
    ? `发现未完成的 Avru ${edition(state)}安装，尚未找到可用的版本。`
    : `这台电脑尚未安装 Avru ${edition(state)}。`;
  const retained = state.retainedData
    ? '\n\n检测到之前保留的 Avru 数据，安装时会继续保留。'
    : '';
  terminal.note(
    `${beginning}\n\n安装版本：${state.packageVersion}\n安装位置：${state.root}\n\n安装完成后，Avru 将：\n  • 启动本机服务\n  • 设置当前用户登录后自动启动\n  • 准备浏览器插件文件\n  • 打开管理页面，引导你完成浏览器连接${retained}`,
    `Avru ${edition(state)}`,
  );
}
function repairNote(terminal: Terminal, state: InstallationState): void {
  terminal.note(
    '将使用本次安装包重新准备程序文件，并重启本机服务。\n已连接的浏览器可能短暂断开；连接设置和记录会保留。',
    `重新修复 Avru ${edition(state)}`,
  );
}
function updateNote(terminal: Terminal, state: InstallationState): void {
  terminal.note(
    `当前版本：${state.active?.version ?? '未知'}\n安装包版本：${state.packageVersion}\n\n更新时，本机服务会短暂重启，已连接的浏览器可能暂时断开。\n浏览器连接设置、已导入的连接配置和记录会保留。`,
    '发现可用的安装包',
  );
}
async function existingMenu(
  terminal: Terminal,
  actions: Actions,
  state: InstallationState,
  older: boolean,
): Promise<number> {
  const options: { value: Choice; label: string }[] = [
    {
      value: 'open',
      label:
        state.service === 'running' ? '打开管理页面' : '启动服务并打开管理页面',
    },
    ...(!older ? [{ value: 'repair' as const, label: '重新修复程序' }] : []),
    { value: 'exit', label: '退出' },
  ];
  let choice = await terminal.select('请选择接下来要做什么：', options);
  while (choice === 'repair' && !older) {
    repairNote(terminal, state);
    const answer = await terminal.confirm(
      '确认重新修复吗？',
      '是，开始修复',
      '返回',
    );
    if (answer === undefined) return cancel(terminal);
    if (answer) return performInstall(terminal, actions, state);
    choice = await terminal.select('请选择接下来要做什么：', options);
  }
  if (choice === 'open') return performOpen(terminal, actions, state);
  return cancel(terminal);
}
export async function installationFlow(
  terminal: Terminal,
  actions: Actions,
  state: InstallationState,
  accepted: boolean,
): Promise<number> {
  if (!state.active) {
    firstInstall(terminal, state);
    if (
      !accepted &&
      (await terminal.confirm(
        '现在开始安装吗？',
        '是，开始安装',
        '暂不安装',
      )) !== true
    )
      return cancel(terminal);
    return performInstall(terminal, actions, state);
  }
  const comparison = compareVersions(
    state.packageVersion,
    state.active.version,
  );
  if (comparison === undefined) {
    terminal.error(
      '无法比较当前版本和安装包版本，已停止本次操作。请先检查安装状态。',
    );
    return 1;
  }
  if (comparison < 0) {
    terminal.note(
      `${status(state)}\n\n这个安装包比当前版本更旧。为了保留当前版本，本次不会使用这个旧安装包替换程序。`,
      '安装包版本较旧',
    );
    if (accepted) {
      terminal.error('旧安装包不能自动降级，请使用当前或更新的安装包。');
      return 1;
    }
    return existingMenu(terminal, actions, state, true);
  }
  if (comparison > 0) {
    updateNote(terminal, state);
    if (
      !accepted &&
      (await terminal.confirm('现在更新吗？', '是，开始更新', '暂不更新')) !==
        true
    )
      return cancel(terminal);
    return performInstall(terminal, actions, state);
  }
  terminal.note(status(state), `Avru ${edition(state)}已安装`);
  if (accepted) {
    repairNote(terminal, state);
    return performInstall(terminal, actions, state);
  }
  return existingMenu(terminal, actions, state, false);
}
