import { describe, expect, it, vi } from 'vitest';
import type { CdpController } from '../utils/cdp';
import { pageString, pdfBase64 } from '../utils/cdp-exports';

type CdpPort = Pick<CdpController, 'send'>;

function textCdp(value: string) {
  const send = vi.fn(
    (_tabId: number, method: string, params?: Record<string, unknown>) => {
      expect(method).toBe('Runtime.evaluate');
      const expression = params?.expression;
      if (typeof expression !== 'string') return Promise.resolve({});
      if (expression.startsWith('delete globalThis['))
        return Promise.resolve({ result: { value: true } });
      if (expression.startsWith('(async()=>{const value=await'))
        return Promise.resolve({ result: { value: { length: value.length } } });
      if (expression.startsWith('(()=>{const text=globalThis[')) {
        const start = /const start=(\d+);/u.exec(expression);
        const from = Number(start?.[1] ?? '0');
        let to = Math.min(value.length, from + 8192);
        if (to < value.length && to > from) {
          const code = value.charCodeAt(to - 1);
          if (code >= 55_296 && code <= 56_319) to--;
        }
        return Promise.resolve({
          result: { value: { text: value.slice(from, to), next: to } },
        });
      }
      return Promise.resolve({});
    },
  );
  return { send, cdp: { send } as unknown as CdpPort };
}

function pdfCdp(
  reads: { data: string; base64Encoded?: boolean; eof?: boolean }[],
) {
  const seen = { index: 0 };
  const send = vi.fn((_tabId: number, method: string) => {
    if (method === 'Page.printToPDF')
      return Promise.resolve({ stream: 'io-stream' });
    if (method === 'IO.read') return Promise.resolve(reads[seen.index++] ?? {});
    if (method === 'IO.close') return Promise.resolve({});
    return Promise.resolve({});
  });
  return { send, cdp: { send } as unknown as CdpPort };
}

