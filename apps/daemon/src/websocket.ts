import { extensionId } from '../../../packages/protocol/environment.js';
import type { ReleaseChannel } from '../../../packages/protocol/environment.js';
import { WebSocketServer } from 'ws';
import type { RawData } from 'ws';
import type { Server } from 'node:http';
import type { Connections } from './connections.js';

export function decodeFrame(data: RawData): string {
  const bytes = Array.isArray(data) ? Buffer.concat(data) : data;
  const buffer = bytes instanceof ArrayBuffer ? Buffer.from(bytes) : bytes;
  return buffer.toString('utf8');
}

export function connectWebSockets(
  server: Server,
  connections: Connections,
  port: number,
  channel?: ReleaseChannel,
): () => void {
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 8_388_608,
    perMessageDeflate: false,
  });
  server.on('upgrade', (request, socket, head) => {
    const origin = request.headers.origin;
    if (
      sockets.clients.size >= 84 ||
      request.url !== '/extension' ||
      request.headers.host !== `127.0.0.1:${String(port)}` ||
      !origin ||
      !/^chrome-extension:\/\/[a-p]{32}$/.test(origin) ||
      (channel !== undefined &&
        origin !== `chrome-extension://${extensionId(channel)}`)
    ) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      const session = connections.attach(
        {
          send: (data) => {
            ws.send(data);
          },
          close: () => {
            ws.close(1008);
            setTimeout(() => {
              ws.terminate();
            }, 500).unref();
          },
        },
        origin,
      );
      ws.on('message', (data, binary) => {
        session.receive(binary ? '' : decodeFrame(data));
      });
      ws.on('close', session.disconnect);
      ws.on('error', session.disconnect);
    });
  });
  return () => {
    for (const socket of sockets.clients) socket.terminate();
    sockets.close();
  };
}
