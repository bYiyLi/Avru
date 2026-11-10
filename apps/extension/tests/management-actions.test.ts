import { describe, expect, it, vi } from 'vitest';
import type { BrowserActionAPI } from '../utils/browser-ports';
import {
  browserVisibility,
  dispatchManagementAction,
  nameSession,
} from '../utils/management-actions';

function fixture() {
  const values: Record<string, unknown> = {};
  const get = vi.fn((key: string | string[]) =>
    Promise.resolve(
      Object.fromEntries(
        (Array.isArray(key) ? key : [key]).map((item) => [item, values[item]]),
      ),
    ),
  );
  const set = vi.fn((input: Record<string, unknown>) => {
    Object.assign(values, input);
    return Promise.resolve();
  });
  const remove = vi.fn((keys: string | string[]) => {
    for (const key of Array.isArray(keys) ? keys : [keys])
      Reflect.deleteProperty(values, key);
    return Promise.resolve();
  });
  const getAll = vi.fn(() =>
    Promise.resolve([
      { id: 1, focused: true, state: 'maximized', incognito: false },
      { id: 2, focused: false, state: 'minimized', incognito: false },
      { id: 3, focused: false, state: 'normal', incognito: true },
    ]),
  );
  const windowCreate = vi.fn(() => Promise.resolve({ id: 55 }));
  const windowUpdate = vi.fn(() => Promise.resolve({ id: 1 }));
  const query = vi.fn(() => Promise.resolve([{ id: 7, title: 'Current tab' }]));
  const tabGet = vi.fn(() =>
    Promise.resolve({ id: 7, windowId: 1, groupId: -1 }),
  );
  const tabUpdate = vi.fn(() => Promise.resolve({ id: 7, active: true }));
  const group = vi.fn(() => Promise.resolve(42));
  const ungroup = vi.fn(() => Promise.resolve());
  const tabMove = vi.fn(() => Promise.resolve({ id: 7, index: 2 }));
  const tabRemove = vi.fn(() => Promise.resolve());
  const sendMessage = vi.fn(() => Promise.resolve({ ok: true }));
  const groupGet = vi.fn(() => Promise.resolve({ id: 42 }));
  const groupQuery = vi.fn(() => Promise.resolve([{ id: 42 }]));
  const groupUpdate = vi.fn(() => Promise.resolve({ id: 42, color: 'blue' }));
  const groupMove = vi.fn(() => Promise.resolve({ id: 42 }));
  const bookmarkSearch = vi.fn(() => Promise.resolve([{ id: 'b1' }]));
  const bookmarkTree = vi.fn(() => Promise.resolve([{ id: 'root' }]));
  const bookmarkCreate = vi.fn(() => Promise.resolve({ id: 'b2' }));
  const bookmarkUpdate = vi.fn(() => Promise.resolve({ id: 'b1' }));
  const bookmarkMove = vi.fn(() => Promise.resolve({ id: 'b1' }));
  const bookmarkRemove = vi.fn(() => Promise.resolve());
  const api: BrowserActionAPI = {
    windows: { getAll, create: windowCreate, update: windowUpdate },
    tabs: {
      get: tabGet,
      query,
      update: tabUpdate,
      group,
      ungroup,
      move: tabMove,
      remove: tabRemove,
      sendMessage,
    },
    tabGroups: {
      get: groupGet,
      query: groupQuery,
      update: groupUpdate,
      move: groupMove,
    },
    bookmarks: {
      search: bookmarkSearch,
      getTree: bookmarkTree,
      create: bookmarkCreate,
      update: bookmarkUpdate,
      move: bookmarkMove,
      remove: bookmarkRemove,
    },
    storage: { get, set, remove },
    scripting: { executeScript: () => Promise.resolve([]) },
  };
  const call = (namespace: string, method: string, args: unknown[] = []) =>
    dispatchManagementAction(api, [namespace, method, args]);
  return {
    api,
    call,
    values,
    get,
    set,
    remove,
    getAll,
    windowCreate,
    windowUpdate,
    query,
    tabGet,
    tabUpdate,
    group,
    ungroup,
    tabMove,
    tabRemove,
    sendMessage,
    groupGet,
    groupQuery,
    groupUpdate,
    groupMove,
    bookmarkSearch,
    bookmarkTree,
    bookmarkCreate,
    bookmarkUpdate,
    bookmarkMove,
    bookmarkRemove,
  };
}

