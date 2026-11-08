import { createHash } from 'node:crypto';
import {
  frpcAssets,
  FRPC_LICENSE_SHA256,
  FRPC_NOTICES_SHA256,
} from '../../packages/protocol/frpc-assets.js';
export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
export function verifyFrpc(bytes, id) {
  const asset = frpcAssets.find((item) => item.id === id);
  if (!asset || bytes.length !== asset.size || sha256(bytes) !== asset.sha256)
    throw new Error('FRPC asset integrity mismatch');
  const offset = id.startsWith('windows') ? bytes.readUInt32LE(0x3c) : 0;
  const correct = id.startsWith('windows')
    ? bytes.subarray(0, 2).toString() === 'MZ' &&
      bytes.readUInt32LE(offset) === 0x4550 &&
      bytes.readUInt16LE(offset + 4) === asset.machine
    : bytes.readUInt32LE(0) === 0xfeedfacf &&
      bytes.readUInt32LE(4) === asset.machine;
  if (!correct) throw new Error('FRPC executable architecture mismatch');
}
export function verifyFrpcLicense(bytes) {
  if (sha256(bytes) !== FRPC_LICENSE_SHA256)
    throw new Error('FRPC license mismatch');
}
export function verifyFrpcNotices(bytes) {
  if (sha256(bytes) !== FRPC_NOTICES_SHA256)
    throw new Error('FRPC dependency notices mismatch');
}
