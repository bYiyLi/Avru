import { expect, it } from 'vitest';
import { planFrpc } from '../src/transports/frpc-plan.js';
const context = {
  channel: 'dev' as const,
  localManagementPort: 43821,
  oauth: {
    port: 43822,
    issuer: 'https://avru.example',
    clients: [
      {
        id: 'client',
        name: 'Client',
        redirectUris: ['https://client.example/callback'],
      },
    ],
  },
};
const input = {
  serverAddr: 'frps.example',
  serverPort: 7000,
  serverCaPath: '/certs/frps-ca.pem',
  certificatePath: '/certs/public.pem',
  privateKeyPath: '/certs/public-key.pem',
};
it('generates a non-enabled HTTPS preview with isolated port, verified FRPS TLS and secret reference', () => {
  for (const channel of ['dev', 'prod'] as const) {
    const plan = planFrpc({ ...context, channel }, input);
    expect(plan).toMatchObject({
      state: 'previewOnly',
      enabled: false,
      verified: false,
      mcpUrl: 'https://avru.example/mcp',
    });
    expect(JSON.parse(plan.configJson)).toEqual({
      serverAddr: 'frps.example',
      serverPort: 7000,
      auth: {
        method: 'token',
        token: `{{ .Envs.AVRU_${channel.toUpperCase()}_FRP_TOKEN }}`,
      },
      transport: {
        tls: {
          enable: true,
          trustedCaFile: input.serverCaPath,
          serverName: input.serverAddr,
        },
      },
      proxies: [
        {
          name: `avru-${channel}-mcp`,
          type: 'https',
          customDomains: ['avru.example'],
          plugin: {
            type: 'https2http',
            localAddr: '127.0.0.1:43822',
            crtPath: input.certificatePath,
            keyPath: input.privateKeyPath,
            hostHeaderRewrite: 'avru.example',
          },
        },
      ],
    });
    expect(plan.configJson).not.toContain('43821');
  }
});
it('rejects management port forwarding, invalid OAuth and unsupported public ports', () => {
  expect(() =>
    planFrpc({ ...context, oauth: { ...context.oauth, port: 43821 } }, input),
  ).toThrow('management_port');
  expect(() =>
    planFrpc(
      {
        ...context,
        oauth: { ...context.oauth, issuer: 'http://avru.example' },
      },
      input,
    ),
  ).toThrow();
  expect(() =>
    planFrpc(
      {
        ...context,
        oauth: { ...context.oauth, issuer: 'https://avru.example:8443' },
      },
      input,
    ),
  ).toThrow('unsupported');
  expect(() =>
    planFrpc({ ...context, oauth: { ...context.oauth, clients: [] } }, input),
  ).toThrow();
});
it('rejects unsafe template, controls, missing values and malformed hosts without echoing inputs', () => {
  for (const field of [
    'serverCaPath',
    'certificatePath',
    'privateKeyPath',
  ] as const) {
    for (const value of [
      '',
      '\nsecret',
      '{{ .Envs.OTHER }}',
      'x'.repeat(1025),
    ]) {
      expect(() => planFrpc(context, { ...input, [field]: value })).toThrow(
        'invalid_frpc_text',
      );
    }
  }
  for (const serverAddr of [
    'https://host',
    'host:7000',
    'host/path',
    'x@host',
    '-host',
    'a..host',
    'x'.repeat(254),
    'x'.repeat(64) + '.example',
  ])
    expect(() => planFrpc(context, { ...input, serverAddr })).toThrow(
      'hostname',
    );
  for (const serverPort of [0, -1, 65536, 1024.5, Number.NaN])
    expect(() => planFrpc(context, { ...input, serverPort })).toThrow('port');
});
it('preserves Windows paths through JSON serialization, without reading private keys', () => {
  const plan = planFrpc(context, {
    ...input,
    privateKeyPath: 'C:\\Avru\\dev\\tls\\server.key',
  });
  expect(JSON.parse(plan.configJson)).toMatchObject({
    proxies: [{ plugin: { keyPath: 'C:\\Avru\\dev\\tls\\server.key' } }],
  });
});

it('allows FRPS control TLS on 443 without changing public MCP port or listener', () => {
  const result: unknown = JSON.parse(
    planFrpc(context, { ...input, serverPort: 443 }).configJson,
  );
  expect(result).toMatchObject({ serverPort: 443 });
});
