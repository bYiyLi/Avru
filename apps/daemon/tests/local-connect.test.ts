import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { record } from '../src/messages.js';
import { extensionId } from '../../../packages/protocol/environment.js';
import { unusedAdminPort } from '../src/transports/frpc-admin.js';

it('registers automatically, preserves identities on restart and isolates local browser profiles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'avru-local-registration-'));
  const port = await unusedAdminPort();
  const options = {
    channel: 'dev' as const,
    port,
    databasePath: join(root, 'data.sqlite'),
  };
  let app = buildApp(options);
  const sockets: WebSocket[] = [];
  const connect = async (profileId: string, channel = 'dev') => {
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/extension`, {
      origin: `chrome-extension://${extensionId('dev')}`,
    });
    sockets.push(socket);
    const frames: Record<string, unknown>[] = [];
    socket.on('message', (bytes: Buffer) => {
      const value: unknown = JSON.parse(bytes.toString());
      if (record(value)) frames.push(value);
    });
    await once(socket, 'open');
    socket.send(
      JSON.stringify({
        v: 1,
        type: 'local-connect',
        channel,
        profileId,
        name: profileId,
      }),
    );
    await expect.poll(() => frames.length).toBeGreaterThan(0);
    return { socket, frames };
  };
  try {
    await app.listen({ host: '127.0.0.1', port });
    const first = await connect('chrome');
    await expect.poll(() => first.frames.length).toBe(2);
    expect(first.frames.map((frame) => frame.type)).toEqual([
      'paired',
      'ready',
    ]);
    const browserId = first.frames[0]?.browserId;
    await connect('edge');
    const wrong = await connect('wrong', 'prod');
    expect(wrong.frames[0]?.code).toBe('channel-mismatch');
    const headers = { host: `127.0.0.1:${String(port)}` };
    const state = await app.inject({ url: '/api/browsers', headers });
    expect(state.json<{ browsers: unknown[] }>().browsers).toHaveLength(2);
    expect(
      (await app.inject({ url: '/api/pairings', headers })).json(),
    ).toEqual({ pairings: [] });
    expect(
      (
        await app.inject({
          url: '/api/status',
          headers: { ...headers, 'sec-fetch-site': 'cross-site' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/connection/import',
          headers: { ...headers, origin: 'https://evil.example' },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    await app.close();
    app = buildApp(options);
    await app.listen({ host: '127.0.0.1', port });
    const restored = await connect('chrome');
    expect(restored.frames[0]?.browserId).toBe(browserId);
    expect(
      (await app.inject({ url: '/api/browsers', headers })).json<{
        browsers: unknown[];
      }>().browsers,
    ).toHaveLength(2);
  } finally {
    for (const socket of sockets) socket.terminate();
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
