import type { BrowserActionAPI } from '../utils/browser-ports';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchBrowserAction,
  readBrowserAction,
} from '../utils/browser-actions';
import type { CdpController } from '../utils/cdp';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('groups a task, displays the badge, and follows visible mouse operations', async () => {
  const resume = vi.fn();
  const detach = vi.fn(() => Promise.resolve());
  const cdp = { resume, detach } as unknown as CdpController;
  const update = vi.fn(() => Promise.resolve({ active: true }));
  const sendMessage = vi.fn(() => Promise.resolve({ ok: true }));
  const group = vi.fn(() => Promise.resolve(42));
  const updateGroup = vi.fn(() => Promise.resolve({ id: 42 }));
  const store = vi.fn(() => Promise.resolve());
  const api: BrowserActionAPI = {
    tabs: {
      get: () => Promise.resolve({ windowId: 10 }),
      update,
      sendMessage,
      group,
    },
    tabGroups: { update: updateGroup },
    storage: { get: () => Promise.resolve({}), set: store, remove: store },
    scripting: { executeScript: () => Promise.resolve([]) },
  };
  const dispatch = (method: string, args: unknown[]) =>
    dispatchBrowserAction(api, cdp, { tabId: 7, method, args });
  await expect(
    dispatch('tab.execution.start', ['task-a', 'Research']),
  ).resolves.toEqual({ ok: true });
  expect(resume).toHaveBeenCalledWith(7);
  expect(group).toHaveBeenCalledWith({ tabIds: [7] });
  expect(updateGroup).toHaveBeenCalledWith(42, {
    title: 'Research',
    color: 'blue',
  });
  expect(sendMessage).toHaveBeenCalledWith(7, {
    type: 'avru.favicon.status',
    status: 'active',
    taskId: 'task-a',
  });
  await dispatch('tab.visual.cursor', [{ x: 10, y: 20, visible: true }]);
  expect(update).toHaveBeenCalledWith(7, { active: true });
  await dispatch('tab.visual.cursor', [{ x: 0, y: 0, visible: false }]);
  expect(update).toHaveBeenCalledOnce();
  await expect(
    dispatch('tab.execution.finish', ['task-a', 'succeeded']),
  ).resolves.toEqual({ ok: true });
  // CDP's event subscription must survive between consecutive AI tasks,
  // otherwise an already-open browser dialog blocks a fresh attachment.
  expect(detach).not.toHaveBeenCalled();
  expect(sendMessage).toHaveBeenCalledWith(7, {
    type: 'avru.favicon.status',
    status: 'done',
    taskId: 'task-a',
  });
  expect(sendMessage).toHaveBeenCalledWith(
    7,
    expect.objectContaining({
      type: 'avru.cursor',
      visible: false,
    }),
  );
  for (const args of [['bad'], ['', 'Avru'], ['task-a', ''], ['task-a', 10]])
    await expect(dispatch('tab.execution.start', args)).rejects.toThrow(
      'INVALID_ARGUMENT',
    );
  await expect(
    dispatch('tab.execution.finish', ['task-a', 'invalid']),
  ).rejects.toThrow('INVALID_ARGUMENT');
});

function fixture() {
  const executeScript = vi.fn(() =>
    Promise.resolve([
      {
        result: {
          title: 'Example',
          url: 'https://example.test/page',
          text: 'X'.repeat(20_000),
        },
      },
    ]),
  );
  const api: BrowserActionAPI = {
    tabs: {
      get: vi.fn(() =>
        Promise.resolve({
          title: 'Example',
          url: 'https://example.test/page',
        }),
      ),
    },
    scripting: {
      executeScript,
    },
  };
  return { api, executeScript };
}
describe('readBrowserAction', () => {
  it('reads the actual tab title and URL without scripting', async () => {
    const { api, executeScript } = fixture();
    expect(await readBrowserAction(api, 7, 'tab.title')).toBe('Example');
    expect(await readBrowserAction(api, 7, 'tab.url')).toBe(
      'https://example.test/page',
    );
    expect(executeScript).not.toHaveBeenCalled();
  });
  it('reads and bounds a page snapshot', async () => {
    const { api, executeScript } = fixture();
    const result = await readBrowserAction(api, 7, 'tab.snapshot');
    expect(result).toEqual({
      title: 'Example',
      url: 'https://example.test/page',
      text: 'X'.repeat(16_384),
      truncated: true,
    });
    expect(executeScript).toHaveBeenCalledOnce();
  });
  it('rejects unsupported and inaccessible targets', async () => {
    const { api } = fixture();
    await expect(readBrowserAction(api, -1, 'tab.title')).rejects.toThrow(
      'INVALID_TARGET',
    );
    await expect(readBrowserAction(api, 7, 'tab.click')).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
    api.tabs.get = () => Promise.resolve({ url: 'chrome://settings' });
    await expect(readBrowserAction(api, 7, 'tab.title')).rejects.toThrow(
      'PAGE_NOT_ACCESSIBLE',
    );
  });
  it('handles missing tab titles and failed or inaccessible page snapshots', async () => {
    const { api } = fixture();
    api.tabs.get = () => Promise.resolve({ url: 'https://example.test/' });
    expect(await readBrowserAction(api, 7, 'tab.title')).toBe('');
    api.scripting.executeScript = () => Promise.resolve([]);
    await expect(readBrowserAction(api, 7, 'tab.snapshot')).rejects.toThrow(
      'PAGE_NOT_ACCESSIBLE',
    );
  });
  it('executes the snapshot callback in the page and handles an absent body', async () => {
    const { api } = fixture();
    vi.stubGlobal('document', {
      title: 'In-page title',
      querySelector: () => null,
    });
    vi.stubGlobal('location', { href: 'https://example.test/actual' });
    api.scripting.executeScript = (details) =>
      Promise.resolve([{ result: details.func() }]);
    expect(await readBrowserAction(api, 2, 'tab.snapshot')).toEqual({
      title: 'In-page title',
      url: 'https://example.test/actual',
      text: '',
      truncated: false,
    });
  });
});

