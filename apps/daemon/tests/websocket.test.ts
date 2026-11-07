import { once } from 'node:events';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { decodeFrame } from '../src/websocket.js';
import { record } from '../src/messages.js';
const port = 43824;
const host = `127.0.0.1:${String(port)}`;
const origin = `chrome-extension://${'a'.repeat(32)}`;
const adminKey = 'c'.repeat(64);
const headers = {
  host,
  origin: `http://${host}`,
  authorization: `Bearer ${adminKey}`,
};
const instances: ReturnType<typeof buildApp>[] = [];
const clients: WebSocket[] = [];
afterEach(async () => {
  for (const socket of clients.splice(0)) socket.terminate();
  await Promise.all(instances.splice(0).map((app) => app.close()));
});
function message(
  socket: WebSocket,
  expectedType?: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const receive = (bytes: Buffer) => {
      const parsed: unknown = JSON.parse(bytes.toString());
      if (!record(parsed)) {
        socket.off('message', receive);
        reject(new Error('Invalid response'));
        return;
      }
      if (expectedType && parsed.type !== expectedType) return;
      socket.off('message', receive);
      resolve(parsed);
    };
    socket.on('message', receive);
  });
}
async function start() {
  const app = buildApp({ port, adminKey });
  instances.push(app);
  await app.listen({ port, host: '127.0.0.1' });
  return app;
}
async function connect() {
  const socket = new WebSocket(`ws://${host}/extension`, { origin });
  clients.push(socket);
  await once(socket, 'open');
  return socket;
}
describe('real local WebSocket transport', () => {
  it('decodes all ws raw text frame representations', () => {
    expect(decodeFrame([Buffer.from('a'), Buffer.from('b')])).toBe('ab');
    expect(decodeFrame(new Uint8Array([97, 98]).buffer)).toBe('ab');
  });
  it('approves an extension and revokes the exact authenticated connection', async () => {
    const app = await start();
    const socket = await connect();
    let incoming = message(socket);
    socket.send(
      JSON.stringify({ v: 1, type: 'pair', profileId: 'p', name: 'Chrome' }),
    );
    const pending = await incoming;
    expect(pending.type).toBe('pairing');
    incoming = message(socket);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/pairings/${String(pending.requestId)}/approve`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(204);
    const paired = await incoming;
    expect(paired.type).toBe('paired');
    incoming = message(socket, 'pong');
    socket.send(JSON.stringify({ v: 1, type: 'ping' }));
    expect((await incoming).type).toBe('pong');
    const response = await app.inject({ url: '/api/browsers', headers });
    expect(response.body).toContain('Chrome');
    incoming = message(socket);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/browsers/${String(paired.browserId)}`,
          headers,
        })
      ).statusCode,
    ).toBe(204);
    expect((await incoming).code).toBe('revoked');
    await once(socket, 'close');
  });
  it('refuses arbitrary webpage origins, absent origins, wrong host/path and binary frames', async () => {
    await start();
    for (const options of [
      { path: '/extension', headers: { origin: 'https://evil.test' } },
      { path: '/extension', headers: {} },
      { path: '/other', headers: { origin } },
      { path: '/extension', headers: { origin, host: 'evil.test' } },
    ]) {
      const socket = new WebSocket(`ws://${host}${options.path}`, {
        headers: options.headers,
      });
      clients.push(socket);
      await expect(once(socket, 'open')).rejects.toThrow();
    }
    const socket = await connect();
    const incoming = message(socket);
    socket.send(Buffer.from('{}'));
    expect((await incoming).code).toBe('invalid');
    await once(socket, 'close');
  });
  it('rejects pending requests and expires idle connections', async () => {
    const app = await start();
    const socket = await connect();
    let incoming = message(socket);
    socket.send(
      JSON.stringify({ v: 1, type: 'pair', profileId: 'p', name: 'Chrome' }),
    );
    const pending = await incoming;
    incoming = message(socket);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/pairings/${String(pending.requestId)}`,
          headers,
        })
      ).statusCode,
    ).toBe(204);
    expect((await incoming).code).toBe('rejected');
    await once(socket, 'close');
    const idle = await connect();
    expect((await message(idle)).code).toBe('timeout');
    await once(idle, 'close');
  }, 10_000);
});
