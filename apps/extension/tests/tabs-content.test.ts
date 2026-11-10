import { afterEach, describe, expect, it, vi } from 'vitest';
import { readTabsContent } from '../utils/tabs-content';
import type { TabsContentPort } from '../utils/tabs-content';

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const create = vi.fn(() => Promise.resolve({ id: 47 }));
  const get = vi.fn(() => Promise.resolve({ status: 'complete' as const }));
  const remove = vi.fn(() => Promise.resolve());
  const executeScript = vi.fn(
    (details: Parameters<TabsContentPort['scripting']['executeScript']>[0]) =>
      Promise.resolve([{ result: details.func() }]),
  );
  const api: TabsContentPort = {
    tabs: { create, get, remove },
    scripting: { executeScript },
  };
  vi.stubGlobal('location', { href: 'https://example.test/content' });
  vi.stubGlobal('document', {
    title: 'Content title',
    body: { innerText: 'Hello from the page' },
    documentElement: { outerHTML: '<html>full DOM</html>' },
    querySelectorAll: () => [
      {
        tagName: 'H1',
        getAttribute: () => null,
        innerText: 'Page heading',
        textContent: 'Page heading',
      },
    ],
  });
  return { api, create, get, remove, executeScript };
}

describe('background tabs content extraction', () => {
  it('returns bounded text from temporary background tabs and cleans up', async () => {
    const h = fixture();
    expect(
      await readTabsContent(h.api, [
        { urls: ['https://example.test/content'], contentType: 'text' },
      ]),
    ).toEqual([
      {
        url: 'https://example.test/content',
        title: 'Content title',
        content: 'Hello from the page',
      },
    ]);
    expect(h.create).toHaveBeenCalledWith({
      url: 'https://example.test/content',
      active: false,
    });
    expect(h.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 47 } }),
    );
    expect(h.remove).toHaveBeenCalledWith(47);
  });

  it('supports HTML, DOM text, and multiple sequential pages', async () => {
    const h = fixture();
    const html = await readTabsContent(h.api, [
      { urls: ['https://example.test/1'], contentType: 'html' },
    ]);
    expect(html[0]?.content).toBe('<html>full DOM</html>');
    const dom = await readTabsContent(h.api, [
      {
        urls: ['https://example.test/a', 'https://example.test/b'],
        contentType: 'domSnapshot',
      },
    ]);
    expect(dom.map((item) => item.content)).toEqual([
      'h1: Page heading',
      'h1: Page heading',
    ]);
    expect(h.create).toHaveBeenCalledTimes(3);
    expect(h.remove).toHaveBeenCalledTimes(3);
  });

  it('handles unnamed DOM and SVG elements without innerText', async () => {
    const h = fixture();
    vi.stubGlobal('document', {
      title: 'SVG content',
      querySelectorAll: () => [
        { tagName: 'A', getAttribute: () => null, textContent: '' },
        { tagName: 'SVG', getAttribute: () => null, textContent: 'vector' },
      ],
    });
    const result = await readTabsContent(h.api, [
      { urls: ['https://example.test/svg'], contentType: 'domSnapshot' },
    ]);
    expect(result[0]?.content).toBe('a: \nsvg: vector');
  });

  it('rejects invalid inputs before opening a browser tab', async () => {
    const h = fixture();
    const invalid = [
      [],
      [null],
      [{ urls: [], contentType: 'text' }],
      [{ urls: ['file:///secrets'], contentType: 'html' }],
      [{ urls: ['https://example.test'], contentType: 'binary' }],
      [{ urls: ['https://example.test'], contentType: 'text', timeoutMs: -2 }],
      [{ urls: Array(9).fill('https://example.test'), contentType: 'text' }],
    ];
    for (const args of invalid)
      await expect(readTabsContent(h.api, args)).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    expect(h.create).not.toHaveBeenCalled();
  });

  it('always closes temporary tabs when scripting fails', async () => {
    const h = fixture();
    h.api.scripting.executeScript = () =>
      Promise.reject(new Error('Frame with ID 0 is showing error page'));
    await expect(
      readTabsContent(h.api, [
        { urls: ['https://example.test'], contentType: 'text' },
      ]),
    ).rejects.toThrow('PAGE_NOT_ACCESSIBLE');
    expect(h.remove).toHaveBeenCalledOnce();
  });

  it('bounds content and titles so eight URLs fit the QuickJS result limit', async () => {
    const h = fixture();
    vi.stubGlobal('document', {
      title: 'T'.repeat(500),
      body: { innerText: 'X'.repeat(10_000) },
    });
    const urls = Array.from(
      { length: 8 },
      (_, index) => 'https://example.test/' + String(index),
    );
    const results = await readTabsContent(h.api, [
      { urls, contentType: 'text' },
    ]);
    expect(results).toHaveLength(8);
    expect(
      results.every(
        (item) => item.title?.length === 200 && item.content?.length === 4096,
      ),
    ).toBe(true);
    expect(JSON.stringify(results).length).toBeLessThan(65_536);
    expect(h.remove).toHaveBeenCalledTimes(8);
  });

  it('caps HTML and rejects page data that cannot be returned safely', async () => {
    const h = fixture();
    vi.stubGlobal('document', {
      title: 'Document',
      documentElement: { outerHTML: 'x'.repeat(10_000) },
    });
    const options = [{ urls: ['https://example.test'], contentType: 'html' }];
    const result = await readTabsContent(h.api, options);
    expect(result[0]?.content).toHaveLength(4096);
    h.api.scripting.executeScript = () =>
      Promise.resolve([
        {
          result: { url: 'x'.repeat(3000), title: 'Document', text: 'test' },
        },
      ]);
    await expect(readTabsContent(h.api, options)).rejects.toThrow(
      'PAGE_NOT_ACCESSIBLE',
    );
  });

  it('applies one shared deadline and cleans up timed-out pages', async () => {
    const h = fixture();
    const date = vi.spyOn(Date, 'now');
    date.mockReturnValueOnce(1000).mockReturnValueOnce(2000);
    await expect(
      readTabsContent(h.api, [
        { urls: ['https://example.test'], contentType: 'text', timeoutMs: 1 },
      ]),
    ).rejects.toThrow('TIMEOUT');
    expect(h.create).not.toHaveBeenCalled();
    date.mockRestore();
    h.api.tabs.get = () => Promise.resolve({ status: 'loading' });
    await expect(
      readTabsContent(h.api, [
        { urls: ['https://example.test'], contentType: 'text', timeoutMs: 1 },
      ]),
    ).rejects.toThrow('TIMEOUT');
    expect(h.remove).toHaveBeenCalledOnce();
  });

  it('enforces a UTF-8 byte budget even for eight pages of emoji', async () => {
    const h = fixture();
    vi.stubGlobal('document', {
      title: '多语言页面',
      body: { innerText: '😀'.repeat(9000) },
    });
    const urls = Array.from(
      { length: 8 },
      (_, index) => 'https://example.test/' + String(index),
    );
    const pages = await readTabsContent(h.api, [{ urls, contentType: 'text' }]);
    expect(pages).toHaveLength(8);
    expect(
      new TextEncoder().encode(JSON.stringify(pages)).length,
    ).toBeLessThanOrEqual(60_000);
    expect(pages.every((page) => (page.content?.length ?? 0) < 4096)).toBe(
      true,
    );
    expect(h.remove).toHaveBeenCalledTimes(8);
  });

  it('times out an unresponsive page script and still removes the tab', async () => {
    const h = fixture();
    h.api.scripting.executeScript = () => new Promise(() => {});
    await expect(
      readTabsContent(h.api, [
        { urls: ['https://example.test'], contentType: 'text', timeoutMs: 50 },
      ]),
    ).rejects.toThrow('TIMEOUT');
    expect(h.remove).toHaveBeenCalledOnce();
  });

  it('returns errors for missing API support, vanished tabs, or empty results', async () => {
    const h = fixture();
    const options = [{ urls: ['https://example.test'], contentType: 'text' }];
    delete h.api.tabs.create;
    await expect(readTabsContent(h.api, options)).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
    h.api.tabs.create = () => Promise.resolve({});
    await expect(readTabsContent(h.api, options)).rejects.toThrow(
      'TARGET_GONE',
    );
    h.api.tabs.create = () => Promise.resolve({ id: 47 });
    h.api.scripting.executeScript = () => Promise.resolve([]);
    await expect(readTabsContent(h.api, options)).rejects.toThrow(
      'PAGE_NOT_ACCESSIBLE',
    );
    expect(h.remove).toHaveBeenCalledOnce();
  });
});
