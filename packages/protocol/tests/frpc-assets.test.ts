import { expect, it } from 'vitest';
import { frpcAsset, frpcAssets, FRPC_VERSION } from '../frpc-assets.js';
it('selects the four pinned platform identities without runtime channel changes', () => {
  expect(FRPC_VERSION).toBe('0.72.0');
  expect(frpcAssets).toHaveLength(4);
  expect(frpcAsset('darwin', 'x64').id).toBe('darwin-amd64');
  expect(frpcAsset('darwin', 'arm64').id).toBe('darwin-arm64');
  expect(frpcAsset('win32', 'x64').file).toBe('frpc.exe');
  expect(frpcAsset('win32', 'arm64').id).toBe('windows-arm64');
  expect(() => frpcAsset('linux', 'x64')).toThrow();
  expect(() => frpcAsset('darwin', 'ia32')).toThrow();
});
