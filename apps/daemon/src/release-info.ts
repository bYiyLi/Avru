import { RELEASE_VERSION } from '../../../packages/protocol/environment.js';
// Checked against the CLI distribution and extension manifest by release-info.test.ts.
export const releaseInfo = {
  daemonVersion: RELEASE_VERSION,
  expectedExtensionVersion: '0.0.1',
} as const;
