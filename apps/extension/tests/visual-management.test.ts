import { describe, expect, it, vi } from 'vitest';
import type { BrowserActionAPI } from '../utils/browser-ports';
import {
  setFaviconStatus,
  showVirtualCursor,
} from '../utils/management-actions';

function fixture() {
  const state: Record<string, unknown> = {};
  const get = vi.fn((key: string) => Promise.resolve({ [key]: state[key] }));
  const set = vi.fn((changes: Record<string, unknown>) => {
    Object.assign(state, changes);
    return Promise.resolve();
  });
  const update = vi.fn(() => Promise.resolve({ id: 7, active: true }));
  const sendMessage = vi.fn(() => Promise.resolve({ ok: true }));
  const api: BrowserActionAPI = {
    tabs: { get: () => Promise.resolve({}), update, sendMessage },
    scripting: { executeScript: () => Promise.resolve([]) },
    storage: { get, set, remove: () => Promise.resolve() },
  };
  return { api, state, get, set, update, sendMessage };
}

describe('task-bound favicon state and native Chrome overlay', () => {
  it('publishes active and completed states per tab, preserving unrelated tabs', async () => {
    const h = fixture();
    expect(
      await setFaviconStatus(h.api, 7, ['task-a', 'active']),
    ).toMatchObject({
      ok: true,
      status: 'active',
    });
    await setFaviconStatus(h.api, 8, ['task-b', 'done']);
    expect(h.state['avru.favicon.states']).toMatchObject({
      '7': { status: 'active', taskId: 'task-a' },
      '8': { status: 'done', taskId: 'task-b' },
    });
    expect(await setFaviconStatus(h.api, 7, ['task-a', 'done'])).toMatchObject({
      status: 'done',
    });
    expect(h.sendMessage).toHaveBeenCalledWith(7, {
      type: 'avru.favicon.status',
      status: 'done',
      taskId: 'task-a',
    });
    await setFaviconStatus(h.api, 7, ['task-a', 'clear']);
    const states = h.state['avru.favicon.states'] as Record<string, unknown>;
    expect(Object.keys(states)).toEqual(['8']);
    expect(states['8']).toMatchObject({ status: 'done', taskId: 'task-b' });
  });

  it('does not let an old task completion overwrite another task still controlling the tab', async () => {
    const h = fixture();
    await setFaviconStatus(h.api, 7, ['task-a', 'active']);
    await setFaviconStatus(h.api, 7, ['task-b', 'active']);
    const oldMessages = h.sendMessage.mock.calls.length;
    await setFaviconStatus(h.api, 7, ['task-a', 'done']);
    await setFaviconStatus(h.api, 7, ['task-a', 'clear']);
    expect(h.state['avru.favicon.states']).toMatchObject({
      '7': { status: 'active', taskId: 'task-b' },
    });
    expect(h.sendMessage).toHaveBeenCalledTimes(oldMessages);
  });

  it('can still mark the currently controlled tab as a manual deliverable', async () => {
    const h = fixture();
    await setFaviconStatus(h.api, 7, ['task-a', 'active']);
    await setFaviconStatus(h.api, 7, ['manual', 'done']);
    expect(h.state['avru.favicon.states']).toMatchObject({
      '7': { status: 'done', taskId: 'manual' },
    });
  });

  it('returns a valid state if the page content script is unavailable', async () => {
    const h = fixture();
    h.sendMessage.mockRejectedValueOnce(new Error('no receiver'));
    await expect(
      setFaviconStatus(h.api, 7, ['a', 'active']),
    ).resolves.toMatchObject({
      ok: true,
    });
    delete h.api.tabs.sendMessage;
    await expect(
      setFaviconStatus(h.api, 7, ['a', 'done']),
    ).resolves.toMatchObject({
      ok: true,
    });
    await expect(
      showVirtualCursor(h.api, 7, [{ x: 0, y: 0 }]),
    ).resolves.toEqual({
      ok: true,
    });
  });

  it('moves the virtual pointer and foregrounds the actual controlled tab', async () => {
    const h = fixture();
    await showVirtualCursor(h.api, 7, [{ x: 20, y: 30, action: 'click' }]);
    expect(h.update).toHaveBeenCalledWith(7, { active: true });
    expect(h.sendMessage).toHaveBeenCalledWith(7, {
      type: 'avru.cursor',
      x: 20,
      y: 30,
      visible: true,
      action: 'click',
    });
    await showVirtualCursor(h.api, 7, [{ x: 0, y: 0, visible: false }]);
    expect(h.update).toHaveBeenCalledOnce();
    expect(h.sendMessage).toHaveBeenCalledWith(7, {
      type: 'avru.cursor',
      x: 0,
      y: 0,
      visible: false,
      action: 'move',
    });
  });

  it('does not block real browser actions when activation or messaging fails', async () => {
    const h = fixture();
    h.update.mockRejectedValueOnce(new Error('window closed'));
    h.sendMessage.mockRejectedValueOnce(new Error('content script closed'));
    await expect(
      showVirtualCursor(h.api, 7, [{ x: 50, y: 50 }]),
    ).resolves.toEqual({
      ok: true,
    });
    delete h.api.tabs.update;
    await expect(
      showVirtualCursor(h.api, 7, [{ x: 50, y: 50 }]),
    ).resolves.toEqual({
      ok: true,
    });
  });

  it('rejects invalid messages before saving state or selecting tabs', async () => {
    const h = fixture();
    for (const args of [
      [],
      [null],
      [{ x: '0', y: 0 }],
      [{ x: Number.NaN, y: 0 }],
      [{ x: 1, y: Number.POSITIVE_INFINITY }],
      [{ y: 1 }],
      [{ x: 1, y: 1 }, {}],
    ])
      await expect(showVirtualCursor(h.api, 7, args)).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    for (const args of [
      [],
      ['a'],
      [1, 'done'],
      ['a', 'pending'],
      ['a', false],
      ['a', 'active', 'extra'],
    ])
      await expect(setFaviconStatus(h.api, 7, args)).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    expect(h.set).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
    expect(h.sendMessage).not.toHaveBeenCalled();
  });
});
