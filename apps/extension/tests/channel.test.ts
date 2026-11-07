import { extensionId } from '../../../packages/protocol/environment.js';
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import {
  defaultEndpoint,
  extensionChannel,
  parseChannel,
} from '../utils/channel';
import { credentials, socketUrl } from '../utils/protocol';
import keys from '../manifest-keys.json';

afterEach(() => {
  vi.unstubAllGlobals();
});
it('has two stable, distinct public extension identities', () => {
  const id = (key: string) =>
    createHash('sha256')
      .update(Buffer.from(key, 'base64'))
      .digest('hex')
      .slice(0, 32)
      .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
  expect(id(keys.dev)).toBe(extensionId('dev'));
  expect(id(keys.prod)).toBe(extensionId('prod'));
  expect(id(keys.dev)).not.toBe(id(keys.prod));
});
it('uses the build channel without a runtime user switch', () => {
  expect(extensionChannel()).toBe('dev');
  for (const channel of ['dev', 'prod'] as const) {
    vi.stubGlobal('__AVRU_CHANNEL__', channel);
    expect(parseChannel(channel)).toBe(channel);
    expect(defaultEndpoint()).toBe(
      `http://127.0.0.1:${channel === 'dev' ? '43822' : '43821'}`,
    );
  }
  expect(() => parseChannel('stable')).toThrow();
  vi.stubGlobal('__AVRU_CHANNEL__', 'invalid');
  expect(() => extensionChannel()).toThrow();
});
it('rejects foreign endpoints and legacy or cross-channel credentials', () => {
  expect(socketUrl('http://127.0.0.1:43822', 'dev')).toBe(
    'ws://127.0.0.1:43822/extension',
  );
  expect(() => socketUrl('http://127.0.0.1:43821', 'dev')).toThrow();
  const value = {
    endpoint: 'http://127.0.0.1:43822',
    name: 'n',
    profileId: 'p',
    browserId: 'b',
    token: 't',
  };
  expect(credentials(value, 'dev')).toBeUndefined();
  expect(credentials({ ...value, channel: 'prod' }, 'dev')).toBeUndefined();
  expect(credentials({ ...value, channel: 'dev' }, 'dev')).toBeDefined();
});
