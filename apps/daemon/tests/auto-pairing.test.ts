import { afterEach, expect, it, vi } from 'vitest';
import { Connections } from '../src/connections.js';
import { BrowserStore } from '../src/store.js';
import { AutoPairing } from '../src/auto-pairing.js';
const stores: BrowserStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
function setup() {
  let now = 100;
  const store = new BrowserStore(':memory:');
  stores.push(store);
  const hub = new Connections(store, () => now, undefined, 'dev');
  const peer = () => {
    const messages: Record<string, unknown>[] = [];
    const close = vi.fn();
    const socket = hub.attach(
      {
        close,
        send: (raw) => {
          messages.push(JSON.parse(raw) as Record<string, unknown>);
        },
      },
      'chrome-extension://example',
    );
    return {
      ...socket,
      close,
      messages,
      send: (value: object) => {
        socket.receive(JSON.stringify({ v: 1, ...value }));
      },
    };
  };
  const probe = () => {
    const socket = peer();
    socket.send({
      type: 'auto-probe',
      channel: 'dev',
      profileId: 'profile',
      name: 'Chrome',
    });
    return { ...socket, challenge: String(socket.messages[0]?.challenge) };
  };
  return {
    hub,
    store,
    peer,
    probe,
    advance: () => {
      now += 30_000;
    },
  };
}
it('issues credentials only to the original live socket after one-use redemption', () => {
  const { hub, probe, peer } = setup();
  const original = probe();
  expect(original.challenge).toMatch(/^[a-f0-9]{64}$/);
  expect(hub.pairings()).toEqual([]);
  expect(hub.browsers()).toEqual([]);
  const first = required(hub.issueConnectionTicket(original.challenge));
  const ticket = required(hub.issueConnectionTicket(original.challenge));
  expect(ticket.ticket).not.toBe(first.ticket);
  const other = probe();
  other.send({ type: 'auto-redeem', ticket: ticket.ticket });
  expect(other.messages.at(-1)?.code).toBe('unauthorized');
  expect(hub.browsers()).toEqual([]);
  original.send({ type: 'auto-redeem', ticket: ticket.ticket });
  expect(original.messages.map((m) => m.type)).toEqual([
    'auto-challenge',
    'paired',
    'ready',
  ]);
  expect(hub.browsers()).toHaveLength(1);
  expect(hub.issueConnectionTicket(original.challenge)).toBeUndefined();
  const replay = peer();
  replay.send({ type: 'auto-redeem', ticket: ticket.ticket });
  expect(replay.messages.at(-1)?.code).toBe('unauthorized');
});
it('fails expired, disconnected, unissued and replaced tickets closed', () => {
  const { hub, probe, advance } = setup();
  const noTicket = probe();
  noTicket.send({ type: 'auto-redeem', ticket: 'a'.repeat(64) });
  expect(noTicket.close).toHaveBeenCalled();
  const replaced = probe();
  const old = required(hub.issueConnectionTicket(replaced.challenge));
  hub.issueConnectionTicket(replaced.challenge);
  replaced.send({ type: 'auto-redeem', ticket: old.ticket });
  expect(replaced.close).toHaveBeenCalled();
  const gone = probe();
  gone.disconnect();
  expect(hub.issueConnectionTicket(gone.challenge)).toBeUndefined();
  const expired = probe();
  const ticket = required(hub.issueConnectionTicket(expired.challenge));
  advance();
  expired.send({ type: 'auto-redeem', ticket: ticket.ticket });
  expect(expired.messages.at(-1)?.code).toBe('timeout');
  expect(hub.issueConnectionTicket(expired.challenge)).toBeUndefined();
  expect(hub.browsers()).toEqual([]);
});
it('rejects wrong-channel and non-redemption frames while awaiting authorization', () => {
  const { hub, probe, peer } = setup();
  const foreign = peer();
  foreign.send({
    type: 'auto-probe',
    channel: 'prod',
    name: 'Chrome',
    profileId: 'p',
  });
  expect(foreign.messages.at(-1)?.code).toBe('channel-mismatch');
  const pending = probe();
  pending.send({ type: 'tabs', tabs: [] });
  expect(pending.messages.at(-1)?.code).toBe('unauthorized');
  expect(hub.issueConnectionTicket(pending.challenge)).toBeUndefined();
  const manual = peer();
  manual.send({ type: 'pair', channel: 'dev', name: 'Chrome', profileId: 'p' });
  manual.send({
    type: 'auto-probe',
    channel: 'dev',
    name: 'Chrome',
    profileId: 'p',
  });
  expect(manual.messages.at(-1)?.code).toBe('pending');
});
it('bounds automatic and manual pending requests together and retained browsers', () => {
  const { hub, store, probe } = setup();
  for (let i = 0; i < 20; i++) probe();
  const overflow = probe();
  expect(overflow.messages.at(-1)?.code).toBe('busy');
  hub.close();
  for (let i = 0; i < 64; i++)
    store.add(
      { name: 'test', profileId: String(i), origin: 'origin' },
      'token',
    );
  expect(probe().messages.at(-1)?.code).toBe('busy');
});
it('direct ticket state expires without an external sweep and cannot redeem absent entries', () => {
  let now = 0;
  const automatic = new AutoPairing<object>(() => now);
  const session = {};
  const identity = { name: 'Chrome', profileId: 'p' };
  const challenge = automatic.probe(session, identity);
  const issued = required(automatic.issue(challenge.challenge));
  now = 30_000;
  expect(automatic.issue(challenge.challenge)).toBeUndefined();
  expect(automatic.redeem(session, issued.ticket)).toBeUndefined();
  expect(automatic.redeem({}, issued.ticket)).toBeUndefined();
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing issued ticket');
  return value;
}
