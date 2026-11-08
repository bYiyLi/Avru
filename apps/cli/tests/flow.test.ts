import { describe, expect, it, vi } from 'vitest';
import { runFlow } from '../src/flow.js';
import type { Actions, Choice, Terminal } from '../src/flow.js';
import type { InstallationState } from '../src/inspection.js';

const active = {
  release: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  version: '0.1.0-dev.1',
  execPath: '/node',
};
function setup(overrides: Partial<InstallationState> = {}) {
  const state: InstallationState = {
    root: '/Users/example/Avru/dev',
    channel: 'dev',
    packageVersion: '0.1.0-dev.1',
    active: undefined,
    programPresent: Boolean(overrides.active),
    service: 'not_detected',
    autostart: 'missing',
    retainedData: false,
    ...overrides,
  };
  const progress = { stop: vi.fn() };
  const terminal = {
    intro: vi.fn(),
    note: vi.fn(),
    confirm: vi.fn<Terminal['confirm']>().mockResolvedValue(true),
    select: vi.fn<Terminal['select']>().mockResolvedValue('exit'),
    progress: vi.fn(() => progress),
    end: vi.fn(),
    error: vi.fn(),
  };
  const actions = {
    inspect: vi.fn<Actions['inspect']>().mockResolvedValue(state),
    install: vi.fn<Actions['install']>().mockResolvedValue({
      mode: 'install',
      browserOpened: true,
      managementUrl: 'http://127.0.0.1/',
    }),
    open: vi.fn<Actions['open']>().mockResolvedValue({
      browserOpened: true,
      managementUrl: 'http://127.0.0.1/',
    }),
    uninstall: vi.fn<Actions['uninstall']>().mockResolvedValue(undefined),
  };
  return { state, terminal, actions, progress };
}
function notes(s: ReturnType<typeof setup>): string {
  return s.terminal.note.mock.calls.map((call) => call.join(' ')).join('\n');
}
const installed = {
  active,
  service: 'running',
  autostart: 'configured',
} satisfies Partial<InstallationState>;