describe('dispatchBrowserAction', () => {
  it('routes a profile history search and denies it if the browser API is unavailable', async () => {
    const { api } = fixture();
    const cdp = cdpFixture().cdp;
    const search = vi.fn(() =>
      Promise.resolve([
        {
          url: 'https://example.test/',
          title: 'Example',
          lastVisitTime: 2_000,
        },
      ]),
    );
    api.history = { search };
    expect(
      await dispatchBrowserAction(api, cdp, {
        tabId: 4,
        method: 'history.search',
        args: [{ queries: ['Example'], limit: 2 }],
      }),
    ).toEqual([
      {
        url: 'https://example.test/',
        title: 'Example',
        dateVisited: '1970-01-01T00:00:02.000Z',
      },
    ]);
    expect(search).toHaveBeenCalledWith({
      text: 'Example',
      maxResults: 2,
      startTime: 0,
    });
    delete api.history;
    await expect(
      dispatchBrowserAction(api, cdp, {
        tabId: 4,
        method: 'history.search',
        args: [{}],
      }),
    ).rejects.toThrow('CAPABILITY_NOT_ALLOWED');
  });
  function cdpFixture() {
    const send = vi.fn(() => Promise.resolve({ value: 2 }));
    const events = vi.fn(() =>
      Promise.resolve({ events: [], nextCursor: '0' }),
    );
    const cursor = vi.fn(() => Promise.resolve('0'));
    const cdp = { send, events, cursor } as unknown as Pick<
      CdpController,
      'send' | 'cursor' | 'events'
    >;
    return { cdp, send, events, cursor };
  }
  it('does not restrict the CDP command namespace', async () => {
    const { api } = fixture();
    const h = cdpFixture();
    expect(
      await dispatchBrowserAction(api, h.cdp, {
        tabId: 4,
        method: 'cdp.send',
        args: ['Storage.getCookies'],
      }),
    ).toEqual({ value: 2 });
    expect(h.send).toHaveBeenCalledWith(4, 'Storage.getCookies', undefined);
  });
  it('rejects malformed CDP arguments before debugger dispatch', async () => {
    const { api } = fixture();
    const h = cdpFixture();
    for (const args of [[], ['Page.enable', null], ['Page.enable', ['bad']]]) {
      await expect(
        dispatchBrowserAction(api, h.cdp, {
          tabId: 4,
          method: 'cdp.send',
          args,
        }),
      ).rejects.toThrow('INVALID_ARGUMENT');
    }
    await expect(
      dispatchBrowserAction(api, h.cdp, {
        tabId: 4,
        method: 'cdp.events',
        args: [123],
      }),
    ).rejects.toThrow('INVALID_ARGUMENT');
    expect(h.send).not.toHaveBeenCalled();
    expect(h.events).not.toHaveBeenCalled();
  });
  it('routes cursors, event reads and normal tab operations', async () => {
    const { api } = fixture();
    const h = cdpFixture();
    expect(
      await dispatchBrowserAction(api, h.cdp, {
        tabId: 4,
        method: 'cdp.cursor',
      }),
    ).toBe('0');
    expect(h.cursor).toHaveBeenCalledWith(4);
    await dispatchBrowserAction(api, h.cdp, {
      tabId: 4,
      method: 'cdp.events',
    });
    expect(h.events).toHaveBeenCalledWith(4, undefined);
    expect(
      await dispatchBrowserAction(api, h.cdp, {
        tabId: 4,
        method: 'tab.title',
      }),
    ).toBe('Example');
  });

  it('creates and names the Avru task tab group with the fixed brand color', async () => {
    const { api } = fixture();
    const group = vi.fn(() => Promise.resolve(42));
    const update = vi.fn(() => Promise.resolve({ id: 42, title: 'Research' }));
    api.tabs.get = vi.fn(() =>
      Promise.resolve({
        title: 'Example',
        url: 'https://example.test/page',
        groupId: -1,
      }),
    );
    api.tabs.group = group;
    api.tabGroups = { update };
    const result = await dispatchBrowserAction(api, cdpFixture().cdp, {
      tabId: 7,
      method: 'browser.nameSession',
      args: ['  Research  '],
    });
    expect(group).toHaveBeenCalledWith({ tabIds: [7] });
    expect(update).toHaveBeenCalledWith(42, {
      title: 'Research',
      color: 'blue',
    });
    expect(result).toEqual({ groupId: 42, title: 'Research', color: 'blue' });
  });
});
