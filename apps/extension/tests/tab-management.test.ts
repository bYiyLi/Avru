import type { BrowserActionAPI } from '../utils/browser-ports';
import { describe, expect, it, vi } from 'vitest';
import { dispatchBrowserAction } from '../utils/browser-actions';
import type { CdpController } from '../utils/cdp';

function fixture() {
  const create = vi.fn((options: { url?: string; active?: boolean }) =>
    Promise.resolve({ id: 98, title: 'New tab', url: options.url }),
  );
  const remove = vi.fn(() => Promise.resolve());
  const update = vi.fn((id: number) => Promise.resolve({ id, active: true }));
  const query = vi.fn(() =>
    Promise.resolve([
      { id: 77, title: 'Active tab', url: 'https://test.local/' },
    ]),
  );
  const api: BrowserActionAPI = {
    tabs: {
      get: () => Promise.resolve({ windowId: 42 }),
      create,
      remove,
      update,
      query,
    },
    scripting: {
      executeScript: () => Promise.resolve([]),
    },
  };
  const cdp = {} as Pick<CdpController, 'send' | 'events' | 'cursor'>;
  const dispatch = (method: string, args: unknown[] = []) =>
    dispatchBrowserAction(api, cdp, { tabId: 3, method, args });
  return { api, dispatch, create, remove, update, query };
}

describe('browser tab lifecycle actions', () => {
  it('lists regular windows without exposing incognito windows', async () => {
    const h = fixture();
    const getAll = vi.fn(() =>
      Promise.resolve([
        { id: 42, focused: true, type: 'normal', state: 'normal' },
        { id: 41, focused: false },
        { id: 43, focused: false, incognito: true },
        { focused: true },
      ]),
    );
    h.api.windows = { getAll };
    expect(await h.dispatch('windows.list', [])).toEqual([
      { id: '42', focused: true, type: 'normal', state: 'normal' },
      { id: '41', focused: false },
    ]);
    expect(getAll).toHaveBeenCalledWith({ populate: false });
    await expect(h.dispatch('windows.list', ['extra'])).rejects.toThrow(
      'INVALID_ARGUMENT',
    );
    delete h.api.windows;
    await expect(h.dispatch('windows.list', [])).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
  });

  it('moves a tab within its profile and reports the exact destination', async () => {
    const h = fixture();
    const move = vi.fn((id: number, options: { index: number }) => {
      expect(id).toBe(88);
      expect(options.index).toBe(0);
      return Promise.resolve({ id: 88, index: 0, windowId: 42 });
    });
    h.api.tabs.move = move;
    expect(
      await h.dispatch('tabs.move', ['88', { index: 0, windowId: 42 }]),
    ).toEqual({
      ok: true,
      tabId: '88',
      changed: true,
      index: 0,
      windowId: '42',
    });
    expect(move).toHaveBeenCalledWith(88, { index: 0, windowId: 42 });
    for (const args of [
      ['088', { index: 0 }],
      ['88', { index: -2 }],
      ['88', { index: '1' }],
      ['88', { index: 0, windowId: -1 }],
      ['88', {}],
      ['88', null],
    ])
      await expect(h.dispatch('tabs.move', args)).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    expect(move).toHaveBeenCalledOnce();
    h.api.tabs.move = () => Promise.resolve({});
    expect(await h.dispatch('tabs.move', ['88', { index: -1 }])).toEqual({
      ok: true,
      tabId: '88',
      changed: true,
    });
    delete h.api.tabs.move;
    await expect(h.dispatch('tabs.move', ['88', { index: 0 }])).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
  });
  it('creates an inactive tab and returns its exact tab ID', async () => {
    const h = fixture();
    expect(
      await h.dispatch('tabs.new', ['https://example.test', { active: false }]),
    ).toEqual({
      tabId: '98',
      title: 'New tab',
      url: 'https://example.test',
    });
    expect(h.create).toHaveBeenCalledWith({
      url: 'https://example.test',
      active: false,
    });
  });

  it('creates a default tab without inventing a URL', async () => {
    const h = fixture();
    await h.dispatch('tabs.new', [null, {}]);
    expect(h.create).toHaveBeenCalledWith({});
  });

  it('activates the requested tab and queries the current window only', async () => {
    const h = fixture();
    expect(await h.dispatch('tabs.select', ['77'])).toEqual({
      ok: true,
      tabId: '77',
      changed: true,
    });
    expect(h.update).toHaveBeenCalledWith(77, { active: true });
    expect(await h.dispatch('tabs.selected')).toEqual({
      tabId: '77',
      title: 'Active tab',
      url: 'https://test.local/',
    });
    expect(h.query).toHaveBeenCalledWith({
      active: true,
      windowId: 42,
    });
  });

  it('closes the requested tab with no approval or repeat dispatch', async () => {
    const h = fixture();
    expect(await h.dispatch('tabs.close', ['98'])).toEqual({
      ok: true,
      tabId: '98',
      changed: true,
    });
    expect(h.remove).toHaveBeenCalledExactlyOnceWith(98);
  });

  it('validates IDs and options before changing browser tabs', async () => {
    const h = fixture();
    for (const [method, args] of [
      ['tabs.close', ['01']],
      ['tabs.close', [-1]],
      ['tabs.select', ['9999999999999999999999']],
      ['tabs.new', [123, {}]],
      ['tabs.new', [null, { active: 'yes' }]],
      ['tabs.new', [null, {}, 'extra']],
      ['tabs.selected', ['extra']],
    ] as const) {
      await expect(h.dispatch(method, [...args])).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    }
    expect(h.remove).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it('reports inaccessible browser APIs rather than silently succeeding', async () => {
    const h = fixture();
    delete h.api.tabs.remove;
    delete h.api.tabs.update;
    delete h.api.tabs.create;
    delete h.api.tabs.query;
    for (const [method, args] of [
      ['tabs.close', ['7']],
      ['tabs.select', ['7']],
      ['tabs.new', [null, {}]],
      ['tabs.selected', []],
    ] as const) {
      await expect(h.dispatch(method, [...args])).rejects.toThrow(
        'CAPABILITY_NOT_ALLOWED',
      );
    }
  });
});
