import { describe, expect, it } from 'vitest';
import { releaseChannel, channelPort, extensionId } from '../environment.js';
describe('release identity', () => {
  it('derives channel from immutable semantic release version', () => {
    expect(releaseChannel()).toBe('dev');
    expect(releaseChannel('0.1.0-dev.1')).toBe('dev');
    expect(releaseChannel('0.1.0')).toBe('prod');
    for (const version of ['latest', '0.1.0-beta.1', 'dev', ''])
      expect(() => releaseChannel(version)).toThrow();
    expect(channelPort('dev')).toBe(43822);
    expect(channelPort('prod')).toBe(43821);
    expect(extensionId('prod')).not.toBe(extensionId('dev'));
    // Runtime input validation remains required for untyped callers.
    expect(() => {
      Reflect.apply(channelPort, undefined, ['bad']);
    }).toThrow();
    expect(() => {
      Reflect.apply(extensionId, undefined, ['bad']);
    }).toThrow();
  });
});
