import {
  X509Certificate,
  createPrivateKey,
  createPublicKey,
} from 'node:crypto';
import { record } from '../messages.js';
import type { ReleaseChannel } from '../../../../packages/protocol/environment.js';
import { channelPort } from '../../../../packages/protocol/environment.js';
import { validateConfig } from '../oauth/config.js';
import type { OAuthClient } from '../oauth/config.js';
import { planFrpc } from './frpc-plan.js';

export interface ConnectionBundle {
  schemaVersion: 1;
  channel: ReleaseChannel;
  oauth: { issuer: string; port: number; clients: OAuthClient[] };
  frp: {
    serverAddr: string;
    serverPort: number;
    token: string;
    serverCaPem: string;
    certificatePem: string;
    privateKeyPem: string;
  };
}
function fields(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !record(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !(key in value))
  )
    throw new Error('configuration_invalid');
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 65536)
    throw new Error('configuration_invalid');
  return value;
}
function clients(value: unknown): OAuthClient[] {
  if (!Array.isArray(value)) throw new Error('configuration_invalid');
  return value.map((raw: unknown) => {
    const item = fields(raw, ['id', 'name', 'redirectUris']);
    if (!Array.isArray(item.redirectUris))
      throw new Error('configuration_invalid');
    return {
      id: text(item.id),
      name: text(item.name),
      redirectUris: item.redirectUris.map((uri: unknown) => text(uri)),
    };
  });
}
function certificates(bundle: ConnectionBundle): void {
  const ca = new X509Certificate(bundle.frp.serverCaPem);
  const cert = new X509Certificate(bundle.frp.certificatePem);
  const key = createPrivateKey(bundle.frp.privateKeyPem);
  const publicKey = createPublicKey(key).export({
    type: 'spki',
    format: 'der',
  });
  if (
    !ca.ca ||
    !cert.checkHost(new URL(bundle.oauth.issuer).hostname) ||
    !cert.publicKey.export({ type: 'spki', format: 'der' }).equals(publicKey) ||
    Date.parse(cert.validTo) <= Date.now() ||
    Date.parse(cert.validFrom) > Date.now() ||
    Date.parse(ca.validTo) <= Date.now()
  )
    throw new Error('configuration_invalid');
}
export function parseBundle(
  raw: unknown,
  channel: ReleaseChannel,
  localPort: number,
): ConnectionBundle {
  const value = fields(raw, ['schemaVersion', 'channel', 'oauth', 'frp']);
  const oauth = fields(value.oauth, ['issuer', 'port', 'clients']);
  const frp = fields(value.frp, [
    'serverAddr',
    'serverPort',
    'token',
    'serverCaPem',
    'certificatePem',
    'privateKeyPem',
  ]);
  if (
    value.schemaVersion !== 1 ||
    value.channel !== channel ||
    typeof oauth.port !== 'number' ||
    typeof frp.serverPort !== 'number' ||
    oauth.port === channelPort(channel === 'dev' ? 'prod' : 'dev')
  )
    throw new Error('configuration_invalid');
  const bundle: ConnectionBundle = {
    schemaVersion: 1,
    channel,
    oauth: {
      ...validateConfig({
        issuer: text(oauth.issuer),
        clients: clients(oauth.clients),
      }),
      port: oauth.port,
    },
    frp: {
      serverAddr: text(frp.serverAddr),
      serverPort: frp.serverPort,
      token: text(frp.token),
      serverCaPem: text(frp.serverCaPem),
      certificatePem: text(frp.certificatePem),
      privateKeyPem: text(frp.privateKeyPem),
    },
  };
  if (bundle.frp.token.length > 4096 || /[\p{Cc}]/u.test(bundle.frp.token))
    throw new Error('configuration_invalid');
  planFrpc(
    { channel, localManagementPort: localPort, oauth: bundle.oauth },
    {
      serverAddr: bundle.frp.serverAddr,
      serverPort: bundle.frp.serverPort,
      serverCaPath: 'ca.pem',
      certificatePath: 'certificate.pem',
      privateKeyPath: 'key.pem',
    },
  );
  certificates(bundle);
  return bundle;
}
