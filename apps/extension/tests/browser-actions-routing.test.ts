import { describe, expect, it, vi } from 'vitest';
import type { BrowserActionAPI } from '../utils/browser-ports';
import type { CdpController } from '../utils/cdp';
import { dispatchBrowserAction } from '../utils/browser-actions';

const handlers = vi.hoisted(() => ({
  content: vi.fn(() => Promise.resolve('content')),
  history: vi.fn(() => Promise.resolve('history')),
  management: vi.fn(() => Promise.resolve('management')),
  visibility: vi.fn(() => Promise.resolve('visibility')),
  session: vi.fn(() => Promise.resolve('session')),
  favicon: vi.fn(() => Promise.resolve('favicon')),
  cursor: vi.fn(() => Promise.resolve('cursor')),
  clipboard: vi.fn(() => Promise.resolve('clipboard')),
  files: vi.fn(() => Promise.resolve('files')),
  page: vi.fn(() => Promise.resolve('page')),
  observability: vi.fn(() => Promise.resolve('observability')),
  downloads: vi.fn(() => Promise.resolve('downloads')),
}));
vi.mock('../utils/tabs-content', () => ({ readTabsContent: handlers.content }));
vi.mock('../utils/browser-history', () => ({
  searchBrowserHistory: handlers.history,
}));
vi.mock('../utils/management-actions', () => ({
  dispatchManagementAction: handlers.management,
  browserVisibility: handlers.visibility,
  nameSession: handlers.session,
  setFaviconStatus: handlers.favicon,
  showVirtualCursor: handlers.cursor,
}));
vi.mock('../utils/clipboard-actions', () => ({
  dispatchClipboardAction: handlers.clipboard,
}));
vi.mock('../utils/file-actions', () => ({ setInputFiles: handlers.files }));
vi.mock('../utils/page-capabilities', () => ({
  dispatchPageCapability: handlers.page,
}));
vi.mock('../utils/observability-actions', () => ({
  dispatchObservabilityAction: handlers.observability,
}));
vi.mock('../utils/download-actions', () => ({
  dispatchDownloadAction: handlers.downloads,
}));

function fixture() {
  const get = vi.fn(() =>
    Promise.resolve({
      id: 7,
      title: 'Title',
      url: 'https://example.test',
      windowId: 4,
    }),
  );
  const query = vi.fn(() =>
    Promise.resolve([{ id: 7, title: 'Active', url: 'https://example.test' }]),
  );
  const create = vi.fn(() =>
    Promise.resolve({
      id: 22,
      title: 'Created',
      url: 'https://example.test/new',
    }),
  );
  const update = vi.fn(() => Promise.resolve({ id: 7, active: true }));
  const remove = vi.fn(() => Promise.resolve());
  const move = vi.fn(() => Promise.resolve({ id: 7, windowId: 4, index: 0 }));
  const getAll = vi.fn(() =>
    Promise.resolve([
      {
        id: 4,
        incognito: false,
        focused: true,
        type: 'normal',
        state: 'normal',
      },
      { id: 5, incognito: true, focused: true },
    ]),
  );
  const api: BrowserActionAPI = {
    tabs: { get, query, create, update, remove, move },
    windows: { getAll },
    scripting: { executeScript: () => Promise.resolve([]) },
  };
  const send = vi.fn(() => Promise.resolve({ success: true }));
  const cursor = vi.fn(() => Promise.resolve('2'));
  const events = vi.fn(() => Promise.resolve({ events: [], nextCursor: '2' }));
  const resume = vi.fn();
  const cdp = { send, cursor, events, resume } as unknown as CdpController;
  const call = (method: string, args: unknown[] = []) =>
    dispatchBrowserAction(api, cdp, { tabId: 7, method, args });
  return {
    api,
    cdp,
    get,
    query,
    create,
    update,
    remove,
    move,
    getAll,
    send,
    cursor,
    events,
    resume,
    call,
  };
}

