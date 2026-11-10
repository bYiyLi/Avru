import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserActionAPI } from '../utils/browser-ports';
import type { CdpController } from '../utils/cdp';
import { dispatchExportCapability } from '../utils/page-exports';

const mocks = vi.hoisted(() => ({
  pageString: vi.fn(() => Promise.resolve('Avru text')),
  pdfBase64: vi.fn(() => Promise.resolve('JVBERi0xLjQK')),
}));
vi.mock('../utils/cdp-exports', () => mocks);

type Download = Awaited<
  ReturnType<NonNullable<BrowserActionAPI['downloads']>['search']>
>[number];

function fixture(url = 'https://example.test/page', title = 'Example page') {
  const get = vi.fn(() => Promise.resolve({ title, url }));
  const download = vi.fn(() => Promise.resolve(3));
  let downloadItems: Download[] = [
    {
      id: 3,
      url: 'https://example.test/download',
      filename: '/Users/demo/Downloads/export.pdf',
      state: 'complete',
    },
  ];
  const search = vi.fn(() => Promise.resolve(downloadItems));
  const api: BrowserActionAPI = {
    tabs: { get },
    scripting: { executeScript: () => Promise.resolve([]) },
    downloads: { download, search },
  };
  const cdp = { send: vi.fn() } as unknown as Pick<CdpController, 'send'>;
  const call = (method: string, args: unknown[] = []) =>
    dispatchExportCapability({ api, cdp, tabId: 8 }, method, args);
  const setDownloads = (values: Download[]) => {
    downloadItems = values;
  };
  return { api, cdp, call, get, download, search, setDownloads };
}

afterEach(() => {
  mocks.pageString.mockReset();
  mocks.pdfBase64.mockReset();
  mocks.pageString.mockResolvedValue('Avru text');
  mocks.pdfBase64.mockResolvedValue('JVBERi0xLjQK');
  vi.useRealTimers();
});

describe('native page export formats', () => {
  it('exports a PDF with the Chrome printToPDF result', async () => {
    const h = fixture();
    expect(await h.call('tab.exportFile', [{ format: 'pdf' }])).toEqual({
      path: '/Users/demo/Downloads/export.pdf',
    });
    expect(mocks.pdfBase64).toHaveBeenCalledWith(h.cdp, 8);
    expect(h.download).toHaveBeenCalledWith({
      url: 'data:application/pdf;base64,JVBERi0xLjQK',
      filename: 'Example page.pdf',
      saveAs: false,
      conflictAction: 'uniquify',
    });
  });

  it('exports HTML as UTF-8 and sanitizes the browser title', async () => {
    const h = fixture('https://example.test/page', ' Report / 2026: Preview ');
    mocks.pageString.mockResolvedValue('<h1>你好 Avru</h1>');
    expect(await h.call('tab.exportFile', [{ format: 'html' }])).toEqual({
      path: '/Users/demo/Downloads/export.pdf',
    });
    expect(mocks.pageString).toHaveBeenCalledWith(
      h.cdp,
      8,
      'document.documentElement ? document.documentElement.outerHTML : ""',
    );
    const options = (
      h.download.mock.calls as unknown as [{ url: string; filename: string }][]
    )[0]?.[0];
    expect(options?.url).toBe(
      'data:text/html;base64,' +
        Buffer.from('<h1>你好 Avru</h1>', 'utf8').toString('base64'),
    );
    expect(options?.filename).toBe('Report _ 2026_ Preview.html');
  });

  it('exports readable Markdown using the built-in article summarizer', async () => {
    const h = fixture();
    expect(await h.call('tab.exportFile', [{ format: 'markdown' }])).toEqual({
      path: '/Users/demo/Downloads/export.pdf',
    });
    const expression =
      (
        mocks.pageString.mock.calls as unknown as [unknown, number, string][]
      )[0]?.[2] ?? '';
    expect(expression).toContain('document.querySelector');
    expect(expression).toContain('document.title');
    const options = (
      h.download.mock.calls as unknown as [{ url: string; filename: string }][]
    )[0]?.[0];
    expect(options?.url).toBe('data:text/markdown;base64,QXZydSB0ZXh0');
    expect(options?.filename).toBe('Example page.md');
  });

  it('maps content.export to Markdown without requiring a format argument', async () => {
    const h = fixture();
    expect(await h.call('tab.content.export')).toHaveProperty('path');
    expect(h.download).toHaveBeenCalledOnce();
    const options = (
      h.download.mock.calls as unknown as [{ filename: string }][]
    )[0]?.[0];
    expect(options?.filename).toBe('Example page.md');
  });

  it('does not append a duplicate extension and supplies a safe fallback filename', async () => {
    const h = fixture('https://example.test', 'REPORT.PDF');
    await h.call('tab.exportFile', [{ format: 'pdf' }]);
    const options = (
      h.download.mock.calls as unknown as [{ filename: string }][]
    )[0]?.[0];
    expect(options?.filename).toBe('REPORT.PDF');
    const missing = fixture('https://example.test', '');
    await missing.call('tab.exportFile', [{ format: 'pdf' }]);
    const fallback = (
      missing.download.mock.calls as unknown as [{ filename: string }][]
    )[0]?.[0];
    expect(fallback?.filename).toBe('avru-export.pdf');
  });

  it('rejects unsupported page formats, missing permissions, and unknown methods', async () => {
    const h = fixture();
    for (const args of [
      [],
      [{}],
      [{ format: 'txt' }],
      [{ format: null }],
      ['html'],
      [{ format: 'html' }, {}],
    ])
      await expect(h.call('tab.exportFile', args)).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    await expect(
      h.call('tab.content.exportYouTubeTranscript', ['extra']),
    ).rejects.toThrow('INVALID_ARGUMENT');
    await expect(h.call('unknown')).rejects.toThrow('CAPABILITY_NOT_ALLOWED');
    delete h.api.downloads;
    await expect(h.call('tab.exportFile', [{ format: 'pdf' }])).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
  });

  it('preserves native download interruption and does not falsely report a saved path', async () => {
    const h = fixture();
    h.setDownloads([
      {
        id: 3,
        url: 'https://example.test/file',
        filename: '',
        state: 'interrupted',
        error: 'FILE_FAILED',
      },
    ]);
    await expect(h.call('tab.exportFile', [{ format: 'pdf' }])).rejects.toThrow(
      'FILE_FAILED',
    );
    h.setDownloads([
      {
        id: 3,
        url: 'https://example.test/file',
        filename: '',
        state: 'interrupted',
      },
    ]);
    await expect(h.call('tab.exportFile', [{ format: 'pdf' }])).rejects.toThrow(
      'PAGE_NOT_ACCESSIBLE',
    );
  });

  it('caps the inline PDF data size before starting any browser download', async () => {
    const h = fixture();
    mocks.pdfBase64.mockResolvedValue('A'.repeat(12_000_000));
    await expect(h.call('tab.exportFile', [{ format: 'pdf' }])).rejects.toThrow(
      'OUTPUT_TOO_LARGE',
    );
    expect(h.download).not.toHaveBeenCalled();
  });

  it('reports a download timeout without duplicating the request', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const h = fixture();
    h.setDownloads([]);
    const pending = h.call('tab.exportFile', [{ format: 'pdf' }]);
    const rejection = expect(pending).rejects.toThrow('TIMEOUT');
    await vi.advanceTimersByTimeAsync(120_500);
    await rejection;
    expect(h.download).toHaveBeenCalledOnce();
  });
});

