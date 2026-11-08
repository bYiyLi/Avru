import { expect, it } from 'vitest';
import { parseBundle } from '../src/transports/connection-bundle.js';
import { connectionBundle } from './connection-fixture.js';
it('accepts a portable, exact environment bundle and rejects authority, path and certificate tampering', () => {
  const bundle = connectionBundle();
  expect(parseBundle(bundle, 'dev', 43822)).toEqual(bundle);
  const bad: unknown[] = [
    null,
    {},
    { ...bundle, command: 'shell' },
    { ...bundle, schemaVersion: 2 },
    { ...bundle, channel: 'prod' },
    { ...bundle, oauth: { ...bundle.oauth, port: 43821 } },
    { ...bundle, oauth: { ...bundle.oauth, port: 43822 } },
    { ...bundle, oauth: { ...bundle.oauth, port: '1234' } },
    { ...bundle, oauth: { ...bundle.oauth, issuer: 'http://avru.example' } },
    { ...bundle, oauth: { ...bundle.oauth, issuer: 'https://wrong.example' } },
    { ...bundle, oauth: { ...bundle.oauth, clients: null } },
    {
      ...bundle,
      oauth: {
        ...bundle.oauth,
        clients: [{ id: '', name: '', redirectUris: [] }],
      },
    },
    {
      ...bundle,
      oauth: {
        ...bundle.oauth,
        clients: [{ id: 'a', name: 'b', redirectUris: null }],
      },
    },
  ];
  for (const raw of bad) expect(() => parseBundle(raw, 'dev', 43822)).toThrow();
  for (const [key, value] of Object.entries({
    serverAddr: '{{ attack }}',
    serverPort: '1',
    token: 'x\ny',
    serverCaPem: '',
    certificatePem: 'not a certificate',
    privateKeyPem: 'not a key',
  })) {
    expect(() =>
      parseBundle(
        { ...bundle, frp: { ...bundle.frp, [key]: value } },
        'dev',
        43822,
      ),
    ).toThrow();
  }
  for (const token of ['', 'a'.repeat(4097), 'a'.repeat(65537), 1])
    expect(() =>
      parseBundle({ ...bundle, frp: { ...bundle.frp, token } }, 'dev', 43822),
    ).toThrow();
  const other = connectionBundle();
  const client = other.oauth.clients[0];
  if (!client) throw new Error('missing fixture client');
  client.redirectUris = [42 as unknown as string];
  expect(() => parseBundle(other, 'dev', 43822)).toThrow();
});
