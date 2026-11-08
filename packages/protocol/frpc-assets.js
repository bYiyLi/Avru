// @ts-check
// Official v0.72.0 archives; hashes reviewed against upstream checksums and extracted bytes.
export const FRPC_VERSION = '0.72.0';
export const FRPC_NOTICES_SHA256 =
  '93f2d2abc15d4c6800818308a672ac21cf6ed35fd9891b40ac9ba4eb6f89e695';
export const FRPC_LICENSE_SHA256 =
  'c6596eb7be8581c18be736c846fb9173b69eccf6ef94c5135893ec56bd92ba08';
export const frpcAssets = [
  {
    id: 'darwin-amd64',
    archive: 'frp_0.72.0_darwin_amd64.tar.gz',
    archiveSha256:
      '60439dc6bf794c4182a1a4cac147d642f839d55201607208979eb23aecd09be9',
    sha256: '64b7422a5a497191aa96b509eae3c6acedfd24ba163aebea25ddce444f2ea5f4',
    size: 17521920,
    file: 'frpc',
    machine: 0x01000007,
  },
  {
    id: 'darwin-arm64',
    archive: 'frp_0.72.0_darwin_arm64.tar.gz',
    archiveSha256:
      '6e8576c5b6b9914a86850f6ff4fb81c5a09e706f91f70f64d5f398558bdc9db8',
    sha256: '92f72de7473ca7918f9381e4e467495f4047413f706ee4756582a90706563980',
    size: 15607986,
    file: 'frpc',
    machine: 0x0100000c,
  },
  {
    id: 'windows-amd64',
    archive: 'frp_0.72.0_windows_amd64.zip',
    archiveSha256:
      '5197c1b69564089cdc229fc1260a0e25db1e722b1b7db45fe1542c3c43edf9ae',
    sha256: 'b8580b916ecb2e27ecc348bc67bc8b93b0e65266f85fd5d703e2f2f69862b089',
    size: 17431040,
    file: 'frpc.exe',
    machine: 0x8664,
  },
  {
    id: 'windows-arm64',
    archive: 'frp_0.72.0_windows_arm64.zip',
    archiveSha256:
      'e4b83b66c4045971dd9a47cdef16dd02af471aaa6667dd303e63b1a669162927',
    sha256: '454e74f2d351272d14b7fe002f4771f21f702d178ce3b252bd6b17b93868c656',
    size: 15193088,
    file: 'frpc.exe',
    machine: 0xaa64,
  },
];
export function frpcAsset(platform = process.platform, arch = process.arch) {
  const id = `${platform === 'win32' ? 'windows' : platform}-${arch === 'x64' ? 'amd64' : arch}`;
  const asset = frpcAssets.find((item) => item.id === id);
  if (!asset) throw new Error('unsupported_frpc_platform');
  return asset;
}
