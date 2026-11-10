import { describe, expect, it } from 'vitest';
import {
  credentials,
  frameMessage,
  record,
  snapshot,
  socketUrl,
  validatePair,
} from '../utils/protocol';
describe('extension trust boundary', () => {
  it('accepts only literal loopback HTTP endpoints', () => {
    expect(socketUrl('http://127.0.0.1:43821')).toBe(
      'ws://127.0.0.1:43821/extension',
    );
    for (const endpoint of [
      'https://127.0.0.1',
      'http://localhost',
      'http://127.0.0.1@evil.test',
      'http://a:b@127.0.0.1',
      'http://127.0.0.1/x',
      'http://127.0.0.1?q=1',
      'http://127.0.0.1#x',
      'http://127.0.0.1:99999',
    ])
      expect(() => socketUrl(endpoint)).toThrow();
    expect(
      validatePair({ endpoint: 'http://127.0.0.1', name: ' Work ' }).name,
    ).toBe('Work');
    for (const name of ['', ' ', 'x'.repeat(81)])
      expect(() =>
        validatePair({ endpoint: 'http://127.0.0.1', name }),
      ).toThrow();
  });
  it('redacts URL query/fragment and excludes privileged/private/invalid tabs', () => {
    expect(
      snapshot([
        {
          id: 1,
          url: 'https://example.com/a?q=secret#private',
          title: 'x'.repeat(300),
        },
        { id: 2, url: 'http://example.com' },
      ]),
    ).toEqual([
      {
        id: 1,
        url: 'https://example.com/a',
        title: 'x'.repeat(256),
        active: false,
      },
      { id: 2, url: 'http://example.com/', title: '', active: false },
    ]);
    expect(
      snapshot([
        { id: 1, incognito: true, url: 'https://example.com' },
        { url: 'https://example.com' },
        { id: 2 },
        { id: 3, url: 'invalid' },
        { id: 4, url: 'chrome://settings' },
        { id: 5, url: 'https://u:p@example.com' },
        { id: 6, url: `https://example.com/${'a'.repeat(2048)}` },
      ]),
    ).toEqual([]);
    expect(
      snapshot(
        Array.from({ length: 550 }, (_, id) => ({
          id,
          url: 'https://example.com',
        })),
      ),
    ).toHaveLength(500);
  });
  it('rejects corrupt persisted credentials', () => {
    for (const value of [null, [], 1, {}, { endpoint: 'no' }]) {
      expect(credentials(value)).toBeUndefined();
    }
    const value = {
      endpoint: 'http://127.0.0.1',
      profileId: 'id',
      name: 'a',
      browserId: 'b',
      token: 'secret',
    };
    expect(credentials(value)).toEqual(value);
    expect(
      credentials({ ...value, endpoint: 'http://evil.test' }),
    ).toBeUndefined();
    expect(record([])).toBeUndefined();
  });
});

describe('action framing', () => {
  it('sends small messages directly and splits large ones into bounded chunks', () => {
    const direct = frameMessage(
      'request',
      { type: 'action', requestId: 'request' },
      8192,
    );
    expect(direct).toEqual([{ v: 1, type: 'action', requestId: 'request' }]);
    const payload = 'x'.repeat(9000);
    const frames = frameMessage(
      'request',
      { type: 'action', requestId: 'request', args: [payload] },
      8192,
    );
    expect(frames.length).toBeGreaterThan(1);
    for (const frame of frames) {
      expect(
        new TextEncoder().encode(JSON.stringify(frame)).length,
      ).toBeLessThanOrEqual(8192);
      expect(frame.type).toBe('chunk');
      expect(frame.requestId).toBe('request');
    }
    const joined = frames.map((frame) => frame.payload as string).join('');
    expect(JSON.parse(joined)).toEqual({
      v: 1,
      type: 'action',
      requestId: 'request',
      args: [payload],
    });
    frames.forEach((frame, index) => {
      expect(frame.index).toBe(index);
      expect(frame.total).toBe(frames.length);
    });
  });
  it('keeps chunked results inside the 1 MiB frame limit', () => {
    const frames = frameMessage(
      'request',
      {
        type: 'action_result',
        requestId: 'request',
        ok: true,
        value: 'x'.repeat(1_200_000),
      },
      1_048_576,
    );
    expect(frames.length).toBeGreaterThan(1);
    for (const frame of frames)
      expect(
        new TextEncoder().encode(JSON.stringify(frame)).length,
      ).toBeLessThanOrEqual(1_048_576);
    expect(frames.map((frame) => frame.payload as string).join('')).toContain(
      'x'.repeat(100),
    );
  });
});
