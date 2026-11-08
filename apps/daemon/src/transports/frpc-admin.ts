import { createServer } from 'node:net';
import { record } from '../messages.js';
export interface ProcessIdentity {
  instance: string;
  pid: number;
  port: number;
  username: string;
  password: string;
  proxy: string;
}
export function processIdentity(raw: unknown): ProcessIdentity {
  if (
    !record(raw) ||
    typeof raw.instance !== 'string' ||
    !/^[a-f0-9]{32}$/.test(raw.instance) ||
    typeof raw.pid !== 'number' ||
    !Number.isInteger(raw.pid) ||
    raw.pid <= 0 ||
    typeof raw.port !== 'number' ||
    !Number.isInteger(raw.port) ||
    raw.port < 1024 ||
    raw.port > 65535 ||
    typeof raw.username !== 'string' ||
    !/^[a-f0-9]{32}$/.test(raw.username) ||
    typeof raw.password !== 'string' ||
    !/^[a-f0-9]{64}$/.test(raw.password) ||
    typeof raw.proxy !== 'string' ||
    !/^avru-(?:dev|prod)-[a-f0-9]{32}$/.test(raw.proxy)
  )
    throw new Error('ownership_unknown');
  return {
    instance: raw.instance,
    pid: raw.pid,
    port: raw.port,
    username: raw.username,
    password: raw.password,
    proxy: raw.proxy,
  };
}
export async function admin(
  identity: ProcessIdentity,
  stop = false,
  ownership = false,
): Promise<boolean> {
  const response = await fetch(
    `http://127.0.0.1:${String(identity.port)}/api/${stop ? 'stop' : 'status'}`,
    {
      method: stop ? 'POST' : 'GET',
      headers: {
        Authorization: `Basic ${Buffer.from(`${identity.username}:${identity.password}`).toString('base64')}`,
      },
      signal: AbortSignal.timeout(2000),
      redirect: 'error',
    },
  );
  if (!response.ok) throw new Error('ownership_unknown');
  if (stop) {
    await response.body?.cancel();
    return true;
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('ownership_unknown');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (
      let chunk = await reader.read();
      !chunk.done;
      chunk = await reader.read()
    ) {
      size += chunk.value.length;
      if (size > 65536) throw new Error('ownership_unknown');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  const raw: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!record(raw) || !Array.isArray(raw.https))
    throw new Error('ownership_unknown');
  return raw.https.some(
    (item: unknown) =>
      record(item) &&
      item.name === identity.proxy &&
      (ownership || item.status === 'running'),
  );
}
export async function unusedAdminPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  if (!address || typeof address === 'string')
    throw new Error('connection_unavailable');
  return address.port;
}
export function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      'code' in error &&
      error.code === 'ESRCH'
    );
  }
}
