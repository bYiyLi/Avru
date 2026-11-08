import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { ConnectionBundle } from './connection-bundle.js';
import type { ProcessIdentity } from './frpc-admin.js';
import { unusedAdminPort } from './frpc-admin.js';
import { planFrpc } from './frpc-plan.js';
import { writePrivate } from './private-files.js';
export async function prepareProcess(
  directory: string,
  bundle: ConnectionBundle,
  localPort: number,
) {
  const identity: ProcessIdentity = {
    instance: randomBytes(16).toString('hex'),
    pid: 0,
    port: await unusedAdminPort(),
    username: randomBytes(16).toString('hex'),
    password: randomBytes(32).toString('hex'),
    proxy: '',
  };
  identity.proxy = `avru-${bundle.channel}-${identity.instance}`;
  const files = {
    serverCaPath: join(directory, 'ca.pem'),
    certificatePath: join(directory, 'certificate.pem'),
    privateKeyPath: join(directory, 'key.pem'),
  };
  const preview = planFrpc(
    {
      channel: bundle.channel,
      oauth: bundle.oauth,
      localManagementPort: localPort,
    },
    {
      serverAddr: bundle.frp.serverAddr,
      serverPort: bundle.frp.serverPort,
      ...files,
    },
  );
  const config = {
    ...preview.configuration,
    proxies: [{ ...preview.configuration.proxies[0], name: identity.proxy }],
  };
  await writePrivate(files.serverCaPath, bundle.frp.serverCaPem);
  await writePrivate(files.certificatePath, bundle.frp.certificatePem);
  await writePrivate(files.privateKeyPath, bundle.frp.privateKeyPem);
  const configPath = join(directory, 'frpc.json');
  await writePrivate(
    configPath,
    JSON.stringify({
      ...config,
      loginFailExit: false,
      webServer: {
        addr: '127.0.0.1',
        port: identity.port,
        user: identity.username,
        password: identity.password,
      },
      log: { to: 'console', level: 'error', disablePrintColor: true },
    }),
  );
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    'SystemRoot',
    'SYSTEMROOT',
    'WINDIR',
    'HOME',
    'USERPROFILE',
    'TMP',
    'TEMP',
  ])
    if (process.env[key] !== undefined) env[key] = process.env[key];
  // FRP templates expand into JSON before parsing: escape the value as JSON string content.
  env[preview.requiredSecretEnvironment] = JSON.stringify(
    bundle.frp.token,
  ).slice(1, -1);
  return { identity, configPath, env };
}
