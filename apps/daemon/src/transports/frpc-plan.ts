import type { ReleaseChannel } from '../../../../packages/protocol/environment.js';
import type { OAuthConfig } from '../oauth/config.js';
import { validateConfig } from '../oauth/config.js';

export interface FrpcInput {
  serverAddr: string;
  serverPort: number;
  serverCaPath: string;
  certificatePath: string;
  privateKeyPath: string;
}
export interface FrpcContext {
  channel: ReleaseChannel;
  localManagementPort: number;
  oauth: OAuthConfig & { port: number };
}
function safeText(value: string): string {
  if (!value || value.length > 1024 || /[{}\p{Cc}]/u.test(value))
    throw new Error('invalid_frpc_text');
  return value;
}
function port(value: number, minimum = 1024): number {
  if (!Number.isInteger(value) || value < minimum || value > 65535)
    throw new Error('invalid_frpc_port');
  return value;
}
function hostname(value: string): string {
  safeText(value);
  if (
    value.length > 253 ||
    value
      .split('.')
      .some(
        (label) =>
          !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/u.test(label),
      )
  )
    throw new Error('invalid_frpc_hostname');
  return value;
}

/** Pure preview: does not read files, persist configuration or start a tunnel. */
export function planFrpc(context: FrpcContext, input: FrpcInput) {
  const oauth = validateConfig(context.oauth);
  const issuer = new URL(oauth.issuer);
  if (issuer.port || !['dev', 'prod'].includes(context.channel))
    throw new Error('unsupported_frpc_context');
  hostname(issuer.hostname);
  const localPort = port(context.oauth.port);
  if (localPort === port(context.localManagementPort))
    throw new Error('management_port_must_not_be_forwarded');
  const serverAddr = hostname(input.serverAddr);
  const tokenEnv = `AVRU_${context.channel.toUpperCase()}_FRP_TOKEN`;
  const config = {
    serverAddr,
    serverPort: port(input.serverPort, 1),
    auth: { method: 'token', token: `{{ .Envs.${tokenEnv} }}` },
    transport: {
      tls: {
        enable: true,
        trustedCaFile: safeText(input.serverCaPath),
        serverName: serverAddr,
      },
    },
    proxies: [
      {
        name: `avru-${context.channel}-mcp`,
        type: 'https',
        customDomains: [issuer.hostname],
        plugin: {
          type: 'https2http',
          localAddr: `127.0.0.1:${String(localPort)}`,
          crtPath: safeText(input.certificatePath),
          keyPath: safeText(input.privateKeyPath),
          hostHeaderRewrite: issuer.host,
        },
      },
    ] as const,
  };
  return {
    state: 'previewOnly' as const,
    enabled: false as const,
    verified: false as const,
    mcpUrl: `${oauth.issuer}/mcp`,
    requiredSecretEnvironment: tokenEnv,
    configuration: config,
    configJson: JSON.stringify(config, null, 2),
  };
}
