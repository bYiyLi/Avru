import { rejectLinks } from './install-files.js';
import {
  channelPort,
  releaseChannel,
} from '../../../packages/protocol/environment.js';
import type { ReleaseChannel } from './channel-root.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export interface RuntimeDescriptor {
  channel: ReleaseChannel;
  pid: number;
  port: number;
  url: string;
  instance: string;
}
export function parseRuntime(text: string): RuntimeDescriptor {
  const value: unknown = JSON.parse(text);
  if (
    typeof value !== 'object' ||
    value === null ||
    !('channel' in value) ||
    (value.channel !== 'dev' && value.channel !== 'prod') ||
    !('pid' in value) ||
    !('port' in value) ||
    !('url' in value) ||
    !('instance' in value) ||
    typeof value.pid !== 'number' ||
    !Number.isInteger(value.pid) ||
    value.pid <= 0 ||
    typeof value.port !== 'number' ||
    !Number.isInteger(value.port) ||
    value.port < 1024 ||
    value.port > 65535 ||
    typeof value.url !== 'string' ||
    typeof value.instance !== 'string' ||
    !/^[a-f0-9]{32}$/.test(value.instance)
  ) {
    throw new Error('Invalid daemon runtime descriptor');
  }
  if (
    !new RegExp(
      `^http://127\\.0\\.0\\.1:${String(value.port)}/#key=[a-f0-9]{64}$`,
    ).test(value.url)
  )
    throw new Error('Invalid daemon management URL');
  return {
    channel: value.channel,
    pid: value.pid,
    port: value.port,
    url: value.url,
    instance: value.instance,
  };
}
async function runtimeRequest(runtime: RuntimeDescriptor, action: string) {
  const url = new URL(runtime.url);
  return fetch(`${url.origin}/api/${action}`, {
    method: action === 'shutdown' ? 'POST' : 'GET',
    headers: {
      authorization: `Bearer ${url.hash.slice(5)}`,
      origin: url.origin,
    },
    signal: AbortSignal.timeout(1500),
  });
}
export async function inspectRuntime(
  dataRoot: string,
  channel: ReleaseChannel = releaseChannel(),
): Promise<RuntimeDescriptor | undefined> {
  try {
    const runtime = parseRuntime(
      await readFile(join(dataRoot, 'runtime.json'), 'utf8'),
    );
    if (runtime.channel !== channel) return undefined;
    const response = await runtimeRequest(runtime, 'runtime');
    const body: unknown = await response.json();
    if (
      response.ok &&
      typeof body === 'object' &&
      body !== null &&
      'channel' in body &&
      body.channel === channel &&
      'instance' in body &&
      body.instance === runtime.instance
    )
      return runtime;
  } catch {
    /* Missing, stale or untrusted descriptor is not a live daemon. */
  }
  return undefined;
}
async function verifiedRuntime(
  dataRoot: string,
  channel: ReleaseChannel = releaseChannel(),
): Promise<RuntimeDescriptor | undefined> {
  try {
    await readFile(join(dataRoot, 'runtime.json'), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return undefined;
    throw error;
  }
  const runtime = await inspectRuntime(dataRoot, channel);
  if (!runtime)
    throw Object.assign(
      new Error(
        'Existing daemon state cannot be authenticated; inspect runtime.json and daemon.log before recovery',
      ),
      { code: 'AVRU_RUNTIME_UNVERIFIED' },
    );
  return runtime;
}
export async function stopRuntime(
  dataRoot: string,
  channel: ReleaseChannel = releaseChannel(),
): Promise<void> {
  const runtime = await verifiedRuntime(dataRoot, channel);
  if (!runtime) return;
  const response = await runtimeRequest(runtime, 'shutdown');
  if (!response.ok)
    throw new Error('Daemon refused shutdown; no process was killed');
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await readFile(join(dataRoot, 'runtime.json'), 'utf8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return;
      throw error;
    }
    await delay(100);
  }
  throw new Error('Daemon shutdown timed out; no process was killed');
}
export async function startRuntime(options: {
  dataRoot: string;
  payloadRoot: string;
  execPath: string;
  port?: number;
  channel?: ReleaseChannel;
}): Promise<RuntimeDescriptor> {
  const existing = await verifiedRuntime(options.dataRoot, options.channel);
  if (existing) return existing;
  await mkdir(options.dataRoot, { recursive: true, mode: 0o700 });
  const logPath = join(options.dataRoot, 'daemon.log');
  await rejectLinks(logPath);
  const log = await open(logPath, 'a', 0o600);
  const status = { failed: false, closed: false };
  let child: ChildProcess;
  try {
    child = spawn(options.execPath, [join(options.payloadRoot, 'daemon.mjs')], {
      detached: true,
      windowsHide: true,
      stdio: ['ignore', log.fd, log.fd],
      env: {
        ...process.env,
        AVRU_DATA_DIR: options.dataRoot,
        AVRU_WEB_ROOT: join(options.payloadRoot, 'web'),
        AVRU_CHANNEL: options.channel ?? releaseChannel(),
        AVRU_PORT: String(
          options.port ?? channelPort(options.channel ?? releaseChannel()),
        ),
      },
    });
    child.on('error', () => {
      status.failed = true;
    });
    child.once('close', () => {
      status.closed = true;
    });
    child.unref();
  } finally {
    await log.close();
  }
  for (let attempt = 0; attempt < 50; attempt++) {
    if (status.failed || status.closed) break;
    const runtime = await inspectRuntime(options.dataRoot, options.channel);
    if (runtime && runtime.pid === child.pid) return runtime;
    await delay(100);
  }
  await cancelOwnedChild(child, status);
  throw new Error(
    'Daemon did not become ready. Check the private daemon.log; no success is reported.',
  );
}
async function cancelOwnedChild(
  child: ChildProcess,
  status: { closed: boolean },
): Promise<void> {
  const isClosed = () => status.closed;
  if (isClosed() || child.pid === undefined) return;
  // Only the handle spawned in this invocation; never a persisted PID.
  child.kill('SIGKILL');
  for (let attempt = 0; attempt < 40; attempt++) {
    if (isClosed()) return;
    await delay(100);
  }
  throw Object.assign(
    new Error(
      'Could not confirm spawned daemon exit; stop recovery and inspect daemon.log',
    ),
    { code: 'AVRU_PROCESS_EXIT_UNCONFIRMED' },
  );
}
export function openManagement(url: string, platform: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || parsed.protocol !== 'http:')
    return Promise.reject(new Error('Management URL must be loopback HTTP'));
  const command = platform === 'darwin' ? 'open' : 'rundll32.exe';
  const args =
    platform === 'darwin' ? [url] : ['url.dll,FileProtocolHandler', url];
  if (platform !== 'darwin' && platform !== 'win32')
    return Promise.reject(new Error('Unsupported platform'));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error('Could not open management page'));
    });
  });
}