describe('native extension window and tab management', () => {
  it('lists non-incognito windows and delegates bounded create/update', async () => {
    const h = fixture();
    expect(await h.call('windows', 'getAll')).toHaveLength(2);
    expect(h.getAll).toHaveBeenCalledWith({ populate: false });
    expect(await h.call('windows', 'create', [{ focused: true }])).toEqual({
      id: 55,
    });
    expect(h.windowCreate).toHaveBeenCalledWith({ focused: true });
    expect(await h.call('windows', 'update', [1, { focused: false }])).toEqual({
      id: 1,
    });
    expect(h.windowUpdate).toHaveBeenCalledWith(1, { focused: false });
  });

  it('rejects unsupported or malformed window operations', async () => {
    const h = fixture();
    for (const input of [
      ['getAll', [null]],
      ['getAll', [1, 2]],
      ['create', []],
      ['create', [null]],
      ['create', [1]],
      ['update', [1]],
      ['update', ['1', {}]],
      ['update', [-1, {}]],
      ['update', [1, []]],
      ['update', [1, {}, {}]],
    ] as const)
      await expect(h.call('windows', input[0], [...input[1]])).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    delete h.api.windows?.create;
    await expect(h.call('windows', 'create', [{}])).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
    delete h.api.windows?.update;
    await expect(h.call('windows', 'update', [1, {}])).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
    await expect(h.call('windows', 'unknown')).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
    delete h.api.windows;
    await expect(h.call('windows', 'getAll')).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
  });

  it('queries, activates, retrieves, moves, groups, ungroups and removes tabs', async () => {
    const h = fixture();
    expect(await h.call('tabs', 'query', [{ active: true }])).toHaveLength(1);
    expect(h.query).toHaveBeenCalledWith({ active: true });
    expect(await h.call('tabs', 'get', [7])).toMatchObject({ id: 7 });
    expect(await h.call('tabs', 'update', [7, { active: true }])).toMatchObject(
      { id: 7 },
    );
    expect(
      await h.call('tabs', 'group', [{ tabIds: [7, 9], groupId: 42 }]),
    ).toBe(42);
    expect(h.group).toHaveBeenCalledWith({ tabIds: [7, 9], groupId: 42 });
    expect(await h.call('tabs', 'ungroup', [[7, 9]])).toBeUndefined();
    expect(h.ungroup).toHaveBeenCalledWith([7, 9]);
    expect(
      await h.call('tabs', 'move', [7, { index: -1, windowId: 1 }]),
    ).toMatchObject({ id: 7 });
    expect(h.tabMove).toHaveBeenCalledWith(7, { index: -1, windowId: 1 });
    expect(await h.call('tabs', 'remove', [[7, 9]])).toBeUndefined();
    expect(h.tabRemove).toHaveBeenCalledWith(7);
    expect(h.tabRemove).toHaveBeenCalledWith(9);
  });

  it('accepts a single tab ID and no optional window ID', async () => {
    const h = fixture();
    await h.call('tabs', 'group', [{ tabIds: 7 }]);
    expect(h.group).toHaveBeenCalledWith({ tabIds: [7] });
    await h.call('tabs', 'ungroup', [7]);
    expect(h.ungroup).toHaveBeenCalledWith([7]);
    await h.call('tabs', 'move', [7, { index: 0 }]);
    expect(h.tabMove).toHaveBeenCalledWith(7, { index: 0 });
    await h.call('tabs', 'remove', [7]);
    expect(h.tabRemove).toHaveBeenCalledWith(7);
  });

  it('validates native tab IDs, supported methods and option shapes', async () => {
    const h = fixture();
    for (const [method, args] of [
      ['get', []],
      ['get', ['7']],
      ['get', [-1]],
      ['get', [1.5]],
      ['query', []],
      ['query', [null]],
      ['update', [7]],
      ['update', [7, []]],
      ['group', [{ tabIds: [] }]],
      ['group', [{ tabIds: Array(101).fill(7) }]],
      ['group', [{ tabIds: 7, groupId: -1 }]],
      ['ungroup', [[]]],
      ['ungroup', [['7']]],
      ['move', [7, { index: -2 }]],
      ['move', [7, { index: 1, windowId: '2' }]],
      ['remove', [[]]],
      ['remove', [null]],
    ] as [string, unknown[]][])
      await expect(h.call('tabs', method, args)).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    expect(h.tabGet).not.toHaveBeenCalled();
    expect(h.group).not.toHaveBeenCalled();
    await expect(h.call('tabs', 'unknown')).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
  });

  it('reports unsupported tab APIs instead of claiming a completed operation', async () => {
    const h = fixture();
    delete h.api.tabs.query;
    delete h.api.tabs.update;
    delete h.api.tabs.group;
    delete h.api.tabs.ungroup;
    delete h.api.tabs.move;
    delete h.api.tabs.remove;
    for (const [method, args] of [
      ['query', [{}]],
      ['update', [7, {}]],
      ['group', [{ tabIds: 7 }]],
      ['ungroup', [7]],
      ['move', [7, { index: 0 }]],
      ['remove', [7]],
    ] as [string, unknown[]][])
      await expect(h.call('tabs', method, args)).rejects.toThrow(
        'CAPABILITY_NOT_ALLOWED',
      );
  });
});

