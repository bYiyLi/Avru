import { expect, vi } from 'vitest';
import { Connections } from '../src/connections.js';
import { record } from '../src/messages.js';
import { BrowserStore } from '../src/store.js';
export const origin = `chrome-extension://${'a'.repeat(32)}`;
const stores: BrowserStore[] = [];
export function closeStores(): void {
  for (const store of stores.splice(0)) store.close();
}
function setup() {
  const store = new BrowserStore(':memory:');
  stores.push(store);
  let time = 1000;
  const hub = new Connections(store, () => time);
  return {
    hub,
    store,
    advance: (milliseconds: number) => {
      time += milliseconds;
    },
  };
}
function client(hub: Connections, source = origin) {
  const messages: Record<string, unknown>[] = [];
  const close = vi.fn();
  const peer = hub.attach(
    {
      close,
      send: (raw) => {
        const value: unknown = JSON.parse(raw);
        if (!record(value)) throw new Error('Bad response');
        messages.push(value);
      },
    },
    source,
  );
  return {
    ...peer,
    close,
    messages,
    send: (message: object) => {
      peer.receive(JSON.stringify({ v: 1, ...message }));
    },
  };
}
function pair(hub: Connections) {
  const peer = client(hub);
  peer.send({ type: 'pair', name: 'Chrome', profileId: 'profile' });
  const pending = hub.pairings()[0];
  if (!pending) throw new Error('Missing pairing');
  expect(hub.approve(pending.id)).toBe(true);
  const issued = peer.messages.find((message) => message.type === 'paired');
  if (typeof issued?.browserId !== 'string' || typeof issued.token !== 'string')
    throw new Error('Missing credential');
  return { peer, id: issued.browserId, token: issued.token };
}
export { client, pair, setup };