describe('CDP remote page text chunk transfer', () => {
  it('returns empty and small UTF-8 page text and clears remote globals', async () => {
    for (const value of ['', 'Hello, Avru', '你好，浏览器']) {
      const h = textCdp(value);
      expect(await pageString(h.cdp, 7, 'document.title')).toBe(value);
      expect(h.send).toHaveBeenCalledWith(
        7,
        'Runtime.evaluate',
        expect.objectContaining({
          returnByValue: true,
          awaitPromise: true,
        }),
      );
      const calls = h.send.mock.calls.filter(([, , params]) =>
        String(params?.expression).startsWith('delete globalThis['),
      );
      expect(calls).toHaveLength(1);
    }
  });

  it('transfers large strings and never splits a UTF-16 surrogate pair', async () => {
    const text = 'a'.repeat(8191) + '😀' + 'z'.repeat(20000);
    const h = textCdp(text);
    expect(await pageString(h.cdp, 7, 'document.body.innerText')).toBe(text);
    const reads = h.send.mock.calls.filter(([, , params]) =>
      String(params?.expression).startsWith('(()=>{const text=globalThis['),
    );
    expect(reads.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects malformed prepare responses and page execution exceptions', async () => {
    const h = textCdp('abc');
    h.send.mockResolvedValueOnce({
      exceptionDetails: { text: 'page crashed' },
    });
    await expect(pageString(h.cdp, 7, 'brokenExpression')).rejects.toThrow(
      'PAGE_NOT_ACCESSIBLE',
    );
    h.send.mockResolvedValueOnce({ result: {} });
    await expect(pageString(h.cdp, 7, 'brokenExpression')).rejects.toThrow(
      'PAGE_NOT_ACCESSIBLE',
    );
    h.send.mockResolvedValueOnce({ result: { value: null } });
    await expect(pageString(h.cdp, 7, 'brokenExpression')).rejects.toThrow(
      'PAGE_NOT_ACCESSIBLE',
    );
    h.send.mockResolvedValueOnce({
      result: { value: { error: 'OUTPUT_TOO_LARGE' } },
    });
    await expect(pageString(h.cdp, 7, 'tooLarge')).rejects.toThrow(
      'OUTPUT_TOO_LARGE',
    );
    h.send.mockResolvedValueOnce({ result: { value: { length: 0.5 } } });
    await expect(pageString(h.cdp, 7, 'badLength')).rejects.toThrow(
      'PAGE_NOT_ACCESSIBLE',
    );
    h.send.mockResolvedValueOnce({ result: { value: { length: -1 } } });
    await expect(pageString(h.cdp, 7, 'badLength')).rejects.toThrow(
      'PAGE_NOT_ACCESSIBLE',
    );
  });

  it('rejects corrupt and nonadvancing chunks and still deletes the page temporary variable', async () => {
    const h = textCdp('abc');
    h.send.mockResolvedValueOnce({ result: { value: { length: 3 } } });
    h.send.mockResolvedValueOnce({ result: { value: { text: 'a', next: 0 } } });
    await expect(
      pageString(h.cdp, 7, 'document.body.innerText'),
    ).rejects.toThrow('PAGE_NOT_ACCESSIBLE');
    const cleanup = h.send.mock.calls.filter(([, , params]) =>
      String(params?.expression).startsWith('delete globalThis['),
    );
    expect(cleanup).toHaveLength(1);

    for (const chunk of [
      null,
      undefined,
      { text: 'a', next: 4 },
      { text: 7, next: 1 },
      { text: 'abc', next: '3' },
    ]) {
      const next = textCdp('abc');
      next.send.mockResolvedValueOnce({ result: { value: { length: 3 } } });
      next.send.mockResolvedValueOnce({ result: { value: chunk } });
      await expect(
        pageString(next.cdp, 7, 'document.body.innerText'),
      ).rejects.toThrow('PAGE_NOT_ACCESSIBLE');
    }
  });

  it('preserves remote cleanup failures only as best-effort', async () => {
    const h = textCdp('');
    h.send.mockResolvedValueOnce({ result: { value: { length: 0 } } });
    h.send.mockRejectedValueOnce(new Error('page navigated'));
    await expect(pageString(h.cdp, 7, 'document.title')).resolves.toBe('');
  });
});

describe('CDP PDF export with native stream cleanup', () => {
  it('returns a small PDF from Chrome inline data when supported', async () => {
    const h = pdfCdp([]);
    h.send.mockResolvedValueOnce({ data: 'JVBERi0xLjQK' });
    expect(await pdfBase64(h.cdp, 9)).toBe('JVBERi0xLjQK');
    expect(h.send).toHaveBeenCalledWith(9, 'Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: true,
      transferMode: 'ReturnAsStream',
    });
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('reads binary PDF stream chunks and closes the handle', async () => {
    const h = pdfCdp([
      { data: 'JVBERi0=', base64Encoded: true, eof: false },
      { data: 'MS40Cg==', base64Encoded: true, eof: true },
    ]);
    expect(await pdfBase64(h.cdp, 9)).toBe('JVBERi0xLjQK');
    expect(h.send).toHaveBeenCalledWith(9, 'IO.read', {
      handle: 'io-stream',
      size: 8192,
    });
    expect(h.send).toHaveBeenCalledWith(9, 'IO.close', { handle: 'io-stream' });
  });

  it('rejects a missing PDF body or invalid stream handle', async () => {
    for (const response of [{}, { stream: '' }, { stream: 3 }]) {
      const h = pdfCdp([]);
      h.send.mockResolvedValueOnce(response);
      await expect(pdfBase64(h.cdp, 9)).rejects.toThrow('PAGE_NOT_ACCESSIBLE');
    }
  });

  it('rejects corrupt stream data but still closes the native stream', async () => {
    for (const read of [
      { data: '%%%%%', base64Encoded: true, eof: true },
      { data: 'aGVsbG8=', base64Encoded: false, eof: true },
      { data: '', base64Encoded: true, eof: false },
    ]) {
      const h = pdfCdp([read]);
      await expect(pdfBase64(h.cdp, 9)).rejects.toThrow('PAGE_NOT_ACCESSIBLE');
      expect(h.send).toHaveBeenCalledWith(9, 'IO.close', {
        handle: 'io-stream',
      });
    }
  });

  it('enforces PDF byte limits even when CDP returns a stream', async () => {
    const h = pdfCdp(
      Array.from({ length: 1025 }, () => ({
        data: 'AAAA',
        base64Encoded: true,
        eof: false,
      })),
    );
    await expect(pdfBase64(h.cdp, 9)).rejects.toThrow('OUTPUT_TOO_LARGE');
    expect(h.send).toHaveBeenCalledWith(9, 'IO.close', { handle: 'io-stream' });
  });

  it('rejects oversized inline Chrome PDF data without exposing bytes', async () => {
    const h = pdfCdp([]);
    h.send.mockResolvedValueOnce({ data: 'A'.repeat(12_000_000) });
    await expect(pdfBase64(h.cdp, 9)).rejects.toThrow('OUTPUT_TOO_LARGE');
  });

  it('does not hide the original PDF read failure if cleanup also fails', async () => {
    const h = pdfCdp([]);
    h.send.mockResolvedValueOnce({ stream: 'io-stream' });
    h.send.mockRejectedValueOnce(new Error('CDP stream lost'));
    h.send.mockRejectedValueOnce(new Error('close failed'));
    await expect(pdfBase64(h.cdp, 9)).rejects.toThrow('CDP stream lost');
  });
});