describe('installation prompts and decisions', () => {
  it('presents the detected first installation and preserves existing data', async () => {
    const s = setup({ retainedData: true });
    expect(await runFlow([], s.terminal, s.actions, true)).toBe(0);
    expect(s.actions.install).toHaveBeenCalledWith(s.state);
    expect(notes(s)).toContain('尚未安装');
    expect(notes(s)).toContain('安装位置：/Users/example/Avru/dev');
    expect(notes(s)).toContain('之前保留的 Avru 数据');
    expect(s.terminal.confirm).toHaveBeenCalledWith(
      '现在开始安装吗？',
      '是，开始安装',
      '暂不安装',
    );
    expect(notes(s)).toContain('Avru 开发版已安装');
  });
  it('does not write when first installation is declined or cancelled', async () => {
    for (const answer of [false, undefined]) {
      const s = setup();
      s.terminal.confirm.mockResolvedValue(answer);
      expect(await runFlow([], s.terminal, s.actions, true)).toBe(0);
      expect(s.actions.install).not.toHaveBeenCalled();
      expect(s.terminal.end).toHaveBeenCalledWith(
        expect.stringContaining('没有更改'),
      );
    }
  });
  it('describes a partial prior installation without claiming the computer is new', async () => {
    const s = setup({ programPresent: true, retainedData: true });
    s.terminal.confirm.mockResolvedValue(false);
    await runFlow([], s.terminal, s.actions, true);
    expect(notes(s)).toContain('发现未完成的 Avru 开发版安装');
    expect(notes(s)).not.toContain('这台电脑尚未安装');
    expect(s.actions.install).not.toHaveBeenCalled();
  });
  it('opens an existing healthy installation without reinstalling', async () => {
    const s = setup(installed);
    s.terminal.select.mockResolvedValue('open');
    expect(await runFlow([], s.terminal, s.actions, true)).toBe(0);
    expect(s.actions.open).toHaveBeenCalledWith(s.state);
    expect(s.actions.install).not.toHaveBeenCalled();
    expect(notes(s)).toContain('本机服务：运行中');
    expect(notes(s)).toContain('登录后启动：已设置');
    expect(
      s.terminal.select.mock.calls[0]?.[1].map((option) => option.value),
    ).toEqual(['open', 'repair', 'exit']);
  });
  it('offers starting a stopped service and accurately labels unknown login status', async () => {
    const s = setup({
      ...installed,
      service: 'not_detected',
      autostart: 'unknown',
    });
    s.terminal.select.mockResolvedValue('open');
    await runFlow([], s.terminal, s.actions, true);
    expect(notes(s)).toContain('登录后启动：无法确认');
    expect(s.terminal.select.mock.calls[0]?.[1][0]?.label).toContain(
      '启动服务',
    );
    expect(s.actions.open).toHaveBeenCalledOnce();
    expect(s.actions.install).not.toHaveBeenCalled();
  });
  it('allows opening but refuses repair or uninstall when login-item ownership is unknown', async () => {
    const s = setup({ ...installed, autostart: 'unknown' });
    s.terminal.select
      .mockResolvedValueOnce('open')
      .mockResolvedValueOnce('repair');
    expect(await runFlow([], s.terminal, s.actions, true)).toBe(0);
    expect(s.actions.open).toHaveBeenCalledOnce();
    expect(await runFlow([], s.terminal, s.actions, true)).toBe(1);
    expect(
      await runFlow(['uninstall', '--yes'], s.terminal, s.actions, false),
    ).toBe(1);
    expect(s.actions.install).not.toHaveBeenCalled();
    expect(s.actions.uninstall).not.toHaveBeenCalled();
    expect(s.terminal.error).toHaveBeenCalledWith(
      expect.stringContaining('无法确认登录启动项'),
    );
  });
  it('reports a missing login item and identifies the production environment', async () => {
    const s = setup({
      channel: 'prod',
      packageVersion: '0.1.0',
      active: { ...active, version: '0.1.0' },
      service: 'running',
      autostart: 'missing',
    });
    await runFlow([], s.terminal, s.actions, true);
    expect(s.terminal.intro).toHaveBeenCalledWith('Avru 正式版');
    expect(notes(s)).toContain('登录后启动：未设置');
  });
  it('returns to the menu after declining repair and repairs only after confirmation', async () => {
    const s = setup(installed);
    s.terminal.select
      .mockResolvedValueOnce('repair')
      .mockResolvedValueOnce('repair');
    s.terminal.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    s.actions.install.mockResolvedValue({
      mode: 'repair',
      browserOpened: true,
      managementUrl: 'local',
    });
    await runFlow([], s.terminal, s.actions, true);
    expect(s.terminal.select).toHaveBeenCalledTimes(2);
    expect(s.actions.install).toHaveBeenCalledOnce();
    expect(notes(s)).toContain('可能短暂断开');
    expect(notes(s)).toContain('已修复');
  });
  it('exits when repair confirmation or menu is cancelled', async () => {
    for (const answer of [undefined, 'exit'] as (Choice | undefined)[]) {
      const s = setup(installed);
      s.terminal.select.mockResolvedValue(answer);
      await runFlow([], s.terminal, s.actions, true);
      expect(s.actions.install).not.toHaveBeenCalled();
      expect(s.actions.open).not.toHaveBeenCalled();
    }
    const s = setup(installed);
    s.terminal.select.mockResolvedValue('repair');
    s.terminal.confirm.mockResolvedValue(undefined);
    await runFlow([], s.terminal, s.actions, true);
    expect(s.actions.install).not.toHaveBeenCalled();
  });
  it('asks before a newer version and never updates after refusal', async () => {
    const s = setup({ ...installed, packageVersion: '0.1.0-dev.2' });
    s.terminal.confirm.mockResolvedValue(false);
    expect(await runFlow([], s.terminal, s.actions, true)).toBe(0);
    expect(notes(s)).toContain('安装包版本：0.1.0-dev.2');
    expect(s.actions.install).not.toHaveBeenCalled();
    s.terminal.confirm.mockResolvedValue(true);
    s.actions.install.mockResolvedValue({
      mode: 'update',
      browserOpened: true,
      managementUrl: 'local',
    });
    expect(await runFlow([], s.terminal, s.actions, true)).toBe(0);
    expect(s.actions.install).toHaveBeenCalledOnce();
    expect(notes(s)).toContain('已更新');
  });
  it('never downgrades an older package even with --yes', async () => {
    const s = setup({ ...installed, packageVersion: '0.1.0-dev.0' });
    s.terminal.select.mockResolvedValue('open');
    expect(await runFlow([], s.terminal, s.actions, true)).toBe(0);
    expect(
      s.terminal.select.mock.calls[0]?.[1].map((option) => option.value),
    ).toEqual(['open', 'exit']);
    expect(s.actions.open).toHaveBeenCalledOnce();
    expect(await runFlow(['--yes'], s.terminal, s.actions, false)).toBe(1);
    expect(s.actions.install).not.toHaveBeenCalled();
  });
  it('stops safely when versions or service ownership cannot be confirmed', async () => {
    const invalid = setup({ ...installed, packageVersion: 'mystery' });
    expect(await runFlow([], invalid.terminal, invalid.actions, true)).toBe(1);
    expect(invalid.actions.install).not.toHaveBeenCalled();
    const unknown = setup({ ...installed, service: 'unknown' });
    expect(
      await runFlow(['--yes'], unknown.terminal, unknown.actions, false),
    ).toBe(1);
    expect(unknown.terminal.error).toHaveBeenCalledWith(
      expect.stringContaining('无法确认 Avru 服务'),
    );
    expect(unknown.actions.install).not.toHaveBeenCalled();
  });
  it('keeps --yes non-interactive while still displaying the actual action', async () => {
    const s = setup(installed);
    s.actions.install.mockResolvedValue({
      mode: 'repair',
      browserOpened: true,
      managementUrl: 'local',
    });
    await runFlow(['--yes'], s.terminal, s.actions, false);
    expect(s.terminal.select).not.toHaveBeenCalled();
    expect(s.terminal.confirm).not.toHaveBeenCalled();
    expect(notes(s)).toContain('重新修复');
    expect(s.actions.install).toHaveBeenCalledOnce();
  });
  it('displays a private recovery address only if browser opening failed', async () => {
    const s = setup(installed);
    s.terminal.select.mockResolvedValue('open');
    s.actions.open.mockResolvedValue({
      browserOpened: false,
      managementUrl: 'private-local-link',
    });
    await runFlow([], s.terminal, s.actions, true);
    expect(notes(s)).toContain('private-local-link');
    expect(notes(s)).toContain('请不要分享');
  });
});

