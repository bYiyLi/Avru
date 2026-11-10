import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserActionAPI } from '../utils/browser-ports';
import { dispatchDownloadAction } from '../utils/download-actions';

type Download = Awaited<
  ReturnType<NonNullable<BrowserActionAPI['downloads']>['search']>
>[number];

const item = (id: number, tabId = 7): Download => ({
  id,
  tabId,
  url: `https://example.test/${String(id)}`,
  filename: `/tmp/subdir/${String(id)}.png`,
  state: 'complete',
});

function fixture(items: Download[] = [item(8)]) {
  const search = vi.fn(() => Promise.resolve(items));
  const download = vi.fn(() => Promise.resolve(8));
  const api: BrowserActionAPI = {
    tabs: { get: () => Promise.resolve({}) },
    scripting: { executeScript: () => Promise.resolve([]) },
    downloads: { search, download },
  };
  const run = (method: string, args: unknown[] = []) =>
    dispatchDownloadAction(api, 7, method, args);
  return { api, search, download, run };
}

afterEach(() => vi.useRealTimers());

describe('download SDK browser profile dispatch', () => {
  it('lists only downloads belonging to the requested tab in newest-first order', async () => {
    const h = fixture([item(3), item(21, 99), item(2), item(9)]);
    expect(await h.run('tab.downloads')).toEqual([
      {
        downloadId: '9',
        url: 'https://example.test/9',
        suggestedFilename: '9.png',
      },
      {
        downloadId: '3',
        url: 'https://example.test/3',
        suggestedFilename: '3.png',
      },
      {
        downloadId: '2',
        url: 'https://example.test/2',
        suggestedFilename: '2.png',
      },
    ]);
    expect(h.search).toHaveBeenCalledWith({ limit: 100 });
    await expect(h.run('tab.downloads', ['unexpected'])).rejects.toThrow(
      'INVALID_ARGUMENT',
    );
  });

  it('produces a filename fallback for nameless downloads and limits the result count', async () => {
    const downloads = Array.from({ length: 120 }, (_, index) => ({
      ...item(index),
      filename: index === 119 ? '/' : `C:\\media\\file${String(index)}.jpg`,
    }));
    const h = fixture(downloads);
    const result = (await h.run('tab.downloads')) as {
      suggestedFilename: string;
    }[];
    expect(result).toHaveLength(100);
    expect(result[0]?.suggestedFilename).toBe('download');
    expect(result[1]?.suggestedFilename).toBe('file118.jpg');
  });

  it('rejects missing permissions and unknown operations', async () => {
    const h = fixture();
    delete h.api.downloads;
    for (const method of [
      'tab.downloads',
      'tab.waitForDownload',
      'tab.downloadMedia',
      'tab.saveDownload',
    ]) {
      const args =
        method === 'tab.downloadMedia'
          ? ['https://example.test/file']
          : method === 'tab.saveDownload'
            ? [1]
            : [];
      await expect(h.run(method, args)).rejects.toThrow(
        'CAPABILITY_NOT_ALLOWED',
      );
    }
    await expect(h.run('not-a-download')).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
  });

  it('observes a newly completed download without reporting prior tab history', async () => {
    const h = fixture();
    h.search.mockResolvedValueOnce([item(8)]);
    h.search.mockResolvedValueOnce([item(8), item(11, 99), item(9)]);
    expect(await h.run('tab.waitForDownload', [{ timeoutMs: 2000 }])).toEqual({
      downloadId: '9',
      url: 'https://example.test/9',
      suggestedFilename: '9.png',
    });
    expect(h.search).toHaveBeenCalledTimes(2);
  });

  it('preserves a browser download interruption error', async () => {
    const h = fixture();
    const interrupted: Download = {
      ...item(9),
      state: 'interrupted',
      error: 'NETWORK_FAILED',
    };
    h.search.mockResolvedValueOnce([]).mockResolvedValueOnce([interrupted]);
    await expect(h.run('tab.waitForDownload')).rejects.toThrow(
      'NETWORK_FAILED',
    );
    h.search
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...interrupted, error: undefined }]);
    await expect(h.run('tab.waitForDownload')).rejects.toThrow(
      'PAGE_NOT_ACCESSIBLE',
    );
  });

  it('validates event timeout and request options', async () => {
    const h = fixture();
    for (const args of [
      [null],
      [true],
      [1, 2],
      [{ timeoutMs: 0 }],
      [{ timeoutMs: 300001 }],
      [{ timeoutMs: 1.5 }],
      [{ timeoutMs: '2' }],
    ])
      await expect(h.run('tab.waitForDownload', args)).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    expect(h.search).not.toHaveBeenCalled();
  });

  it('times out when a new download never arrives', async () => {
    vi.useFakeTimers();
    const h = fixture();
    const promise = h.run('tab.waitForDownload', [{ timeoutMs: 1 }]);
    const rejection = expect(promise).rejects.toThrow('TIMEOUT');
    await vi.advanceTimersByTimeAsync(205);
    await rejection;
  });

  it('creates a media download with its actual saved path', async () => {
    const h = fixture([item(8)]);
    expect(
      await h.run('tab.downloadMedia', [
        'https://example.test/file',
        {
          filename: 'product.jpg',
          timeoutMs: 2000,
        },
      ]),
    ).toEqual({ path: '/tmp/subdir/8.png', downloadId: '8' });
    expect(h.download).toHaveBeenCalledWith({
      url: 'https://example.test/file',
      filename: 'product.jpg',
      saveAs: false,
      conflictAction: 'uniquify',
    });
    expect(h.search).toHaveBeenCalledWith({ id: 8 });
  });

  it('preserves interrupted media downloads and times out correctly', async () => {
    const h = fixture([
      { ...item(8), state: 'interrupted', error: 'SERVER_FAILED' },
    ]);
    await expect(
      h.run('tab.downloadMedia', ['https://example.test/f']),
    ).rejects.toThrow('SERVER_FAILED');
    vi.useFakeTimers();
    const missing = fixture([]);
    const promise = missing.run('tab.downloadMedia', [
      'https://example.test/f',
      { timeoutMs: 1 },
    ]);
    const rejection = expect(promise).rejects.toThrow('TIMEOUT');
    await vi.advanceTimersByTimeAsync(205);
    await rejection;
  });

  it('rejects invalid URLs and download options before browser side effects', async () => {
    const h = fixture();
    for (const args of [
      [],
      [1],
      ['file:///tmp/foo'],
      ['javascript:alert(1)'],
      ['https://example.test/' + 'x'.repeat(8192)],
      ['https://example.test/', null],
      ['https://example.test/', []],
      ['https://example.test/', { filename: '' }],
      ['https://example.test/', { filename: 3 }],
      ['https://example.test/', { filename: 'a'.repeat(256) }],
      ['https://example.test/', { timeoutMs: 0 }],
      ['https://example.test/', { timeoutMs: 300001 }],
      ['https://example.test/', { timeoutMs: '100' }],
      ['https://example.test/', {}, 1],
    ])
      await expect(h.run('tab.downloadMedia', args)).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    expect(h.download).not.toHaveBeenCalled();
  });

  it('resolves a completed download, including the SDK default null destination', async () => {
    const h = fixture([item(8)]);
    expect(await h.run('tab.saveDownload', [8])).toEqual({
      path: '/tmp/subdir/8.png',
    });
    expect(await h.run('tab.saveDownload', ['8', null])).toEqual({
      path: '/tmp/subdir/8.png',
    });
    expect(await h.run('tab.saveDownload', ['8', '/tmp/subdir/8.png'])).toEqual(
      {
        path: '/tmp/subdir/8.png',
      },
    );
  });

  it('refuses to write a download to an arbitrary caller-provided path', async () => {
    const h = fixture([item(8)]);
    await expect(h.run('tab.saveDownload', [8, '/tmp/other'])).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
    for (const args of [
      [],
      [8, '/tmp/file', 'extra'],
      [-1],
      ['NaN'],
      ['1.5'],
      [Number.MAX_SAFE_INTEGER + 1],
      [8, {}],
    ])
      await expect(h.run('tab.saveDownload', args)).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    h.search.mockResolvedValueOnce([]);
    await expect(h.run('tab.saveDownload', [2])).rejects.toThrow(
      'INVALID_TARGET',
    );
    h.search.mockResolvedValueOnce([{ ...item(8), state: 'in_progress' }]);
    await expect(h.run('tab.saveDownload', [8])).rejects.toThrow('TIMEOUT');
  });
});
