import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserActionAPI } from '../utils/browser-ports';
import type { CdpController } from '../utils/cdp';
import { dispatchPageCapability } from '../utils/page-capabilities';

type Download = Awaited<
  ReturnType<NonNullable<BrowserActionAPI['downloads']>['search']>
>[number];

function fixture(value: unknown = []) {
  let response: unknown = value;
  const send = vi.fn(() => Promise.resolve({ result: { value: response } }));
  const download = vi.fn(() => Promise.resolve(16));
  let downloads: Download[] = [
    {
      id: 16,
      url: 'https://example.test/a.png',
      filename: '/Users/demo/Downloads/a.png',
      state: 'complete',
    },
  ];
  const search = vi.fn(() => Promise.resolve(downloads));
  const api: BrowserActionAPI = {
    tabs: {
      get: () =>
        Promise.resolve({ title: 'Sample', url: 'https://example.test/' }),
    },
    scripting: { executeScript: () => Promise.resolve([]) },
    downloads: { download, search },
  };
  const cdp = { send } as unknown as Pick<CdpController, 'send'>;
  const call = (method: string, args: unknown[] = []) =>
    dispatchPageCapability({ api, cdp, tabId: 7 }, method, args);
  const set = (next: unknown) => {
    response = next;
  };
  const setDownloads = (items: Download[]) => {
    downloads = items;
  };
  return { api, send, download, search, call, set, setDownloads };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('page assets over CDP', () => {
  it('reads and deduplicates resource entries without exposing invalid records', async () => {
    const h = fixture([
      { url: 'https://example.test/a.js', type: 'script', size: 4 },
      { url: 'https://example.test/a.js', type: 'image', size: 5 },
      null,
      {},
      1,
      { url: 2, type: 'script' },
      { url: 'https://example.test/b', type: null },
      { url: 'https://example.test/b.png', type: 'img' },
    ]);
    expect(await h.call('tab.assets.list')).toEqual([
      { url: 'https://example.test/a.js', type: 'script', size: 4 },
      { url: 'https://example.test/b.png', type: 'img' },
    ]);
    expect(h.send).toHaveBeenCalledWith(
      7,
      'Runtime.evaluate',
      expect.objectContaining({
        returnByValue: true,
      }),
    );
    await expect(h.call('tab.assets.list', ['extra'])).rejects.toThrow(
      'INVALID_ARGUMENT',
    );
  });

  it('refuses missing or malformed CDP resource responses', async () => {
    const h = fixture(null);
    await expect(h.call('tab.assets.list')).rejects.toThrow(
      'PAGE_NOT_ACCESSIBLE',
    );
    h.set({ resources: [] });
    await expect(h.call('tab.assets.list')).rejects.toThrow(
      'PAGE_NOT_ACCESSIBLE',
    );
    h.set([]);
    await expect(h.call('tab.assets.list')).resolves.toEqual([]);
  });

  it('bundles selected URL assets and returns real download paths', async () => {
    const h = fixture();
    expect(
      await h.call('tab.assets.bundle', [['https://example.test/a.png']]),
    ).toEqual({
      files: [
        {
          url: 'https://example.test/a.png',
          path: '/Users/demo/Downloads/a.png',
        },
      ],
    });
    expect(h.download).toHaveBeenCalledWith({
      url: 'https://example.test/a.png',
      saveAs: false,
      conflictAction: 'uniquify',
    });
    expect(h.search).toHaveBeenCalledWith({ id: 16 });
    expect(
      await h.call('tab.assets.bundle', [
        { urls: ['http://example.test/first', 'https://example.test/second'] },
      ]),
    ).toEqual({
      files: [
        {
          url: 'http://example.test/first',
          path: '/Users/demo/Downloads/a.png',
        },
        {
          url: 'https://example.test/second',
          path: '/Users/demo/Downloads/a.png',
        },
      ],
    });
  });

  it('validates the supplied URL array and respects browser download capability', async () => {
    const h = fixture();
    for (const args of [
      [],
      [null],
      [true],
      [{}],
      [2],
      [[], []],
      [[]],
      [Array.from({ length: 21 }, () => 'https://example.test/a')],
      [['file:///tmp/path']],
      [['javascript:alert(1)']],
      [['data:image/png;base64,AAAA']],
      [['/relative/path']],
      [['https://example.test/' + 'x'.repeat(4097)]],
      [[1]],
    ])
      await expect(h.call('tab.assets.bundle', args)).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    expect(h.download).not.toHaveBeenCalled();
    delete h.api.downloads;
    await expect(
      h.call('tab.assets.bundle', [['https://example.test/a']]),
    ).rejects.toThrow('CAPABILITY_NOT_ALLOWED');
  });

  it('propagates interruptions without inventing a local file path', async () => {
    const h = fixture();
    h.setDownloads([
      {
        id: 16,
        url: 'https://example.test/a',
        filename: '',
        state: 'interrupted',
        error: 'SERVER_FAILED',
      },
    ]);
    await expect(
      h.call('tab.assets.bundle', [['https://example.test/a']]),
    ).rejects.toThrow('SERVER_FAILED');
    h.setDownloads([
      {
        id: 16,
        url: 'https://example.test/a',
        filename: '',
        state: 'interrupted',
      },
    ]);
    await expect(
      h.call('tab.assets.bundle', [['https://example.test/a']]),
    ).rejects.toThrow('PAGE_NOT_ACCESSIBLE');
  });

  it('times out an asset download when Chrome never reports completion', async () => {
    vi.useFakeTimers();
    const h = fixture();
    h.setDownloads([]);
    vi.setSystemTime(0);
    const pending = h.call('tab.assets.bundle', [['https://example.test/a']]);
    const rejection = expect(pending).rejects.toThrow('TIMEOUT');
    await vi.advanceTimersByTimeAsync(120_500);
    await rejection;
  });
});

describe('document WebMCP page tools', () => {
  it('discovers tools through the page modelContext interface', async () => {
    const h = fixture([
      { name: 'search', title: 'Search', inputSchema: { type: 'object' } },
    ]);
    expect(await h.call('tab.webmcp.fetchTools')).toEqual([
      { name: 'search', title: 'Search', inputSchema: { type: 'object' } },
    ]);
    const args = (
      h.send.mock.calls as unknown as [
        number,
        string,
        Record<string, unknown>,
      ][]
    )[0]?.[2];
    expect(args?.expression).toContain('navigator.modelContext');
    expect(args?.awaitPromise).toBe(true);
  });

  it('reports absent or unexpected WebMCP browser support honestly', async () => {
    const h = fixture({ unavailable: true });
    await expect(h.call('tab.webmcp.fetchTools')).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
    h.set(null);
    await expect(h.call('tab.webmcp.fetchTools')).rejects.toThrow(
      'PAGE_NOT_ACCESSIBLE',
    );
    h.set({});
    await expect(h.call('tab.webmcp.fetchTools')).rejects.toThrow(
      'PAGE_NOT_ACCESSIBLE',
    );
    h.set([{ name: 'a'.repeat(56_000) }]);
    await expect(h.call('tab.webmcp.fetchTools')).rejects.toThrow(
      'OUTPUT_TOO_LARGE',
    );
  });

  it('validates discover arguments before executing page code', async () => {
    const h = fixture();
    await expect(h.call('tab.webmcp.fetchTools', [{}])).rejects.toThrow(
      'INVALID_ARGUMENT',
    );
    expect(h.send).not.toHaveBeenCalled();
  });

  it('invokes the named native document tool and returns only its result', async () => {
    const h = fixture({ result: { count: 3 } });
    expect(
      await h.call('tab.webmcp.invokeTool', ['countLinks', { root: 'main' }]),
    ).toEqual({ count: 3 });
    expect(h.send).toHaveBeenCalledWith(
      7,
      'Runtime.evaluate',
      expect.objectContaining({
        awaitPromise: true,
        returnByValue: true,
      }),
    );
    h.set({});
    expect(await h.call('tab.webmcp.invokeTool', ['countLinks', {}])).toBe(
      null,
    );
  });

  it('preserves returned error codes, and rejects oversized or malformed results', async () => {
    const h = fixture({ error: 'ELEMENT_NOT_FOUND' });
    await expect(
      h.call('tab.webmcp.invokeTool', ['missing', {}]),
    ).rejects.toThrow('ELEMENT_NOT_FOUND');
    h.set({ result: 'x'.repeat(60_000) });
    await expect(
      h.call('tab.webmcp.invokeTool', ['tooBig', {}]),
    ).rejects.toThrow('OUTPUT_TOO_LARGE');
    h.set([1]);
    await expect(
      h.call('tab.webmcp.invokeTool', ['unknown', {}]),
    ).rejects.toThrow('PAGE_NOT_ACCESSIBLE');
  });

  it('rejects invalid tool input and huge serialized arguments before CDP', async () => {
    const h = fixture({});
    for (const args of [
      [],
      ['name'],
      ['', {}],
      ['a'.repeat(129), {}],
      ['valid', null],
      ['valid', []],
      ['valid', { x: 'a'.repeat(8192) }],
      ['valid', {}, {}],
    ]) {
      await expect(h.call('tab.webmcp.invokeTool', args)).rejects.toThrow(
        /INVALID_ARGUMENT|OUTPUT_TOO_LARGE/u,
      );
    }
    expect(h.send).not.toHaveBeenCalled();
  });

  it('returns the real export-capability error for unknown methods', async () => {
    const h = fixture();
    await expect(h.call('unknown')).rejects.toThrow('CAPABILITY_NOT_ALLOWED');
  });
});