describe('browser SDK high-level dispatch uses the selected action adapter', () => {
  it('never blocks a real task when both start and finish overlay work fail', async () => {
    const h = fixture();
    handlers.favicon.mockRejectedValueOnce(new Error('page unavailable'));
    await expect(
      h.call('tab.execution.start', ['task-a', 'Research']),
    ).resolves.toEqual({
      ok: true,
    });
    expect(h.resume).toHaveBeenCalledWith(7);
    handlers.cursor.mockRejectedValueOnce(
      new Error('content script disconnected'),
    );
    await expect(
      h.call('tab.execution.finish', ['task-a', 'cancelled']),
    ).resolves.toEqual({
      ok: true,
    });
    for (let index = 0; index < 5; index++) await Promise.resolve();
    expect(handlers.favicon).toHaveBeenCalledWith(h.api, 7, [
      'task-a',
      'clear',
    ]);
  });

  it('routes native windows, management, visibility and task-branding capabilities', async () => {
    const h = fixture();
    const samples: [string, string][] = [
      ['management.invoke', 'management'],
      ['browser.visibility.get', 'visibility'],
      ['browser.visibility.set', 'visibility'],
      ['tab.favicon.status', 'favicon'],
      ['tab.visual.cursor', 'cursor'],
      ['browser.nameSession', 'session'],
    ];
    for (const [method, result] of samples)
      expect(await h.call(method, [true])).toBe(result);
    expect(handlers.management).toHaveBeenCalledWith(h.api, [true]);
    expect(handlers.visibility).toHaveBeenCalledWith(
      h.api,
      'browser.visibility.set',
      [true],
    );
    expect(handlers.favicon).toHaveBeenCalledWith(h.api, 7, [true]);
    expect(handlers.cursor).toHaveBeenCalledWith(h.api, 7, [true]);
    expect(handlers.session).toHaveBeenCalledWith(h.api, 7, [true]);
  });

  it('routes every advanced observation, file, content and WebMCP method', async () => {
    const h = fixture();
    for (const method of [
      'cdp.readEvents',
      'tab.dev.logs',
      'tab.getJsDialog',
      'tab.dialogAccept',
      'tab.dialogDismiss',
    ]) {
      expect(await h.call(method, ['call'])).toBe('observability');
      expect(handlers.observability).toHaveBeenCalledWith(h.cdp, 7, method, [
        'call',
      ]);
    }
    expect(await h.call('tab.setFiles', ['ref', []])).toBe('files');
    expect(handlers.files).toHaveBeenCalledWith(h.api, h.cdp, 7, ['ref', []]);
    for (const method of [
      'tab.exportFile',
      'tab.content.export',
      'tab.content.exportGsuite',
      'tab.content.exportYouTubeTranscript',
      'tab.assets.list',
      'tab.assets.bundle',
      'tab.webmcp.fetchTools',
      'tab.webmcp.invokeTool',
    ]) {
      expect(await h.call(method, [{ format: 'html' }])).toBe('page');
      expect(handlers.page).toHaveBeenCalledWith(
        { api: h.api, cdp: h.cdp, tabId: 7 },
        method,
        [{ format: 'html' }],
      );
    }
  });

  it('routes download, history and clipboard tools without a second permission confirmation', async () => {
    const h = fixture();
    for (const method of [
      'tab.downloads',
      'tab.waitForDownload',
      'tab.downloadMedia',
      'tab.saveDownload',
    ]) {
      expect(await h.call(method, ['option'])).toBe('downloads');
      expect(handlers.downloads).toHaveBeenCalledWith(h.api, 7, method, [
        'option',
      ]);
    }
    expect(await h.call('history.search', [{ text: 'search' }])).toBe(
      'history',
    );
    expect(handlers.history).toHaveBeenCalledWith(h.api, [{ text: 'search' }]);
    for (const method of [
      'tab.clipboard.read',
      'tab.clipboard.readText',
      'tab.clipboard.write',
      'tab.clipboard.writeText',
    ]) {
      expect(await h.call(method, ['test'])).toBe('clipboard');
      expect(handlers.clipboard).toHaveBeenCalledWith(h.api, method, ['test']);
    }
  });

  it('maps deliverable, handoff and takeover to the native completion badge', async () => {
    const h = fixture();
    for (const method of ['tab.markDeliverable', 'tab.markHandoff']) {
      expect(await h.call(method)).toBe('favicon');
      expect(handlers.favicon).toHaveBeenCalledWith(h.api, 7, [
        'manual',
        'done',
      ]);
      await expect(h.call(method, ['extra'])).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    }
    expect(await h.call('tab.requestUserTakeover')).toBe('favicon');
    expect(handlers.favicon).toHaveBeenCalledWith(h.api, 7, [
      'user_requested',
      'done',
    ]);
    expect(await h.call('tab.requestUserTakeover', ['task-id'])).toBe(
      'favicon',
    );
    expect(handlers.favicon).toHaveBeenCalledWith(h.api, 7, [
      'task-id',
      'done',
    ]);
    for (const args of [[42], ['one', 'two']])
      await expect(h.call('tab.requestUserTakeover', args)).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
  });

  it('executes and returns arbitrary CDP command and buffered event results', async () => {
    const h = fixture();
    expect(
      await h.call('cdp.send', ['Runtime.evaluate', { expression: '1+1' }]),
    ).toEqual({ success: true });
    expect(h.send).toHaveBeenCalledWith(7, 'Runtime.evaluate', {
      expression: '1+1',
    });
    expect(await h.call('cdp.events', ['2'])).toEqual({
      events: [],
      nextCursor: '2',
    });
    expect(h.events).toHaveBeenCalledWith(7, '2');
    expect(await h.call('cdp.cursor')).toBe('2');
    expect(h.cursor).toHaveBeenCalledWith(7);
    await expect(h.call('cdp.events', [2])).rejects.toThrow('INVALID_ARGUMENT');
    await expect(h.call('cdp.send', [null])).rejects.toThrow(
      'INVALID_ARGUMENT',
    );
    await expect(h.call('cdp.send', ['Page.enable', []])).rejects.toThrow(
      'INVALID_ARGUMENT',
    );
  });
});

