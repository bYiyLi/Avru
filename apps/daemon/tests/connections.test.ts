import { afterEach, describe, expect, it, vi } from 'vitest';
import { Connections } from '../src/connections.js';
import { BrowserStore } from '../src/store.js';
import { record } from '../src/messages.js';
const origin = `chrome-extension://${'a'.repeat(32)}`;
const stores: BrowserStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
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
describe('authenticated browser lifecycle', () => {
  it('binds pairing to the original socket, hides credentials and clears stale tabs', () => {
    const { hub } = setup();
    const { peer, id, token } = pair(hub);
    expect(peer.messages.map((m) => m.type)).toEqual([
      'pairing',
      'paired',
      'ready',
    ]);
    expect(hub.pairings()).toEqual([]);
    peer.send({
      type: 'tabs',
      tabs: [
        { id: 3, title: 'Example', url: 'https://example.com/?secret#hash' },
      ],
    });
    peer.send({ type: 'ping' });
    expect(peer.messages.at(-1)?.type).toBe('pong');
    expect(hub.browsers()[0]?.tabs).toEqual([
      { id: 3, title: 'Example', url: 'https://example.com/' },
    ]);
    expect(JSON.stringify(hub.browsers())).not.toContain(token);
    peer.disconnect();
    expect(hub.browsers()[0]).toMatchObject({
      connected: false,
      connectionId: null,
      tabs: [],
    });
    const reconnect = client(hub);
    reconnect.send({ type: 'authenticate', browserId: id, token });
    expect(reconnect.messages.at(-1)?.type).toBe('ready');
    expect(hub.browsers()[0]?.connected).toBe(true);
    const replacement = client(hub);
    replacement.send({ type: 'authenticate', browserId: id, token });
    expect(reconnect.close).toHaveBeenCalled();
    reconnect.disconnect();
    reconnect.send({
      type: 'tabs',
      tabs: [{ id: 4, title: 'stale', url: 'https://stale.test' }],
    });
    expect(hub.browsers()[0]?.tabs).toEqual([]);
    expect(hub.browsers()[0]?.connected).toBe(true);
    expect(hub.revoke(id)).toBe(true);
    expect(replacement.messages.at(-1)?.code).toBe('revoked');
    expect(hub.revoke(id)).toBe(false);
    expect(hub.browsers()).toEqual([]);
  });
  it('supports separate profiles and rejects origin/token confusion', () => {
    const { hub } = setup();
    const first = pair(hub);
    const second = pair(hub);
    expect(hub.browsers()).toHaveLength(2);
    expect(first.id).not.toBe(second.id);
    for (const options of [
      { origin: `${origin}b`, token: first.token },
      { origin, token: 'c'.repeat(64) },
    ]) {
      const intruder = client(hub, options.origin);
      intruder.send({
        type: 'authenticate',
        browserId: first.id,
        token: options.token,
      });
      expect(intruder.messages.at(-1)?.code).toBe('unauthorized');
    }
    first.peer.send({ type: 'pair', name: 'invalid', profileId: 'wrong' });
    expect(first.peer.close).toHaveBeenCalled();
    expect(
      hub.browsers().find((item) => item.id === second.id)?.connected,
    ).toBe(true);
    hub.close();
    expect(second.peer.close).toHaveBeenCalled();
  });
  it('expires idle, pending and active connections without renewal races', () => {
    const { hub, advance } = setup();
    const idle = client(hub);
    advance(5000);
    idle.send({ type: 'ping' });
    expect(idle.messages.at(-1)?.code).toBe('timeout');
    const pending = client(hub);
    pending.send({ type: 'pair', name: 'Chrome', profileId: 'p' });
    const request = hub.pairings()[0];
    expect(request?.code).toMatch(/^\d{6}$/);
    advance(120000);
    expect(hub.approve(request?.id ?? '')).toBe(false);
    expect(pending.messages.at(-1)?.code).toBe('timeout');
    const { peer } = pair(hub);
    advance(60000);
    hub.sweep();
    expect(peer.close).toHaveBeenCalled();
  });
});
describe('connection abuse limits', () => {
  it('does not activate a ghost session after credential delivery fails', () => {
    const { hub } = setup();
    let broken = false;
    const peer = hub.attach(
      {
        send: () => {
          if (broken) throw new Error('socket gone');
        },
        close: vi.fn(),
      },
      origin,
    );
    peer.receive(
      JSON.stringify({ v: 1, type: 'pair', name: 'Chrome', profileId: 'p' }),
    );
    broken = true;
    expect(hub.approve(hub.pairings()[0]?.id ?? '')).toBe(false);
    expect(hub.browsers()).toEqual([]);
  });
  it('rejects invalid/pending frames and removes abandoned pairing requests', () => {
    const { hub } = setup();
    const invalid = client(hub);
    invalid.receive('broken');
    expect(invalid.messages.at(-1)?.code).toBe('invalid');
    const unauthenticated = client(hub);
    unauthenticated.send({ type: 'tabs', tabs: [] });
    expect(unauthenticated.messages.at(-1)?.code).toBe('unauthorized');
    const waiting = client(hub);
    waiting.send({ type: 'pair', name: 'test', profileId: 'p' });
    waiting.send({ type: 'ping' });
    expect(waiting.messages.at(-1)?.code).toBe('pending');
    expect(hub.pairings()).toEqual([]);
    const rejected = client(hub);
    rejected.send({ type: 'pair', name: 'test', profileId: 'p' });
    expect(hub.reject(hub.pairings()[0]?.id ?? '')).toBe(true);
    expect(rejected.messages.at(-1)?.code).toBe('rejected');
    expect(hub.reject('unknown')).toBe(false);
    const gone = client(hub);
    gone.send({ type: 'pair', name: 'test', profileId: 'p' });
    gone.disconnect();
    expect(hub.pairings()).toEqual([]);
    const throwing = hub.attach(
      {
        send: () => {
          throw new Error('closed');
        },
        close: vi.fn(),
      },
      origin,
    );
    throwing.receive('invalid');
  });
  it('limits pending sockets and retained identities', () => {
    const { hub, store } = setup();
    for (let i = 0; i < 20; i++)
      client(hub).send({ type: 'pair', profileId: String(i), name: 'test' });
    const overflow = client(hub);
    overflow.send({ type: 'pair', profileId: 'overflow', name: 'test' });
    expect(overflow.messages.at(-1)?.code).toBe('busy');
    hub.close();
    for (let i = 0; i < 64; i++)
      store.add({ origin, profileId: String(i), name: 'test' }, String(i));
    const full = client(hub);
    full.send({ type: 'pair', profileId: 'overflow', name: 'test' });
    expect(full.messages.at(-1)?.code).toBe('busy');
    for (let i = 0; i < 84; i++) client(hub);
    const excessive = client(hub);
    expect(excessive.close).toHaveBeenCalled();
    hub.close();
  });
});

it('accepts bounded metadata only after authentication and clears it on disconnect', () => {
  const { hub } = setup();
  const metadata = {
    browserName: 'Chrome',
    browserVersion: '140.0.0.0',
    versionSource: 'userAgent',
    extensionVersion: '0.0.1',
  };
  const unauthenticated = client(hub);
  unauthenticated.send({ type: 'metadata', metadata });
  expect(unauthenticated.messages.at(-1)?.code).toBe('unauthorized');
  const { peer } = pair(hub);
  expect(peer.messages.at(-1)?.metadataSupported).toBe(true);
  expect(hub.browsers()[0]?.metadata).toBeNull();
  peer.send({ type: 'metadata', metadata });
  expect(hub.browsers()[0]?.metadata).toEqual(metadata);
  peer.disconnect();
  expect(hub.browsers()[0]?.metadata).toBeNull();
});
