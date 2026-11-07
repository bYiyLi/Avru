export interface Terminal {
  intro(message: string): void;
  note(message: string, title: string): void;
  confirm(message: string): Promise<boolean | undefined>;
  progress(message: string): { stop(message: string): void };
  end(message: string): void;
  error(message: string): void;
}
export interface Actions {
  install(): Promise<{
    mode: string;
    browserOpened: boolean;
    managementUrl: string;
  }>;
  uninstall(removeData: boolean): Promise<void>;
}
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
  const valid = args.every((arg) =>
    ['uninstall', '--yes', '--remove-data'].includes(arg),
  );
  if (!valid || (purge && !removing)) {
    terminal.error(
      'Usage: avru [--yes] | avru uninstall [--yes] [--remove-data]',
    );
    return 1;
  }
  terminal.intro('Avru · 本机浏览器助手');
  terminal.note(
    removing
      ? '停止守护进程并移除登录自启动与程序。默认保留配对数据。'
      : '安装或修复本机程序，启动守护进程，设置当前用户登录自启动，并打开管理页面。不会安装浏览器扩展或配置远程通道。',
    '本次操作',
  );
  if (!accepted && !interactive) {
    terminal.error('非交互终端需要 --yes。删除配对数据还需 --remove-data。');
    return 1;
  }
  if (!accepted && (await terminal.confirm('继续？')) !== true) {
    terminal.end('已取消，未作更改。');
    return 0;
  }
  let removeData = purge;
  if (removing && !accepted && !purge) {
    const answer =
      await terminal.confirm('同时删除浏览器配对数据？（默认保留）');
    if (answer === undefined) {
      terminal.end('已取消，未作更改。');
      return 0;
    }
    removeData = answer;
  }
  const progress = terminal.progress(
    removing ? '正在卸载…' : '正在检查并安装…',
  );
  return execute({ removing, removeData }, terminal, actions, progress);
}
async function execute(
  choice: { removing: boolean; removeData: boolean },
  terminal: Terminal,
  actions: Actions,
  progress: { stop(message: string): void },
): Promise<number> {
  const { removing, removeData } = choice;
  try {
    if (removing) {
      await actions.uninstall(removeData);
      progress.stop('程序已移除');
      terminal.end(
        removeData ? '配对数据已删除。' : '配对数据已保留，可重新安装恢复。',
      );
    } else {
      const result = await actions.install();
      progress.stop(`已完成：${result.mode}`);
      if (!result.browserOpened)
        terminal.note(
          result.managementUrl,
          '浏览器未能自动打开，请在本机打开此私密链接',
        );
      terminal.end('守护进程已启动。浏览器安装与连接设置请在管理页面完成。');
    }
    return 0;
  } catch (error) {
    progress.stop('未完成');
    terminal.error(error instanceof Error ? error.message : '未知安装错误');
    return 1;
  }
}
