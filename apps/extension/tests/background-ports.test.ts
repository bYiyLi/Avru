import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  browserActionPorts,
  clipboardActionPort,
} from '../entrypoints/background';

const native = vi.hoisted(() => ({
  windowGetAll: vi.fn(() => Promise.resolve([{ id: 1, focused: true }])),
  windowCreate: vi.fn(() => Promise.resolve({ id: 2 })),
  windowUpdate: vi.fn(() => Promise.resolve({ id: 1, state: 'normal' })),
  history: vi.fn(() => Promise.resolve([{ id: 'visit' }])),
  tabGet: vi.fn(() => Promise.resolve({ id: 7, url: 'https://example.test' })),
  tabCreate: vi.fn(() => Promise.resolve({ id: 8 })),
  tabRemove: vi.fn(() => Promise.resolve()),
  tabMove: vi.fn(() => Promise.resolve({ id: 7 })),
  tabUpdate: vi.fn(() =>
    Promise.resolve<{ id: number; active: boolean } | undefined>({
      id: 7,
      active: true,
    }),
  ),
  tabQuery: vi.fn(() => Promise.resolve([{ id: 7 }])),
  tabGroup: vi.fn(() => Promise.resolve(42)),
  tabUngroup: vi.fn(() => Promise.resolve()),
  tabMessage: vi.fn(() => Promise.resolve({ ok: true })),
  groupGet: vi.fn(() => Promise.resolve({ id: 42 })),
  groupQuery: vi.fn(() => Promise.resolve([{ id: 42 }])),
  groupUpdate: vi.fn(() => Promise.resolve({ id: 42 })),
  groupMove: vi.fn(() => Promise.resolve({ id: 42 })),
  bookmarkSearch: vi.fn(() => Promise.resolve([{ id: 'b1' }])),
  bookmarkTree: vi.fn(() => Promise.resolve([{ id: 'root' }])),
  bookmarkCreate: vi.fn(() => Promise.resolve({ id: 'b2' })),
  bookmarkUpdate: vi.fn(() => Promise.resolve({ id: 'b1' })),
  bookmarkMove: vi.fn(() => Promise.resolve({ id: 'b1' })),
  bookmarkRemove: vi.fn(() => Promise.resolve()),
  download: vi.fn(() => Promise.resolve(9)),
  downloadSearch: vi.fn(() => Promise.resolve([{ id: 9 }])),
  downloadRemove: vi.fn(() => Promise.resolve()),
  storageGet: vi.fn(() => Promise.resolve({ key: 'saved' })),
  storageSet: vi.fn(() => Promise.resolve()),
  storageRemove: vi.fn(() => Promise.resolve()),
  executeScript: vi.fn(() => Promise.resolve([{ result: 'ok' }])),
}));