describe('uninstallation prompts and failures', () => {
  it('keeps existing data by default in unattended mode', async () => {
    const s = setup(installed);
    await runFlow(['uninstall', '--yes'], s.terminal, s.actions, false);
    expect(s.actions.uninstall).toHaveBeenCalledWith(s.state, false);
    expect(notes(s)).toContain('将保留已有的连接设置和记录');
  });
  it('states the actual deletion scope when --remove-data is explicit', async () => {
    const s = setup(installed);
    await runFlow(
      ['uninstall', '--yes', '--remove-data'],
      s.terminal,
      s.actions,
      false,
    );
    expect(s.actions.uninstall).toHaveBeenCalledWith(s.state, true);
    expect(notes(s)).toContain('已导入的连接配置及相关凭据');
    expect(notes(s)).toContain('调用记录和连接活动记录');
    expect(notes(s)).not.toContain('将保留已有的连接设置和记录');
    expect(s.terminal.confirm).not.toHaveBeenCalled();
  });
  it('asks for an explicit choice and confirmation before clearing data', async () => {
    const s = setup(installed);
    s.terminal.select.mockResolvedValue('delete');
    s.terminal.confirm.mockResolvedValue(true);
    await runFlow(['uninstall'], s.terminal, s.actions, true);
    expect(s.actions.uninstall).toHaveBeenCalledWith(s.state, true);
    expect(s.terminal.confirm).toHaveBeenCalledWith(
      '确认卸载并清除这些数据吗？',
      '是，卸载并清除',
      '否，返回',
    );
  });
  it('returns to the data menu after refusal and preserves data if selected', async () => {
    const s = setup(installed);
    s.terminal.select
      .mockResolvedValueOnce('delete')
      .mockResolvedValueOnce('keep');
    s.terminal.confirm.mockResolvedValue(false);
    await runFlow(['uninstall'], s.terminal, s.actions, true);
    expect(s.terminal.select).toHaveBeenCalledTimes(2);
    expect(s.actions.uninstall).toHaveBeenCalledWith(s.state, false);
  });
  it('does not uninstall if the selection or explicit deletion is cancelled', async () => {
    const s = setup(installed);
    s.terminal.select.mockResolvedValue(undefined);
    await runFlow(['uninstall'], s.terminal, s.actions, true);
    s.terminal.confirm.mockResolvedValue(false);
    await runFlow(['uninstall', '--remove-data'], s.terminal, s.actions, true);
    expect(s.actions.uninstall).not.toHaveBeenCalled();
  });
  it('honors cancellation or confirmation when clearing data interactively', async () => {
    const selected = setup(installed);
    selected.terminal.select.mockResolvedValue('delete');
    selected.terminal.confirm.mockResolvedValue(undefined);
    await runFlow(['uninstall'], selected.terminal, selected.actions, true);
    expect(selected.actions.uninstall).not.toHaveBeenCalled();

    const flagged = setup(installed);
    flagged.terminal.confirm
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(true);
    await runFlow(
      ['uninstall', '--remove-data'],
      flagged.terminal,
      flagged.actions,
      true,
    );
    expect(flagged.actions.uninstall).not.toHaveBeenCalled();
    await runFlow(
      ['uninstall', '--remove-data'],
      flagged.terminal,
      flagged.actions,
      true,
    );
    expect(flagged.actions.uninstall).toHaveBeenCalledWith(flagged.state, true);
  });
  it('lets a user return from an explicit deletion request and choose to preserve data', async () => {
    const s = setup(installed);
    s.terminal.confirm.mockResolvedValue(false);
    s.terminal.select.mockResolvedValue('keep');
    await runFlow(['uninstall', '--remove-data'], s.terminal, s.actions, true);
    expect(s.actions.uninstall).toHaveBeenCalledWith(s.state, false);
  });
  it('does not create an installation when there is nothing to uninstall', async () => {
    const s = setup();
    expect(
      await runFlow(['uninstall', '--yes'], s.terminal, s.actions, false),
    ).toBe(0);
    expect(s.actions.uninstall).not.toHaveBeenCalled();
    expect(s.terminal.end).toHaveBeenCalledWith(
      expect.stringContaining('没有检测到已安装'),
    );
  });
  it('reports a confirmed rollback differently from an unknown result', async () => {
    const s = setup({ ...installed, packageVersion: '0.1.0-dev.2' });
    s.actions.install.mockRejectedValueOnce(
      Object.assign(new Error('start failed'), {
        code: 'AVRU_INSTALL_ROLLED_BACK',
      }),
    );
    expect(await runFlow(['--yes'], s.terminal, s.actions, false)).toBe(1);
    expect(s.terminal.error).toHaveBeenLastCalledWith(
      expect.stringContaining('原来的 Avru 版本已恢复'),
    );
    s.actions.install.mockRejectedValueOnce(new Error('unknown'));
    expect(await runFlow(['--yes'], s.terminal, s.actions, false)).toBe(1);
    expect(s.terminal.error).toHaveBeenLastCalledWith(
      expect.stringContaining('暂时无法确认当前状态'),
    );
  });
  it('rejects bad arguments and unattended operations without --yes', async () => {
    for (const args of [['wat'], ['--remove-data'], ['--yes', 'uninstall']]) {
      const s = setup();
      expect(await runFlow(args, s.terminal, s.actions, true)).toBe(1);
      expect(s.actions.inspect).not.toHaveBeenCalled();
    }
    const s = setup();
    expect(await runFlow([], s.terminal, s.actions, false)).toBe(1);
    expect(s.actions.inspect).not.toHaveBeenCalled();
  });
  it.each([
    ['AVRU_INSTALL_BUSY', '其他安装操作'],
    ['AVRU_CHANNEL_MISMATCH', '环境不匹配'],
    ['AVRU_ROOT_UNOWNED', '目录归属无法确认'],
    ['AVRU_UNSAFE_PATH', '无法安全使用的链接'],
    ['AVRU_LEGACY_INSTALLATION', '检测到旧版 Avru 安装'],
    ['AVRU_STATE_CHANGED', '安装状态已变化'],
    ['EACCES', '没有权限'],
    ['EPERM', '没有权限'],
  ])('explains a known blocked state %s', async (code, message) => {
    const s = setup();
    s.actions.inspect.mockRejectedValue(
      Object.assign(new Error('private detail'), { code }),
    );
    expect(await runFlow([], s.terminal, s.actions, true)).toBe(1);
    expect(s.terminal.error).toHaveBeenCalledWith(
      expect.stringContaining(message),
    );
    expect(s.actions.install).not.toHaveBeenCalled();
  });
});