describe('tab group and bookmark APIs', () => {
  it('reads, queries, updates and moves task tab groups', async () => {
    const h = fixture();
    expect(await h.call('tabGroups', 'get', [42])).toEqual({ id: 42 });
    expect(await h.call('tabGroups', 'query')).toEqual([{ id: 42 }]);
    expect(await h.call('tabGroups', 'query', [{ windowId: 1 }])).toEqual([
      { id: 42 },
    ]);
    expect(h.groupQuery).toHaveBeenLastCalledWith({ windowId: 1 });
    expect(
      await h.call('tabGroups', 'update', [42, { title: 'Avru' }]),
    ).toHaveProperty('id', 42);
    expect(
      await h.call('tabGroups', 'move', [42, { index: 0 }]),
    ).toHaveProperty('id', 42);
    expect(h.groupMove).toHaveBeenCalledWith(42, { index: 0 });
  });

  it('refuses malformed tab group operations and unsupported native capabilities', async () => {
    const h = fixture();
    for (const [method, args] of [
      ['get', ['42']],
      ['get', []],
      ['query', [1]],
      ['query', [{}, {}]],
      ['update', [42]],
      ['update', [42, []]],
      ['move', [-1, {}]],
      ['move', [42, null]],
    ] as [string, unknown[]][])
      await expect(h.call('tabGroups', method, args)).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    delete h.api.tabGroups?.get;
    delete h.api.tabGroups?.query;
    delete h.api.tabGroups?.move;
    await expect(h.call('tabGroups', 'get', [42])).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
    await expect(h.call('tabGroups', 'query')).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
    await expect(h.call('tabGroups', 'move', [42, {}])).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
    await expect(h.call('tabGroups', 'missing')).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
    delete h.api.tabGroups;
    await expect(h.call('tabGroups', 'update', [42, {}])).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
  });

  it('offers the native bookmarks tree, search, create, update, move and remove operations', async () => {
    const h = fixture();
    expect(await h.call('bookmarks', 'search', ['avru'])).toEqual([
      { id: 'b1' },
    ]);
    expect(h.bookmarkSearch).toHaveBeenCalledWith('avru');
    await h.call('bookmarks', 'search', [{ url: 'https://example.test/' }]);
    expect(h.bookmarkSearch).toHaveBeenCalledWith({
      url: 'https://example.test/',
    });
    expect(await h.call('bookmarks', 'getTree')).toEqual([{ id: 'root' }]);
    expect(
      await h.call('bookmarks', 'create', [
        { title: 'A', url: 'https://example.test' },
      ]),
    ).toMatchObject({ id: 'b2' });
    expect(
      await h.call('bookmarks', 'update', ['b1', { title: 'B' }]),
    ).toMatchObject({ id: 'b1' });
    expect(
      await h.call('bookmarks', 'move', ['b1', { parentId: 'root' }]),
    ).toMatchObject({ id: 'b1' });
    expect(await h.call('bookmarks', 'remove', ['b1'])).toBeUndefined();
    expect(h.bookmarkRemove).toHaveBeenCalledWith('b1');
  });

  it('checks bookmark IDs and required argument objects', async () => {
    const h = fixture();
    for (const [method, args] of [
      ['search', []],
      ['search', [null]],
      ['getTree', [1]],
      ['create', [null]],
      ['update', ['', {}]],
      ['update', ['id', null]],
      ['move', ['id']],
      ['move', [1, {}]],
      ['remove', ['']],
      ['remove', ['x'.repeat(129)]],
    ] as [string, unknown[]][])
      await expect(h.call('bookmarks', method, args)).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    await expect(h.call('bookmarks', 'bad')).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
    delete h.api.bookmarks;
    await expect(h.call('bookmarks', 'search', ['x'])).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
  });

  it('rejects malformed management envelopes before native API dispatch', async () => {
    const h = fixture();
    for (const args of [
      [],
      ['tabs', 'query'],
      [null, 'query', []],
      ['tabs', null, []],
      ['tabs', 'query', null],
      ['tabs', 'query', Array(9).fill(1)],
      ['tabs', 'query', [], 'extra'],
    ])
      await expect(dispatchManagementAction(h.api, args)).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    await expect(h.call('unknown', 'list')).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
  });
});