describe('Google Workspace document export', () => {
  it('downloads allowed native formats for each Workspace product', async () => {
    for (const [kind, extension] of [
      ['document', 'docx'],
      ['spreadsheets', 'xlsx'],
      ['spreadsheets', 'csv'],
      ['presentation', 'pptx'],
    ] as const) {
      const h = fixture(`https://docs.google.com/${kind}/d/abc-123/edit`);
      expect(
        await h.call('tab.content.exportGsuite', [extension]),
      ).toHaveProperty('path');
      const options = (
        h.download.mock.calls as unknown as [
          { url: string; filename: string },
        ][]
      )[0]?.[0];
      expect(options?.url).toBe(
        `https://docs.google.com/${kind}/d/abc-123/export?format=${extension}`,
      );
      expect(options?.filename).toBe(`Example page.${extension}`);
    }
  });

  it('supports PDF as an export format for documents, sheets and presentations', async () => {
    for (const kind of ['document', 'spreadsheets', 'presentation']) {
      const h = fixture(`https://docs.google.com/${kind}/d/file-id/edit`);
      expect(await h.call('tab.content.exportGsuite', ['pdf'])).toHaveProperty(
        'path',
      );
      expect(h.download).toHaveBeenCalledOnce();
    }
  });

  it('converts Google Docs plain text to correctly labeled Markdown', async () => {
    const h = fixture('https://docs.google.com/document/d/abc123/edit');
    mocks.pageString.mockResolvedValue('你好');
    expect(await h.call('tab.content.exportGsuite', ['md'])).toHaveProperty(
      'path',
    );
    const expression =
      (
        mocks.pageString.mock.calls as unknown as [unknown, number, string][]
      )[0]?.[2] ?? '';
    expect(expression).toContain('/export?format=txt');
    expect(expression).toContain("credentials:'include'");
    expect(h.download).toHaveBeenCalledWith({
      url: 'data:text/markdown;base64,5L2g5aW9',
      filename: 'Example page.md',
      saveAs: false,
      conflictAction: 'uniquify',
    });
  });

  it('rejects unsupported formats without sending a browser download', async () => {
    const h = fixture('https://docs.google.com/spreadsheets/d/abc123/edit');
    for (const args of [[], [null], ['txt'], ['csv', {}], ['jpeg']])
      await expect(h.call('tab.content.exportGsuite', args)).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    await expect(h.call('tab.content.exportGsuite', ['md'])).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
    await expect(h.call('tab.content.exportGsuite', ['docx'])).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
    const nonGoogle = fixture('https://example.test/not-google');
    await expect(
      nonGoogle.call('tab.content.exportGsuite', ['pdf']),
    ).rejects.toThrow('PAGE_NOT_ACCESSIBLE');
    expect(h.download).not.toHaveBeenCalled();
  });

  it('requires native download support for Workspace files', async () => {
    const h = fixture('https://docs.google.com/document/d/abc123/edit');
    delete h.api.downloads;
    await expect(h.call('tab.content.exportGsuite', ['docx'])).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
  });

  it('handles a native interrupted Workspace export and preserves failure', async () => {
    const h = fixture('https://docs.google.com/document/d/abc123/edit');
    h.setDownloads([
      {
        id: 3,
        url: 'https://docs.google.com/document/d/abc123/export?format=pdf',
        filename: '',
        state: 'interrupted',
        error: 'SERVER_FAILED',
      },
    ]);
    await expect(h.call('tab.content.exportGsuite', ['pdf'])).rejects.toThrow(
      'SERVER_FAILED',
    );
  });

  it('does not retry a Workspace export after the download times out', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const h = fixture('https://docs.google.com/document/d/abc123/edit');
    h.setDownloads([]);
    const pending = h.call('tab.content.exportGsuite', ['docx']);
    const rejection = expect(pending).rejects.toThrow('TIMEOUT');
    await vi.advanceTimersByTimeAsync(120_500);
    await rejection;
    expect(h.download).toHaveBeenCalledOnce();
  });
});