vi.mock('wxt/utils/define-background', () => ({
  defineBackground: (callback: () => void) => callback,
}));
vi.mock('wxt/browser', () => ({
  browser: {
    windows: {
      getAll: native.windowGetAll,
      create: native.windowCreate,
      update: native.windowUpdate,
    },
    history: { search: native.history },
    tabs: {
      get: native.tabGet,
      create: native.tabCreate,
      remove: native.tabRemove,
      move: native.tabMove,
      update: native.tabUpdate,
      query: native.tabQuery,
      group: native.tabGroup,
      ungroup: native.tabUngroup,
      sendMessage: native.tabMessage,
    },
    tabGroups: {
      get: native.groupGet,
      query: native.groupQuery,
      update: native.groupUpdate,
      move: native.groupMove,
    },
    bookmarks: {
      search: native.bookmarkSearch,
      getTree: native.bookmarkTree,
      create: native.bookmarkCreate,
      update: native.bookmarkUpdate,
      move: native.bookmarkMove,
      remove: native.bookmarkRemove,
    },
    downloads: {
      download: native.download,
      search: native.downloadSearch,
      removeFile: native.downloadRemove,
    },
    storage: {
      local: {
        get: native.storageGet,
        set: native.storageSet,
        remove: native.storageRemove,
      },
    },
    scripting: { executeScript: native.executeScript },
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('extension browser ports use native APIs of this connected profile', () => {
  it('forwards window enumeration, creation and updates', async () => {
    const port = browserActionPorts();
    expect(await port.windows?.getAll({ populate: false })).toEqual([
      { id: 1, focused: true },
    ]);
    expect(await port.windows?.create?.({ focused: true })).toEqual({ id: 2 });
    expect(await port.windows?.update?.(1, { state: 'normal' })).toHaveProperty(
      'id',
      1,
    );
    expect(native.windowGetAll).toHaveBeenCalledWith({ populate: false });
    expect(native.windowCreate).toHaveBeenCalledWith({ focused: true });
    expect(native.windowUpdate).toHaveBeenCalledWith(1, { state: 'normal' });
  });

  it('forwards tab CRUD, selection, grouping and extension content messages', async () => {
    const tabs = browserActionPorts().tabs;
    expect(await tabs.get(7)).toHaveProperty('id', 7);
    expect(await tabs.create?.({ url: 'https://example.test' })).toHaveProperty(
      'id',
      8,
    );
    await tabs.remove?.(7);
    await tabs.move?.(7, { index: 2 });
    expect(await tabs.update?.(7, { active: true })).toHaveProperty(
      'active',
      true,
    );
    await tabs.query?.({ active: true });
    await tabs.group?.({ tabIds: [7] });
    await tabs.ungroup?.([7]);
    await tabs.sendMessage?.(7, { type: 'test' });
    expect(native.tabCreate).toHaveBeenCalledWith({
      url: 'https://example.test',
    });
    expect(native.tabRemove).toHaveBeenCalledWith(7);
    expect(native.tabMove).toHaveBeenCalledWith(7, { index: 2 });
    expect(native.tabUpdate).toHaveBeenCalledWith(7, { active: true });
    expect(native.tabQuery).toHaveBeenCalledWith({ active: true });
    expect(native.tabGroup).toHaveBeenCalledWith({ tabIds: [7] });
    expect(native.tabUngroup).toHaveBeenCalledWith([7]);
    expect(native.tabMessage).toHaveBeenCalledWith(7, { type: 'test' });
  });

  it('normalizes a native tab-update that returns undefined', async () => {
    native.tabUpdate.mockResolvedValueOnce(undefined);
    expect(
      await browserActionPorts().tabs.update?.(7, { active: true }),
    ).toEqual({});
  });

  it('forwards tab-group and bookmark APIs without changing the user-supplied IDs', async () => {
    const port = browserActionPorts();
    await port.tabGroups?.get?.(42);
    await port.tabGroups?.query?.({ windowId: 1 });
    await port.tabGroups?.update(42, { title: 'Session' });
    await port.tabGroups?.move?.(42, { index: 0 });
    await port.bookmarks?.search('research');
    await port.bookmarks?.getTree();
    await port.bookmarks?.create({
      title: 'Page',
      url: 'https://example.test',
    });
    await port.bookmarks?.update('b1', { title: 'New title' });
    await port.bookmarks?.move('b1', { parentId: 'root' });
    await port.bookmarks?.remove('b1');
    expect(native.groupGet).toHaveBeenCalledWith(42);
    expect(native.groupQuery).toHaveBeenCalledWith({ windowId: 1 });
    expect(native.groupUpdate).toHaveBeenCalledWith(42, { title: 'Session' });
    expect(native.groupMove).toHaveBeenCalledWith(42, { index: 0 });
    expect(native.bookmarkSearch).toHaveBeenCalledWith('research');
    expect(native.bookmarkTree).toHaveBeenCalledOnce();
    expect(native.bookmarkCreate).toHaveBeenCalledWith({
      title: 'Page',
      url: 'https://example.test',
    });
    expect(native.bookmarkUpdate).toHaveBeenCalledWith('b1', {
      title: 'New title',
    });
    expect(native.bookmarkMove).toHaveBeenCalledWith('b1', {
      parentId: 'root',
    });
    expect(native.bookmarkRemove).toHaveBeenCalledWith('b1');
  });

  it('forwards history, download, storage and scripting calls to Chrome', async () => {
    const port = browserActionPorts();
    await port.history?.search({ text: 'avru', maxResults: 10, startTime: 0 });
    await port.downloads?.download({ url: 'https://example.test/file' });
    await port.downloads?.search({ id: 9 });
    await port.downloads?.removeFile?.(9);
    await port.storage?.get('key');
    await port.storage?.set({ key: 'updated' });
    await port.storage?.remove('key');
    await port.scripting.executeScript({
      target: { tabId: 7 },
      func: () => ({ title: '', url: '', text: '' }),
    });
    expect(native.history).toHaveBeenCalledWith({
      text: 'avru',
      maxResults: 10,
      startTime: 0,
    });
    expect(native.download).toHaveBeenCalledWith({
      url: 'https://example.test/file',
    });
    expect(native.downloadSearch).toHaveBeenCalledWith({ id: 9 });
    expect(native.downloadRemove).toHaveBeenCalledWith(9);
    expect(native.storageGet).toHaveBeenCalledWith('key');
    expect(native.storageSet).toHaveBeenCalledWith({ key: 'updated' });
    expect(native.storageRemove).toHaveBeenCalledWith('key');
    expect(native.executeScript).toHaveBeenCalledOnce();
  });
});

describe('extension clipboard port handles multi-format contents in its service worker', () => {
  it('reads text plus binary items with bounded native blob decoding', async () => {
    const getType = vi.fn((type: string) =>
      Promise.resolve(
        type === 'text/plain'
          ? new Blob(['Avru text'], { type: 'text/plain' })
          : new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
      ),
    );
    const read = vi.fn(() =>
      Promise.resolve([{ types: ['text/plain', 'image/png'], getType }]),
    );
    const readText = vi.fn(() => Promise.resolve('Avru text'));
    vi.stubGlobal('navigator', { clipboard: { read, readText } });
    const port = clipboardActionPort();
    expect(await port.read?.()).toEqual([
      {
        entries: [
          { mimeType: 'text/plain', text: 'Avru text' },
          { mimeType: 'image/png', base64: 'AQID' },
        ],
        presentationStyle: 'unspecified',
      },
    ]);
    expect(await port.readText?.()).toBe('Avru text');
    expect(getType).toHaveBeenCalledWith('text/plain');
    expect(getType).toHaveBeenCalledWith('image/png');
  });

  it('refuses read API absence and oversized native clipboard contents', async () => {
    vi.stubGlobal('navigator', { clipboard: { read: null } });
    await expect(clipboardActionPort().read?.()).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
    const read = vi.fn(() =>
      Promise.resolve([
        {
          types: ['image/png'],
          getType: () => Promise.resolve(new Blob([new Uint8Array(65_537)])),
        },
      ]),
    );
    vi.stubGlobal('navigator', { clipboard: { read } });
    await expect(clipboardActionPort().read?.()).rejects.toThrow(
      'OUTPUT_TOO_LARGE',
    );
  });

  it('never reads more than 8 items or 8 types per item', async () => {
    const getType = vi.fn(() => Promise.resolve(new Blob(['a'])));
    vi.stubGlobal('navigator', {
      clipboard: {
        read: () =>
          Promise.resolve(
            Array.from({ length: 10 }, () => ({
              types: Array.from({ length: 10 }, (_, i) => `text/t${String(i)}`),
              getType,
            })),
          ),
      },
    });
    const entries = (await clipboardActionPort().read?.()) as {
      entries: unknown[];
    }[];
    expect(entries).toHaveLength(8);
    expect(entries[0]?.entries).toHaveLength(8);
    expect(getType).toHaveBeenCalledTimes(64);
  });

  it('stops decoding further types when the per-request byte quota is exhausted', async () => {
    const getType = vi.fn(() =>
      Promise.resolve(new Blob([new Uint8Array(65_536)])),
    );
    vi.stubGlobal('navigator', {
      clipboard: {
        read: () =>
          Promise.resolve([{ types: ['image/png', 'image/jpeg'], getType }]),
      },
    });
    const entries = (await clipboardActionPort().read?.()) as {
      entries: unknown[];
    }[];
    expect(entries[0]?.entries).toHaveLength(1);
    expect(getType).toHaveBeenCalledOnce();
  });

  it('writes UTF-8 text and binary MIME types as a native ClipboardItem', async () => {
    const written: Record<string, Blob>[] = [];
    const write = vi.fn(() => Promise.resolve());
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { write, writeText } });
    vi.stubGlobal(
      'ClipboardItem',
      class {
        readonly data: Record<string, Blob>;
        constructor(value: Record<string, Blob>) {
          this.data = value;
          written.push(value);
        }
      },
    );
    const port = clipboardActionPort();
    await port.writeText?.('Hello world');
    await port.write?.([
      {
        entries: [
          { mimeType: 'text/plain', text: '你好' },
          { mimeType: 'image/png', base64: 'AQID' },
        ],
      },
    ]);
    expect(writeText).toHaveBeenCalledWith('Hello world');
    expect(write).toHaveBeenCalledOnce();
    expect(written).toHaveLength(1);
    expect(await written[0]?.['text/plain']?.text()).toBe('你好');
    const image = written[0]?.['image/png'];
    if (!image) throw new Error('Missing clipboard image');
    expect([...new Uint8Array(await image.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it('reports an unavailable native clipboard write permission', async () => {
    vi.stubGlobal('navigator', { clipboard: {} });
    await expect(
      clipboardActionPort().write?.([{ entries: [] }]),
    ).rejects.toThrow('CAPABILITY_NOT_ALLOWED');
  });
});
