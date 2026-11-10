import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConnectionBundle } from '../src/transports/connection-bundle.js';
let cached: ConnectionBundle | undefined;
export function connectionBundle(): ConnectionBundle {
  if (!cached) cached = generate();
  return structuredClone(cached);
}
function generate(): ConnectionBundle {
  const root = mkdtempSync(join(tmpdir(), 'avru-cert-'));
  try {
    const config = join(root, 'openssl.cnf');
    writeFileSync(
      config,
      [
        '[req]',
        'prompt = no',
        'distinguished_name = dn',
        'x509_extensions = v3_ca',
        '[dn]',
        'CN = avru.example',
        '[v3_ca]',
        'basicConstraints = critical,CA:TRUE',
        'keyUsage = critical,keyCertSign,digitalSignature',
        'subjectAltName = DNS:avru.example',
        '',
      ].join('\n'),
    );
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '2',
        '-config',
        config,
        '-extensions',
        'v3_ca',
        '-keyout',
        join(root, 'key.pem'),
        '-out',
        join(root, 'certificate.pem'),
      ],
      { stdio: 'ignore' },
    );
    const certificate = readFileSync(join(root, 'certificate.pem'), 'utf8');
    return {
      schemaVersion: 1,
      channel: 'dev',
      oauth: {
        issuer: 'https://avru.example',
        port: 43900,
        clients: [
          {
            id: 'test-client',
            name: 'Test client',
            redirectUris: ['https://client.example/callback'],
          },
        ],
      },
      frp: {
        serverAddr: 'frps.example',
        serverPort: 7000,
        token: 'fixture-connection-value',
        serverCaPem: certificate,
        certificatePem: certificate,
        privateKeyPem: readFileSync(join(root, 'key.pem'), 'utf8'),
      },
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
