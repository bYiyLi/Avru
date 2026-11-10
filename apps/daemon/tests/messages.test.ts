import { describe, expect, it } from 'vitest';
import { parseMessage, record } from '../src/messages.js';
const parse = (value: unknown) => parseMessage(JSON.stringify(value));
it('accepts only a valid tab identity for a debugger cancellation', () => {
  expect(parse({ v: 1, type: 'control-interrupted', tabId: 7 })).toEqual({
    v: 1,
    type: 'control-interrupted',
    tabId: 7,
  });
  for (const tabId of [
    undefined,
    -1,
    1.5,
    '7',
    null,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    expect(() => parse({ v: 1, type: 'control-interrupted', tabId })).toThrow(
      'Invalid interrupted tab',
    );
});
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
      tabs: [
        { id: 2, title: 'Title', url: 'https://example.com/a', active: false },
      ],
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

it('validates metadata types and bounds without accepting arbitrary source labels', () => {
  const metadata = {
    browserName: 'Chrome',
    browserVersion: '140',
    extensionVersion: '0.0.1',
    versionSource: 'clientHints',
  };
  expect(
    parseMessage(JSON.stringify({ v: 1, type: 'metadata', metadata })),
  ).toEqual({ v: 1, type: 'metadata', metadata });
  for (const invalid of [
    null,
    { ...metadata, browserName: '' },
    { ...metadata, browserVersion: 'x'.repeat(65) },
    { ...metadata, extensionVersion: 5 },
    { ...metadata, versionSource: 'trusted' },
    { ...metadata, versionSource: ['clientHints'] },
  ]) {
    expect(() =>
      parseMessage(
        JSON.stringify({ v: 1, type: 'metadata', metadata: invalid }),
      ),
    ).toThrow('Invalid browser metadata');
  }
});

it('rejects malformed automatic connection tickets before session dispatch', () => {
  for (const ticket of [null, 3, '', 'a'.repeat(63), 'A'.repeat(64)])
    expect(() =>
      parseMessage(JSON.stringify({ v: 1, type: 'auto-redeem', ticket })),
    ).toThrow('Invalid ticket');
});

describe('browser action messages', () => {
  it('validates action requests', () => {
    const valid = {
      v: 1,
      type: 'action',
      requestId: 'request',
      tabId: 3,
      generation: 1,
      method: 'browser.tabs.list',
      args: [],
    };
    expect(parse(valid)).toEqual(valid);
    for (const invalid of [
      { ...valid, requestId: '' },
      { ...valid, tabId: -1 },
      { ...valid, tabId: 1.5 },
      { ...valid, generation: -1 },
      { ...valid, method: '' },
      { ...valid, method: 'x'.repeat(129) },
      { ...valid, args: {} },
      { ...valid, args: Array.from({ length: 1025 }, () => 0) },
    ])
      expect(() => parse(invalid)).toThrow('Invalid action');
  });
  it('validates action results with structured errors', () => {
    expect(
      parse({
        v: 1,
        type: 'action_result',
        requestId: 'r',
        ok: true,
        value: { a: 1 },
      }),
    ).toEqual({
      v: 1,
      type: 'action_result',
      requestId: 'r',
      ok: true,
      value: { a: 1 },
    });
    expect(
      parse({ v: 1, type: 'action_result', requestId: 'r', ok: true }),
    ).toEqual({ v: 1, type: 'action_result', requestId: 'r', ok: true });
    expect(
      parse({
        v: 1,
        type: 'action_result',
        requestId: 'r',
        ok: false,
        error: { code: 'TIMEOUT', message: 'slow' },
      }),
    ).toEqual({
      v: 1,
      type: 'action_result',
      requestId: 'r',
      ok: false,
      error: { code: 'TIMEOUT', message: 'slow' },
    });
    for (const invalid of [
      { v: 1, type: 'action_result', requestId: '', ok: true },
      { v: 1, type: 'action_result', requestId: 'r', ok: 'yes' },
      { v: 1, type: 'action_result', requestId: 'r', ok: false },
      {
        v: 1,
        type: 'action_result',
        requestId: 'r',
        ok: false,
        error: { code: 'TIMEOUT' },
      },
      {
        v: 1,
        type: 'action_result',
        requestId: 'r',
        ok: false,
        error: 'TIMEOUT',
      },
      {
        v: 1,
        type: 'action_result',
        requestId: 'r',
        ok: false,
        error: { code: 'x'.repeat(65), message: 'm' },
      },
    ])
      expect(() => parse(invalid)).toThrow('Invalid action result');
  });
  it('validates chunk frames', () => {
    const valid = {
      v: 1,
      type: 'chunk',
      requestId: 'r',
      index: 0,
      total: 2,
      payload: 'he',
    };
    expect(parse(valid)).toEqual(valid);
    for (const invalid of [
      { ...valid, index: 2 },
      { ...valid, index: -1 },
      { ...valid, total: 0 },
      { ...valid, total: 4097 },
      { ...valid, payload: 'x'.repeat(1_048_577) },
      { ...valid, requestId: '' },
    ])
      expect(() => parse(invalid)).toThrow('Invalid chunk');
  });
});
