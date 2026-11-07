import { describe, expect, it } from 'vitest';
import { parseMessage, record } from '../src/messages.js';
const parse = (value: unknown) => parseMessage(JSON.stringify(value));
describe('untrusted protocol messages', () => {
  it('validates envelopes and identity fields', () => {
    expect(record(null)).toBe(false);
    expect(record([])).toBe(false);
    expect(
      parse({ v: 1, type: 'pair', profileId: 'profile', name: 'Chrome' }).type,
    ).toBe('pair');
    expect(
      parse({
        v: 1,
        type: 'authenticate',
        browserId: 'id',
        token: 'a'.repeat(64),
      }).type,
    ).toBe('authenticate');
    expect(parse({ v: 1, type: 'ping' }).type).toBe('ping');
    for (const input of [
      null,
      { v: 2 },
      { v: 1, type: 'run' },
      { v: 1, type: 'pair' },
      { v: 1, type: 'pair', profileId: 'x', name: '' },
      { v: 1, type: 'authenticate' },
      { v: 1, type: 'authenticate', browserId: 'x', token: 'invalid' },
    ])
      expect(() => parse(input)).toThrow();
    expect(() => parseMessage('not json')).toThrow();
    expect(() => parseMessage('x'.repeat(8_388_609))).toThrow('too large');
  });
  it('minimizes URLs, accepts empty snapshots and rejects malformed tabs', () => {
    expect(
      parse({
        v: 1,
        type: 'tabs',
        tabs: [
          {
            id: 2,
            title: 'Title',
            url: 'https://user:password@example.com/a?q=secret#private',
          },
        ],
      }),
    ).toEqual({
      v: 1,
      type: 'tabs',
      tabs: [{ id: 2, title: 'Title', url: 'https://example.com/a' }],
    });
    expect(parse({ v: 1, type: 'tabs', tabs: [] })).toEqual({
      v: 1,
      type: 'tabs',
      tabs: [],
    });
    const valid = { id: 1, title: '', url: 'http://example.com' };
    const invalid = [
      null,
      {},
      { ...valid, id: -1 },
      { ...valid, id: 1.1 },
      { ...valid, title: null },
      { ...valid, title: 'x'.repeat(257) },
      { ...valid, url: 'file:///tmp/a' },
      { ...valid, url: 'invalid' },
      { ...valid, url: '' },
    ];
    for (const item of invalid)
      expect(() => parse({ v: 1, type: 'tabs', tabs: [item] })).toThrow();
    for (const items of [
      null,
      [valid, valid],
      Array.from({ length: 501 }, () => valid),
    ])
      expect(() => parse({ v: 1, type: 'tabs', tabs: items })).toThrow();
  });
});