describe('YouTube caption transcript export', () => {
  it('returns a saved transcript text file for a valid YouTube watch page', async () => {
    const h = fixture('https://www.youtube.com/watch?v=abc123', 'Video: Live');
    mocks.pageString.mockResolvedValue('00:00 Welcome\n00:05 Today');
    expect(await h.call('tab.content.exportYouTubeTranscript')).toHaveProperty(
      'path',
    );
    const expression =
      (
        mocks.pageString.mock.calls as unknown as [unknown, number, string][]
      )[0]?.[2] ?? '';
    expect(expression).toContain('ytInitialPlayerResponse');
    expect(expression).toContain('captions');
    const options = (
      h.download.mock.calls as unknown as [{ url: string; filename: string }][]
    )[0]?.[0];
    expect(options?.url).toMatch(/^data:text\/plain;base64,/u);
    expect(options?.filename).toBe('Video_ Live.txt');
  });

  it('rejects missing subtitles without pretending success', async () => {
    const h = fixture('https://youtube.com/watch?v=abc123');
    mocks.pageString.mockResolvedValue('');
    await expect(h.call('tab.content.exportYouTubeTranscript')).rejects.toThrow(
      'PAGE_NOT_ACCESSIBLE',
    );
    expect(h.download).not.toHaveBeenCalled();
  });

  it('rejects non-YouTube and non-watch targets', async () => {
    for (const url of [
      'http://youtube.com/watch?v=id',
      'https://youtube.com/watch',
      'https://youtube.com/shorts/id',
      'https://evil.youtube.com/watch?v=id',
      'https://example.test/watch?v=id',
      'https://youtube.com.evil.test/watch?v=id',
    ]) {
      const h = fixture(url);
      await expect(
        h.call('tab.content.exportYouTubeTranscript'),
      ).rejects.toThrow('PAGE_NOT_ACCESSIBLE');
      expect(h.download).not.toHaveBeenCalled();
    }
  });
});

describe('missing native tab metadata must not create unsafe filenames', () => {
  it('uses a generic export name when Chrome has no page title', async () => {
    const h = fixture();
    h.get.mockResolvedValueOnce({ url: 'https://example.test/' } as never);
    await expect(
      h.call('tab.exportFile', [{ format: 'pdf' }]),
    ).resolves.toHaveProperty('path');
    const first = (
      h.download.mock.calls as unknown as [{ filename: string }][]
    )[0]?.[0];
    expect(first?.filename).toBe('avru-export.pdf');
  });

  it('preserves file type when Google and YouTube titles are missing', async () => {
    const docs = fixture('https://docs.google.com/document/d/example/edit');
    docs.get.mockResolvedValueOnce({
      url: 'https://docs.google.com/document/d/example/edit',
    } as never);
    await docs.call('tab.content.exportGsuite', ['docx']);
    const native = (
      docs.download.mock.calls as unknown as [{ filename: string }][]
    )[0]?.[0];
    expect(native?.filename).toBe('google-export.docx');

    const captions = fixture('https://youtube.com/watch?v=test');
    captions.get.mockResolvedValueOnce({
      url: 'https://youtube.com/watch?v=test',
    } as never);
    await captions.call('tab.content.exportYouTubeTranscript');
    const captionFile = (
      captions.download.mock.calls as unknown as [{ filename: string }][]
    )[0]?.[0];
    expect(captionFile?.filename).toBe('youtube-transcript.txt');
  });

  it('treats a tab whose URL has disappeared as inaccessible', async () => {
    const h = fixture();
    h.get.mockResolvedValueOnce({ title: 'Offline page' } as never);
    await expect(h.call('tab.content.exportYouTubeTranscript')).rejects.toThrow(
      'PAGE_NOT_ACCESSIBLE',
    );
    expect(h.download).not.toHaveBeenCalled();
  });
});
