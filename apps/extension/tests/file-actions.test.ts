import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserActionAPI } from '../utils/browser-ports';
import type { CdpController } from '../utils/cdp';
import { setInputFiles } from '../utils/file-actions';

type Download = Awaited<
  ReturnType<NonNullable<BrowserActionAPI['downloads']>['search']>
>[number];

function fixture() {
  const send = vi.fn((_tabId: number, method: string) => {
    const responses: Record<string, unknown> = {
      'Runtime.evaluate': { result: { objectId: 'remote-node' } },
      'DOM.requestNode': { nodeId: 6 },
      'DOM.describeNode': {
        node: {
          backendNodeId: 15,
          nodeName: 'INPUT',
          attributes: ['type', 'file'],
        },
      },
    };
    return Promise.resolve(responses[method] ?? {});
  });
  const search = vi.fn(() =>
    Promise.resolve<Download[]>([
      {
        id: 19,
        url: 'data:text/plain;base64,SGVsbG8=',
        filename: '/Users/demo/Downloads/avru-upload-temp.txt',
        state: 'complete',
      },
    ]),
  );
  const download = vi.fn(() => Promise.resolve(19));
  const removeFile = vi.fn(() => Promise.resolve());
  const api: BrowserActionAPI = {
    tabs: { get: () => Promise.resolve({}) },
    scripting: { executeScript: () => Promise.resolve([]) },
    downloads: { search, download, removeFile },
  };
  const cdp = { send } as unknown as Pick<CdpController, 'send'>;
  const run = (args: unknown[]) => setInputFiles(api, cdp, 7, args);
  return { api, send, search, download, removeFile, run };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('CDP file input with actual filesystem paths', () => {
  it('sets files on a resolved CDP backend node with no download side effects', async () => {
    const h = fixture();
    expect(
      await h.run([{ backendNodeId: 21 }, ['/Users/demo/report.csv']]),
    ).toEqual({
      ok: true,
      changed: true,
      fileCount: 1,
    });
    expect(h.send).toHaveBeenCalledWith(7, 'DOM.setFileInputFiles', {
      files: ['/Users/demo/report.csv'],
      backendNodeId: 21,
    });
    expect(h.download).not.toHaveBeenCalled();
  });

  it('accepts Windows file paths and multiple files', async () => {
    const h = fixture();
    expect(
      await h.run([
        { backendNodeId: 22 },
        ['C:\\Users\\demo\\report.csv', 'C:/Users/demo/photo.png'],
        { timeoutMs: 100 },
      ]),
    ).toMatchObject({ fileCount: 2 });
    expect(h.send).toHaveBeenCalledWith(7, 'DOM.setFileInputFiles', {
      files: ['C:\\Users\\demo\\report.csv', 'C:/Users/demo/photo.png'],
      backendNodeId: 22,
    });
  });

  it('resolves a fresh page element reference to its backend input file node', async () => {
    const h = fixture();
    expect(
      await h.run(['e:task:4:node', ['/Users/demo/file.txt']]),
    ).toMatchObject({ fileCount: 1 });
    expect(h.send).toHaveBeenNthCalledWith(1, 7, 'DOM.enable', {});
    expect(h.send).toHaveBeenNthCalledWith(
      2,
      7,
      'Runtime.evaluate',
      expect.any(Object),
    );
    const expression = (
      h.send.mock.calls as unknown as [number, string, { expression: string }][]
    )[1]?.[2].expression;
    expect(expression).toContain('e:task:4:node');
    expect(h.send).toHaveBeenCalledWith(7, 'DOM.requestNode', {
      objectId: 'remote-node',
    });
    expect(h.send).toHaveBeenCalledWith(7, 'DOM.describeNode', { nodeId: 6 });
    expect(h.send).toHaveBeenCalledWith(7, 'Runtime.releaseObject', {
      objectId: 'remote-node',
    });
  });

  it('cleans up the remote object when the target is no longer a file input', async () => {
    const h = fixture();
    h.send.mockImplementation((_tabId: number, method: string) =>
      Promise.resolve(
        method === 'Runtime.evaluate'
          ? { result: { objectId: 'gone' } }
          : method === 'DOM.requestNode'
            ? { nodeId: 4 }
            : method === 'DOM.describeNode'
              ? {
                  node: {
                    backendNodeId: 6,
                    nodeName: 'INPUT',
                    attributes: ['type', 'text'],
                  },
                }
              : {},
      ),
    );
    await expect(
      h.run(['e:task:4:node', ['/Users/demo/file.txt']]),
    ).rejects.toThrow('ELEMENT_NOT_INTERACTABLE');
    expect(h.send).toHaveBeenCalledWith(7, 'Runtime.releaseObject', {
      objectId: 'gone',
    });
  });

  it('continues a valid upload when releasing the temporary CDP object fails', async () => {
    const h = fixture();
    h.send.mockImplementation((_id: number, method: string) => {
      if (method === 'Runtime.releaseObject')
        return Promise.reject(new Error('object expired'));
      const responses: Record<string, unknown> = {
        'Runtime.evaluate': { result: { objectId: 'remote-node' } },
        'DOM.requestNode': { nodeId: 6 },
        'DOM.describeNode': {
          node: {
            backendNodeId: 15,
            nodeName: 'INPUT',
            attributes: ['type', 'file'],
          },
        },
      };
      return Promise.resolve(responses[method] ?? {});
    });
    await expect(
      h.run(['e:task:4:node', ['/Users/demo/file.txt']]),
    ).resolves.toMatchObject({
      ok: true,
      fileCount: 1,
    });
    expect(h.send).toHaveBeenCalledWith(7, 'Runtime.releaseObject', {
      objectId: 'remote-node',
    });
  });

  it('refuses stale page refs and invalid target nodes', async () => {
    const h = fixture();
    for (const ref of [
      null,
      'invalid',
      { backendNodeId: -1 },
      { backendNodeId: 0 },
    ]) {
      await expect(h.run([ref, ['/Users/demo/file.txt']])).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    }
    h.send.mockResolvedValueOnce({}).mockResolvedValueOnce({ result: {} });
    await expect(
      h.run(['e:task:4:node', ['/Users/demo/file.txt']]),
    ).rejects.toThrow('STALE_REF');
    h.send.mockImplementation((_tabId: number, method: string) =>
      Promise.resolve(
        method === 'Runtime.evaluate'
          ? { result: { objectId: 'a' } }
          : method === 'DOM.requestNode'
            ? {}
            : {},
      ),
    );
    await expect(
      h.run(['e:task:4:node', ['/Users/demo/file.txt']]),
    ).rejects.toThrow('STALE_REF');
  });

  it('rejects malformed relative and empty paths before calling CDP', async () => {
    const h = fixture();
    for (const paths of [
      ['relative/file.txt'],
      [''],
      ['\0bad'],
      ['../escape'],
      ['s'.repeat(4097)],
      [],
      Array.from({ length: 9 }, () => '/Users/demo/x'),
    ]) {
      await expect(h.run([{ backendNodeId: 15 }, paths])).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    }
    expect(h.send).not.toHaveBeenCalled();
  });

  it('validates argument count, options and bounded timeouts', async () => {
    const h = fixture();
    for (const args of [
      [],
      [{ backendNodeId: 10 }],
      [15, ['/a'], {}, 'extra'],
      [{ backendNodeId: 10 }, ['/a'], null],
      [{ backendNodeId: 10 }, ['/a'], []],
      [{ backendNodeId: 10 }, ['/a'], { timeoutMs: 0 }],
      [{ backendNodeId: 10 }, ['/a'], { timeoutMs: '100' }],
      [{ backendNodeId: 10 }, ['/a'], { timeoutMs: 120001 }],
      [{ backendNodeId: 10 }, ['/a'], { timeoutMs: 1.5 }],
    ])
      await expect(h.run(args)).rejects.toThrow('INVALID_ARGUMENT');
    expect(h.send).not.toHaveBeenCalled();
  });
});

describe('base64 upload via temporary browser downloads', () => {
  const file = {
    name: 'document.txt',
    data: 'SGVsbG8=',
    mimeType: 'text/plain',
  };

  it('downloads a temporary file, points CDP at it, and removes it', async () => {
    const h = fixture();
    expect(await h.run([{ backendNodeId: 4 }, [file]])).toEqual({
      ok: true,
      changed: true,
      fileCount: 1,
    });
    const generatedFilename = (
      h.download.mock.calls as unknown as [{ filename: string }][]
    )[0]?.[0].filename;
    expect(generatedFilename).toMatch(/^avru-upload-[\da-f-]+-document\.txt$/u);
    expect(h.download).toHaveBeenCalledWith({
      url: 'data:text/plain;base64,SGVsbG8=',
      filename: generatedFilename,
      saveAs: false,
      conflictAction: 'uniquify',
    });
    expect(h.search).toHaveBeenCalledWith({ id: 19 });
    expect(h.send).toHaveBeenCalledWith(7, 'DOM.setFileInputFiles', {
      files: ['/Users/demo/Downloads/avru-upload-temp.txt'],
      backendNodeId: 4,
    });
    expect(h.removeFile).toHaveBeenCalledWith(19);
  });

  it('supports a default MIME type and several files', async () => {
    const h = fixture();
    expect(
      await h.run([
        { backendNodeId: 4 },
        [
          { name: 'x.bin', data: 'AAAA' },
          { name: 'emoji.txt', data: '8J+Yig==' },
        ],
      ]),
    ).toMatchObject({ fileCount: 2 });
    expect(h.download).toHaveBeenCalledTimes(2);
    expect(h.download).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'data:application/octet-stream;base64,AAAA',
      }),
    );
    expect(h.removeFile).toHaveBeenCalledTimes(2);
  });

  it('removes temporary files even when CDP rejects the write', async () => {
    const h = fixture();
    h.send.mockRejectedValueOnce(new Error('upload failed'));
    await expect(h.run([{ backendNodeId: 4 }, [file]])).rejects.toThrow(
      'upload failed',
    );
    expect(h.removeFile).toHaveBeenCalledOnce();
  });

  it('removes the successful first download if a later download fails', async () => {
    const h = fixture();
    h.download
      .mockResolvedValueOnce(19)
      .mockRejectedValueOnce(new Error('download failed'));
    await expect(h.run([{ backendNodeId: 4 }, [file, file]])).rejects.toThrow(
      'download failed',
    );
    expect(h.removeFile).toHaveBeenCalledWith(19);
    expect(h.removeFile).toHaveBeenCalledOnce();
  });

  it('requires both native download and cleanup permissions', async () => {
    const h = fixture();
    delete h.api.downloads?.removeFile;
    await expect(h.run([{ backendNodeId: 4 }, [file]])).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
    delete h.api.downloads;
    await expect(h.run([{ backendNodeId: 4 }, [file]])).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
  });

  it('does not accept malformed base64, dangerous file names, or oversized uploads', async () => {
    const h = fixture();
    for (const candidate of [
      { ...file, data: '*not-base64*' },
      { ...file, data: 'aGVsbG8' },
      { ...file, data: 'AAAA'.repeat(22000) },
      { ...file, name: '' },
      { ...file, name: '..' },
      { ...file, name: '../bad' },
      { ...file, name: 'bad\\name' },
      { ...file, name: 'a'.repeat(256) },
      { ...file, mimeType: 9 },
      { ...file, mimeType: 'a'.repeat(129) },
    ]) {
      const failure =
        candidate.data.length > 85_000
          ? 'OUTPUT_TOO_LARGE'
          : 'INVALID_ARGUMENT';
      await expect(h.run([{ backendNodeId: 4 }, [candidate]])).rejects.toThrow(
        failure,
      );
    }
    expect(h.download).not.toHaveBeenCalled();
  });

  it('rejects the wrong array shape and unbounded file sets', async () => {
    const h = fixture();
    for (const values of [
      null,
      2,
      {},
      [],
      [null],
      ['relative/file'],
      Array.from({ length: 9 }, () => file),
    ]) {
      await expect(h.run([{ backendNodeId: 4 }, values])).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    }
    expect(h.download).not.toHaveBeenCalled();
  });

  it('reports interrupted downloads and does not claim the file was uploaded', async () => {
    const h = fixture();
    h.search.mockResolvedValueOnce([
      {
        id: 19,
        url: 'data:text/plain',
        filename: '',
        state: 'interrupted',
        error: 'FILE_FAILED',
      },
    ]);
    await expect(h.run([{ backendNodeId: 4 }, [file]])).rejects.toThrow(
      'FILE_FAILED',
    );
    expect(h.send).not.toHaveBeenCalled();
    expect(h.removeFile).not.toHaveBeenCalled();
  });

  it('times out a temporary file download instead of submitting an unknown path', async () => {
    vi.useFakeTimers();
    const h = fixture();
    h.search.mockResolvedValue([]);
    const pending = h.run([{ backendNodeId: 4 }, [file], { timeoutMs: 1 }]);
    const rejected = expect(pending).rejects.toThrow('TIMEOUT');
    await vi.advanceTimersByTimeAsync(105);
    await rejected;
    expect(h.send).not.toHaveBeenCalled();
  });

  it('preserves the successful upload if temporary-file cleanup fails', async () => {
    const h = fixture();
    h.removeFile.mockRejectedValueOnce(
      new Error('Chrome already removed file'),
    );
    await expect(h.run([{ backendNodeId: 4 }, [file]])).resolves.toMatchObject({
      ok: true,
      fileCount: 1,
    });
    expect(h.removeFile).toHaveBeenCalledWith(19);
  });
});