describe('native tab action implementation and negative paths', () => {
  it('creates tabs using a nullable URL and optional selection', async () => {
    const h = fixture();
    expect(await h.call('tabs.new', [null, { active: false }])).toMatchObject({
      tabId: '22',
      title: 'Created',
    });
    expect(h.create).toHaveBeenCalledWith({ active: false });
    expect(
      await h.call('tabs.new', ['https://example.test/new']),
    ).toHaveProperty('tabId', '22');
    expect(h.create).toHaveBeenCalledWith({ url: 'https://example.test/new' });
    for (const args of [
      [3],
      [null, null],
      [null, []],
      [null, { active: 9 }],
      [null, {}, 'extra'],
    ])
      await expect(h.call('tabs.new', args)).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
  });

  it('reads the current selected tab with fallbacks for missing tab metadata', async () => {
    const h = fixture();
    expect(await h.call('tabs.selected')).toEqual({
      tabId: '7',
      title: 'Active',
      url: 'https://example.test',
    });
    expect(h.query).toHaveBeenCalledWith({ active: true, windowId: 4 });
    h.query.mockResolvedValueOnce([]);
    expect(await h.call('tabs.selected')).toBeNull();
    h.query.mockResolvedValueOnce([{ id: 7 }] as never);
    expect(await h.call('tabs.selected')).toEqual({
      tabId: '7',
      title: '',
      url: '',
    });
    await expect(h.call('tabs.selected', [7])).rejects.toThrow(
      'INVALID_ARGUMENT',
    );
    delete h.api.tabs.query;
    await expect(h.call('tabs.selected')).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
  });

  it('closes, selects and moves valid browser tabs with the exact numeric ID', async () => {
    const h = fixture();
    await h.call('tabs.close', ['7']);
    await h.call('tabs.select', ['7']);
    expect(h.remove).toHaveBeenCalledWith(7);
    expect(h.update).toHaveBeenCalledWith(7, { active: true });
    expect(
      await h.call('tabs.move', ['7', { index: 0, windowId: 4 }]),
    ).toMatchObject({
      tabId: '7',
      changed: true,
      windowId: '4',
      index: 0,
    });
    expect(h.move).toHaveBeenCalledWith(7, { index: 0, windowId: 4 });
    for (const args of [['07'], ['-1'], [7], []])
      await expect(h.call('tabs.select', args)).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    await expect(h.call('tabs.move', ['7', { index: -2 }])).rejects.toThrow(
      'INVALID_ARGUMENT',
    );
  });

  it('returns the precise capability error when native operations are unavailable', async () => {
    const h = fixture();
    delete h.api.tabs.create;
    await expect(h.call('tabs.new', [])).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
    delete h.api.tabs.remove;
    await expect(h.call('tabs.close', ['7'])).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
    delete h.api.tabs.update;
    await expect(h.call('tabs.select', ['7'])).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
    delete h.api.tabs.move;
    await expect(h.call('tabs.move', ['7', { index: 0 }])).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
    delete h.api.windows;
    await expect(h.call('windows.list')).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
  });

  it('lists only permitted regular windows and bounds the native response', async () => {
    const h = fixture();
    expect(await h.call('windows.list')).toEqual([
      {
        id: '4',
        focused: true,
        type: 'normal',
        state: 'normal',
      },
    ]);
    await expect(h.call('windows.list', [1])).rejects.toThrow(
      'INVALID_ARGUMENT',
    );
  });

  it('forwards background URL content requests through the URL reader', async () => {
    const h = fixture();
    expect(
      await h.call('tabs.content', [
        { contentType: 'text', urls: ['https://example.test'] },
      ]),
    ).toBe('content');
    expect(handlers.content).toHaveBeenCalledWith(h.api, [
      {
        contentType: 'text',
        urls: ['https://example.test'],
      },
    ]);
  });
});
