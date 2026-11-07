import { vi } from 'vitest';
import { Connection } from '../utils/connection';
import type { Ports, Socket } from '../utils/connection';
export const saved = {
  endpoint: 'http://127.0.0.1:43821',
  profileId: 'profile',
  name: 'Work',
  browserId: 'browser',
  token: 'secret',
};
export function setup(initial?: unknown, channel?: 'dev' | 'prod') {
  const sockets: Socket[] = [];
  const ports: Ports = {
    ...(channel ? { channel } : {}),
    read: vi.fn().mockResolvedValue(initial),
    save: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    tabs: vi
      .fn()
      .mockResolvedValue([{ id: 1, url: 'https://example.com/?secret=1' }]),
    uuid: () => 'profile',
    socket: () => {
      const socket: Socket = {
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        send: vi.fn(),
        close: vi.fn(),
      };
      sockets.push(socket);
      return socket;
    },
    later: (cb, delay) => setTimeout(cb, delay),
    cancel: (timer) => {
      clearTimeout(timer);
    },
  };
  const connection = new Connection(ports);
  const current = () => {
    const value = sockets.at(-1);
    if (!value) throw new Error('missing socket');
    return value;
  };
  const receive = async (message: unknown) => {
    current().onmessage?.(
      new MessageEvent('message', { data: JSON.stringify(message) }),
    );
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return { connection, ports, sockets, current, receive };
}
