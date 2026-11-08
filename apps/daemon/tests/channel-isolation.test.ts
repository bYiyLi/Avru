import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { record } from '../src/messages.js';
import { extensionId } from '../../../packages/protocol/environment.js';
import type { ReleaseChannel } from '../../../packages/protocol/environment.js';
function next(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) =>
    socket.once('message', (data: Buffer) => {
      const value: unknown = JSON.parse(data.toString());
      if (!record(value)) {
        reject(new Error('Invalid frame'));
        return;
      }
      resolve(value);
    }),
  );
}
it('isolates simultaneous dev/prod transports, credentials, state and shutdown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'avru-dual-'));
  const states = (['dev', 'prod'] as const).map((channel, index) => {
    const port = 43841 + index;
    const key = (index ? 'b' : 'a').repeat(64);
    return {
      channel,
      port,
      key,
      app: buildApp({
        channel,
        port,
        adminKey: key,
        databasePath: join(root, `${channel}.sqlite`),
      }),
    };
  });
  const sockets: WebSocket[] = [];
  const [dev, prod] = states;
  if (!dev || !prod) throw new Error('Missing fixture');
  const headers = (port: number, key: string) => ({
    host: `127.0.0.1:${String(port)}`,
    origin: `http://127.0.0.1:${String(port)}`,
    authorization: `Bearer ${key}`,
  });
  const connect = async (port: number, channel: ReleaseChannel) => {
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/extension`, {
      origin: `chrome-extension://${extensionId(channel)}`,
    });
    sockets.push(socket);
    await once(socket, 'open');
    return socket;
  };
  try {
    await Promise.all(
      states.map(({ app, port }) => app.listen({ host: '127.0.0.1', port })),
    );
    await expect(connect(prod.port, 'dev')).rejects.toThrow();
    const devSocket = await connect(dev.port, 'dev');
    let incoming = next(devSocket);
    devSocket.send(
      JSON.stringify({
        v: 1,
        type: 'pair',
        channel: 'dev',
        name: 'Dev Chrome',
        profileId: 'same-profile',
      }),
    );
    const pending = await incoming;
    expect(pending.channel).toBe('dev');
    incoming = next(devSocket);
    await dev.app.inject({
      method: 'POST',
      url: `/api/pairings/${String(pending.requestId)}/approve`,
      headers: headers(dev.port, dev.key),
    });
    const credential = await incoming;
    expect(credential.type).toBe('paired');
    const prodSocket = await connect(prod.port, 'prod');
    incoming = next(prodSocket);
    prodSocket.send(
      JSON.stringify({
        v: 1,
        type: 'authenticate',
        channel: 'prod',
        browserId: credential.browserId,
        token: credential.token,
      }),
    );
    expect((await incoming).code).toBe('unauthorized');
    const mismatched = await connect(prod.port, 'prod');
    incoming = next(mismatched);
    mismatched.send(
      JSON.stringify({
        v: 1,
        type: 'pair',
        channel: 'dev',
        name: 'wrong',
        profileId: 'same-profile',
      }),
    );
    expect((await incoming).code).toBe('channel-mismatch');
    expect(
      (
        await prod.app.inject({
          url: '/api/browsers',
          headers: headers(prod.port, dev.key),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await prod.app.inject({
          url: '/api/browsers',
          headers: headers(prod.port, prod.key),
        })
      ).json(),
    ).toEqual({ browsers: [] });
    await dev.app.close();
    expect(
      (
        await prod.app.inject({
          url: '/api/status',
          headers: headers(prod.port, prod.key),
        })
      ).statusCode,
    ).toBe(200);
  } finally {
    sockets.forEach((socket) => {
      socket.terminate();
    });
    await Promise.all(states.map(({ app }) => app.close()));
    await rm(root, { recursive: true, force: true });
  }
});
