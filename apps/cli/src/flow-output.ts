import type { InstallationState } from './inspection.js';
import type { Actions, Terminal } from './flow-types.js';
import { compareVersions } from './version-order.js';

export function edition(state: InstallationState): string {
  return state.channel === 'dev' ? '开发版' : '正式版';
}
export function cancel(terminal: Terminal): number {
  terminal.end('已退出，没有更改当前安装。');
  return 0;
}
export function failure(
  terminal: Terminal,
  error: unknown,
  action: string,
): number {
  const code =
    error instanceof Error && 'code' in error ? error.code : undefined;
  if (code === 'AVRU_RUNTIME_UNVERIFIED') {
    terminal.error(
      '无法确认 Avru 服务的当前状态。\n为了避免影响其他程序，已停止本次操作。\n请先检查本机 Avru 服务和日志，再决定如何处理。',
    );
  } else if (code === 'AVRU_INSTALL_ROLLED_BACK') {
    terminal.error(
      `${action}没有完成。\n原来的 Avru 版本已恢复，本机服务已重新启动。\n你的连接设置和记录仍然保留。\n请查看本机日志了解失败原因。`,
    );
  } else if (code === 'AVRU_AUTOSTART_UNVERIFIED') {
    terminal.error(
      '无法确认登录启动项是否属于当前安装。\n为了避免影响其他 Avru 安装，已停止本次操作。\n请检查当前用户的登录启动项后再试。',
    );
  } else if (code === 'AVRU_STATE_CHANGED') {
    terminal.error('安装状态已变化，请重新运行并检查当前状态。');
  } else if (code === 'AVRU_INSTALL_BUSY') {
    terminal.error('检测到其他安装操作，请先确认该操作已结束。');
  } else if (code === 'AVRU_CHANNEL_MISMATCH') {
    terminal.error('Avru 环境不匹配，请使用对应环境的安装目录。');
  } else if (code === 'AVRU_ROOT_UNOWNED') {
    terminal.error('安装目录归属无法确认，请先检查并备份原有数据。');
  } else if (code === 'AVRU_UNSAFE_PATH') {
    terminal.error('安装目录包含无法安全使用的链接，请先检查目录后重试。');
  } else if (code === 'AVRU_LEGACY_INSTALLATION') {
    terminal.error(
      '检测到旧版 Avru 安装。请先确认旧程序已停止，并备份旧数据后再处理。\n本次没有迁移或删除旧数据。',
    );
  } else if (code === 'EACCES' || code === 'EPERM') {
    terminal.error(
      `${action}没有完成。\n没有权限访问所需文件，请检查当前用户的目录权限。`,
    );
  } else {
    terminal.error(
      `${action}没有完成。\n暂时无法确认当前状态，请检查安装目录和本机日志。`,
    );
  }
  return 1;
}
export function canChange(
  terminal: Terminal,
  state: InstallationState,
): boolean {
  if (state.autostart !== 'unknown') return true;
  failure(
    terminal,
    Object.assign(new Error('unverified'), {
      code: 'AVRU_AUTOSTART_UNVERIFIED',
    }),
    '检查登录启动项',
  );
  return false;
}
export function browserResult(
  terminal: Terminal,
  result: { browserOpened: boolean; managementUrl: string },
): void {
  if (!result.browserOpened)
    terminal.note(
      `Avru 服务已启动，但无法自动打开管理页面。\n请在这台电脑的浏览器中打开以下地址：\n${result.managementUrl}\n\n这个地址仅供本机使用，请不要分享。`,
      '管理页面',
    );
}
export async function performInstall(
  terminal: Terminal,
  actions: Actions,
  state: InstallationState,
): Promise<number> {
  if (!canChange(terminal, state)) return 1;
  const action = state.active
    ? compareVersions(state.packageVersion, state.active.version) === 0
      ? '修复'
      : '更新'
    : '安装';
  const progress = terminal.progress(`正在${action}…`);
  try {
    const result = await actions.install(state);
    progress.stop(`${action}完成`);
    const title =
      result.mode === 'install'
        ? '已安装'
        : result.mode === 'repair'
          ? '已修复'
          : '已更新';
    terminal.note(
      `版本：${state.packageVersion}\n安装位置：${state.root}\n本机服务：运行中\n登录后启动：已设置`,
      `Avru ${edition(state)}${title}`,
    );
    browserResult(terminal, result);
    terminal.end('请在 Avru 管理页面查看或完成浏览器连接。');
    return 0;
  } catch (error) {
    progress.stop(`${action}未完成`);
    return failure(terminal, error, action);
  }
}
export async function performOpen(
  terminal: Terminal,
  actions: Actions,
  state: InstallationState,
): Promise<number> {
  const progress = terminal.progress(
    state.service === 'running' ? '正在打开管理页面…' : '正在启动服务…',
  );
  try {
    const result = await actions.open(state);
    progress.stop('Avru 服务已准备好');
    browserResult(terminal, result);
    terminal.end('请在这台电脑的浏览器中查看 Avru 管理页面。');
    return 0;
  } catch (error) {
    progress.stop('未能打开管理页面');
    return failure(terminal, error, '打开管理页面');
  }
}
