import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp } from 'node:fs/promises';
import { resolve } from 'node:path';

export const testChannel =
  process.env.AVRU_E2E_CHANNEL === 'prod' ? 'prod' : 'dev';
export const testPort = testChannel === 'prod' ? 43821 : 43822;
export const testPackage =
  testChannel === 'prod' ? 'artifacts/avru-prod' : 'artifacts/avru';

/** Run the candidate from a copied, isolated location outside the checkout. */
export async function startIsolatedDaemon(
  dataDirectory: string,
  oauthConfig: string,
  isolatedPackageRoot: string,
) {
  await cp(
    resolve(process.env.AVRU_E2E_PACKAGE_ROOT ?? testPackage),
    isolatedPackageRoot,
    { recursive: true },
  );
  return startDaemon(dataDirectory, oauthConfig, isolatedPackageRoot);
}

export async function startDaemon(
  dataDirectory: string,
  oauthConfig?: string,
  packageRootOverride?: string,
) {
  const packageRoot =
    packageRootOverride ??
    process.env.AVRU_E2E_PACKAGE_ROOT ??
    (testChannel === 'prod' ? resolve(testPackage) : undefined);
  const entry = packageRoot
    ? resolve(packageRoot, 'payload/daemon.mjs')
    : resolve('apps/daemon/dist/main.js');
  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      AVRU_PORT: String(testPort),
      AVRU_DATA_DIR: dataDirectory,
      AVRU_CHANNEL: testChannel,
      ...(packageRoot
        ? { AVRU_WEB_ROOT: resolve(packageRoot, 'payload/web') }
        : {}),
      ...(oauthConfig ? { AVRU_OAUTH_CONFIG: oauthConfig } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-4000);
  });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const closed = once(child, 'exit');
    child.kill('SIGTERM');
    const deadline = setTimeout(() => {
      child.kill('SIGKILL');
    }, 5000);
    try {
      await closed;
    } finally {
      clearTimeout(deadline);
    }
  };
  try {
    const url = await new Promise<string>((resolveUrl, reject) => {
      let output = '';
      const deadline = setTimeout(() => {
        reject(new Error('Daemon startup timed out'));
      }, 20_000);
      const fail = () => {
        clearTimeout(deadline);
        reject(
          new Error(
            `Daemon exited before management endpoint was ready${stderr ? `:\n${stderr}` : ''}`,
          ),
        );
      };
      child.once('error', fail);
      child.once('exit', fail);
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        const link = new RegExp(
          `http://127\\.0\\.0\\.1:${String(testPort)}/#key=[a-f0-9]{64}`,
        ).exec(output)?.[0];
        if (!link) return;
        clearTimeout(deadline);
        child.off('error', fail);
        child.off('exit', fail);
        resolveUrl(link);
      });
    });
    return { url, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
