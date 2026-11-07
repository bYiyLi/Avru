import { describe, expect, it, vi } from 'vitest';
import { runFlow } from '../src/flow.js';
const setup = () => ({
  terminal: {
    intro: vi.fn(),
    note: vi.fn(),
    confirm: vi
      .fn<() => Promise<boolean | undefined>>()
      .mockResolvedValue(true),
    progress: vi.fn(() => ({ stop: vi.fn() })),
    end: vi.fn(),
    error: vi.fn(),
  },
  actions: {
    install: vi.fn().mockResolvedValue({
      mode: 'install',
      browserOpened: true,
      managementUrl: 'http://localhost/',
    }),
    uninstall: vi.fn().mockResolvedValue(undefined),
  },
});
describe('Clack flow policy', () => {
  it('installs and opens management', async () => {
    const s = setup();
    expect(await runFlow([], s.terminal, s.actions, true)).toBe(0);
    expect(s.actions.install).toHaveBeenCalledOnce();
  });
  it.each([['wat'], ['--remove-data']])(
    'rejects invalid arguments %s',
    async (...args) => {
      const s = setup();
      expect(await runFlow(args, s.terminal, s.actions, true)).toBe(1);
    },
  );
  it('requires consent without tty', async () => {
    const s = setup();
    expect(await runFlow([], s.terminal, s.actions, false)).toBe(1);
    expect(s.actions.install).not.toHaveBeenCalled();
  });
  it('cancels without writes', async () => {
    const s = setup();
    s.terminal.confirm.mockResolvedValue(undefined);
    expect(await runFlow([], s.terminal, s.actions, true)).toBe(0);
    expect(s.actions.install).not.toHaveBeenCalled();
  });
  it('uninstalls with data retained in unattended mode', async () => {
    const s = setup();
    await runFlow(['uninstall', '--yes'], s.terminal, s.actions, false);
    expect(s.actions.uninstall).toHaveBeenCalledWith(false);
  });
  it('purges explicitly', async () => {
    const s = setup();
    await runFlow(
      ['uninstall', '--yes', '--remove-data'],
      s.terminal,
      s.actions,
      false,
    );
    expect(s.actions.uninstall).toHaveBeenCalledWith(true);
  });
  it('asks interactive data choice', async () => {
    const s = setup();
    await runFlow(['uninstall'], s.terminal, s.actions, true);
    expect(s.actions.uninstall).toHaveBeenCalledWith(true);
  });
  it('cancels at data choice', async () => {
    const s = setup();
    s.terminal.confirm
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(undefined);
    await runFlow(['uninstall'], s.terminal, s.actions, true);
    expect(s.actions.uninstall).not.toHaveBeenCalled();
  });
  it('shows private recovery link if browser fails', async () => {
    const s = setup();
    s.actions.install.mockResolvedValue({
      mode: 'repair',
      browserOpened: false,
      managementUrl: 'local link',
    });
    await runFlow(['--yes'], s.terminal, s.actions, false);
    expect(s.terminal.note).toHaveBeenCalledWith(
      'local link',
      expect.any(String),
    );
  });
  it.each([new Error('disk full'), 'bad'])(
    'reports failure %s',
    async (error) => {
      const s = setup();
      s.actions.install.mockRejectedValue(error);
      expect(await runFlow(['--yes'], s.terminal, s.actions, false)).toBe(1);
    },
  );
});
