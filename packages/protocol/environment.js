// @ts-check
// Shared build/runtime identity. This module contains no platform or I/O capability.
export const RELEASE_VERSION = '0.1.0-dev.1';
export function releaseChannel(version = RELEASE_VERSION) {
  if (/^\d+\.\d+\.\d+-dev\.\d+$/.test(version)) return 'dev';
  if (/^\d+\.\d+\.\d+$/.test(version)) return 'prod';
  throw new Error('Unsupported release channel version');
}
/** @param {'dev'|'prod'} channel */
export function channelPort(channel) {
  if (channel === 'dev') return 43822;
  if (channel === 'prod') return 43821;
  throw new Error('Invalid release channel');
}

/** @param {'dev'|'prod'} channel */
export function extensionId(channel) {
  if (channel === 'dev') return 'cbjgomelhiahmdadpkeijpbkldblanei';
  if (channel === 'prod') return 'dpkmmdoagnlnjcdfakmlblpaagoniehp';
  throw new Error('Invalid release channel');
}
