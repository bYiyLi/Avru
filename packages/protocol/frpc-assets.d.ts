export interface FrpcAsset {
  id: string;
  archive: string;
  archiveSha256: string;
  sha256: string;
  size: number;
  file: string;
  machine: number;
}
export const FRPC_VERSION: string;
export const FRPC_NOTICES_SHA256: string;
export const FRPC_LICENSE_SHA256: string;
export const frpcAssets: FrpcAsset[];
export function frpcAsset(platform?: NodeJS.Platform, arch?: string): FrpcAsset;