describe('window visibility and session branding', () => {
  it('reports visible and minimized Chrome windows without foregrounding another app', async () => {
    const h = fixture();
    expect(
      await browserVisibility(h.api, 'browser.visibility.get', []),
    ).toEqual({
      visible: true,
      windows: [
        { id: 1, state: 'maximized' },
        { id: 2, state: 'minimized' },
        { id: 3, state: 'normal' },
      ],
    });
    await expect(
      browserVisibility(h.api, 'browser.visibility.get', ['extra']),
    ).rejects.toThrow('INVALID_ARGUMENT');
  });

  it('records previous window states when hiding and restores maximized windows', async () => {
    const h = fixture();
    expect(
      await browserVisibility(h.api, 'browser.visibility.set', [false]),
    ).toEqual({
      visible: false,
      changed: true,
    });
    expect(h.values['avru.visibility.previousStates']).toHaveLength(3);
    expect(h.windowUpdate).toHaveBeenCalledWith(1, { state: 'minimized' });
    expect(
      await browserVisibility(h.api, 'browser.visibility.set', [true]),
    ).toEqual({
      visible: true,
      changed: true,
    });
    expect(h.windowUpdate).toHaveBeenCalledWith(2, { state: 'normal' });
    expect(h.remove).toHaveBeenCalledWith('avru.visibility.previousStates');
  });

  it('validates visibility controls and missing native window permissions', async () => {
    const h = fixture();
    for (const args of [[], [null], ['false'], [false, true]])
      await expect(
        browserVisibility(h.api, 'browser.visibility.set', args),
      ).rejects.toThrow('INVALID_ARGUMENT');
    delete h.api.windows?.update;
    await expect(
      browserVisibility(h.api, 'browser.visibility.get', []),
    ).rejects.toThrow('CAPABILITY_NOT_ALLOWED');
  });

  it('names and reuses the same branded session group across related tasks', async () => {
    const h = fixture();
    expect(await nameSession(h.api, 7, ['  Research  ', 'task-1'])).toEqual({
      groupId: 42,
      title: 'Research',
      color: 'blue',
    });
    expect(h.group).toHaveBeenCalledWith({ tabIds: [7] });
    expect(h.groupUpdate).toHaveBeenCalledWith(42, {
      title: 'Research',
      color: 'blue',
    });
    expect(await nameSession(h.api, 7, ['Search', 'task-1'])).toEqual({
      groupId: 42,
      title: 'Search',
      color: 'blue',
    });
    expect(h.group).toHaveBeenLastCalledWith({ tabIds: [7], groupId: 42 });
  });

  it('validates names and requires Chrome tab-group capabilities', async () => {
    const h = fixture();
    for (const args of [
      [],
      [null],
      [''],
      ['   '],
      ['a'.repeat(129)],
      ['Task', ''],
      ['Task', 1],
      ['Task', 'id', 'extra'],
    ])
      await expect(nameSession(h.api, 7, args)).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    delete h.api.tabs.group;
    await expect(nameSession(h.api, 7, ['Task'])).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
  });
});
