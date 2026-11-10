import { describe, expect, it, vi } from 'vitest';
import type { BrowserActionAPI } from '../utils/browser-ports';
import { dispatchClipboardAction } from '../utils/clipboard-actions';

const text = { mimeType: 'text/plain', text: 'Hello, Avru' };
const binary = { mimeType: 'image/png', base64: 'aGVsbG8=' };
const example = [{ entries: [text, binary], presentationStyle: 'inline' }];

function fixture() {
  const read = vi.fn(() => Promise.resolve(example));
  const readText = vi.fn(() => Promise.resolve('Hello, Avru'));
  const write = vi.fn(() => Promise.resolve());
  const writeText = vi.fn(() => Promise.resolve());
  const api: BrowserActionAPI = {
    tabs: { get: () => Promise.resolve({}) },
    scripting: { executeScript: () => Promise.resolve([]) },
    clipboard: { read, readText, write, writeText },
  };
  const run = (method: string, args: unknown[] = []) =>
    dispatchClipboardAction(api, method, args);
  return { api, run, read, readText, write, writeText };
}

describe('clipboard SDK with local browser permissions', () => {
  it('reads bounded plain text and preserves every clipboard entry', async () => {
    const h = fixture();
    expect(await h.run('tab.clipboard.readText')).toBe('Hello, Avru');
    expect(await h.run('tab.clipboard.read')).toEqual(example);
    expect(h.readText).toHaveBeenCalledOnce();
    expect(h.read).toHaveBeenCalledOnce();
  });

  it('writes plain text and multi-format clipboard items', async () => {
    const h = fixture();
    expect(await h.run('tab.clipboard.writeText', ['Some text'])).toEqual({
      ok: true,
      changed: true,
    });
    expect(h.writeText).toHaveBeenCalledWith('Some text');
    expect(await h.run('tab.clipboard.write', [example])).toEqual({
      ok: true,
      changed: true,
    });
    expect(h.write).toHaveBeenCalledWith(example);
  });

  it('enforces available clipboard browser API methods', async () => {
    const h = fixture();
    const port = h.api.clipboard;
    if (!port) throw new Error('Missing clipboard port');
    delete port.readText;
    await expect(h.run('tab.clipboard.readText')).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
    delete port.read;
    await expect(h.run('tab.clipboard.read')).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
    delete port.writeText;
    await expect(h.run('tab.clipboard.writeText', ['x'])).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
    delete port.write;
    await expect(h.run('tab.clipboard.write', [example])).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
    delete h.api.clipboard;
    await expect(h.run('tab.clipboard.read')).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
  });

  it('rejects extra and missing arguments before touching the clipboard', async () => {
    const h = fixture();
    for (const method of ['tab.clipboard.read', 'tab.clipboard.readText'])
      await expect(h.run(method, ['unexpected'])).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    for (const method of ['tab.clipboard.write', 'tab.clipboard.writeText']) {
      await expect(h.run(method)).rejects.toThrow('INVALID_ARGUMENT');
      await expect(h.run(method, ['x', 'y'])).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    }
    await expect(h.run('tab.clipboard.writeText', [null])).rejects.toThrow(
      'INVALID_ARGUMENT',
    );
    expect(h.read).not.toHaveBeenCalled();
    expect(h.readText).not.toHaveBeenCalled();
    expect(h.write).not.toHaveBeenCalled();
    expect(h.writeText).not.toHaveBeenCalled();
  });

  it('rejects oversized text by UTF-8 size on read and write', async () => {
    const h = fixture();
    h.readText.mockResolvedValueOnce('🥳'.repeat(16385));
    await expect(h.run('tab.clipboard.readText')).rejects.toThrow(
      'OUTPUT_TOO_LARGE',
    );
    await expect(
      h.run('tab.clipboard.writeText', ['🥳'.repeat(16385)]),
    ).rejects.toThrow('OUTPUT_TOO_LARGE');
    expect(h.writeText).not.toHaveBeenCalled();
  });

  it('rejects malformed clipboard item collections and presentation styles', async () => {
    const h = fixture();
    for (const bad of [
      null,
      [],
      Array.from({ length: 9 }, () => ({ entries: [text] })),
      [{ entries: [] }],
      [{ entries: Array.from({ length: 9 }, () => text) }],
      [null],
      ['text'],
      [{ entries: 'abc' }],
      [{ entries: [null] }],
      [{ entries: [[text]] }],
      [{ entries: [text], presentationStyle: 'random' }],
      [{ entries: [text], presentationStyle: 3 }],
    ])
      await expect(h.run('tab.clipboard.write', [bad])).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    expect(h.write).not.toHaveBeenCalled();
  });

  it('rejects invalid MIME types and entries without content', async () => {
    const h = fixture();
    for (const entry of [
      { mimeType: '' },
      { mimeType: 'text' },
      { mimeType: 'x/y', data: 'not-a-clipboard-property' },
      { mimeType: 'bad mime/type', text: 'a' },
      { mimeType: 'x/'.repeat(70), text: 'a' },
      { mimeType: 'text/plain', text: null },
      { mimeType: 'text/plain', base64: 3 },
      { mimeType: 'image/png', base64: '%%%INVALID%' },
      { mimeType: 'image/png', base64: 'abc' },
    ])
      await expect(
        h.run('tab.clipboard.write', [[{ entries: [entry] }]]),
      ).rejects.toThrow('INVALID_ARGUMENT');
  });

  it('tracks decoded binary and text content across entries', async () => {
    const h = fixture();
    const tooLong = [
      { entries: [{ mimeType: 'text/plain', text: 'é'.repeat(32769) }] },
    ];
    await expect(h.run('tab.clipboard.write', [tooLong])).rejects.toThrow(
      'OUTPUT_TOO_LARGE',
    );
    const hugeBinary = [
      {
        entries: [{ mimeType: 'image/png', base64: 'AAAA'.repeat(22000) }],
      },
    ];
    await expect(h.run('tab.clipboard.write', [hugeBinary])).rejects.toThrow(
      'OUTPUT_TOO_LARGE',
    );
  });

  it('supports the minimal valid item without an optional style', async () => {
    const h = fixture();
    const single = [{ entries: [text] }];
    await expect(h.run('tab.clipboard.write', [single])).resolves.toEqual({
      ok: true,
      changed: true,
    });
    expect(h.write).toHaveBeenCalledWith(single);
  });

  it('validates browser-sourced data before returning it to AI', async () => {
    const h = fixture();
    h.read.mockResolvedValueOnce([
      { entries: [{ mimeType: 'x/y', text: 7 }] },
    ] as unknown as typeof example);
    await expect(h.run('tab.clipboard.read')).rejects.toThrow(
      'INVALID_ARGUMENT',
    );
    h.read.mockResolvedValueOnce([
      { entries: [{ mimeType: 'text/plain', text: 'a'.repeat(66000) }] },
    ] as unknown as typeof example);
    await expect(h.run('tab.clipboard.read')).rejects.toThrow(
      'OUTPUT_TOO_LARGE',
    );
  });

  it('does not leak unexpected native clipboard errors', async () => {
    const h = fixture();
    h.readText.mockRejectedValueOnce(
      new Error('ClipboardPermissionDenied secret-text'),
    );
    await expect(h.run('tab.clipboard.readText')).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
    await expect(h.run('unknown')).rejects.toThrow('CAPABILITY_NOT_ALLOWED');
  });
});
