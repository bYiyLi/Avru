import { afterEach, expect, it, vi } from 'vitest';
import { Connection } from '../utils/connection';
import { saved, setup } from './connection-fixture';
afterEach(() => {
  vi.useRealTimers();
});
const autoEndpoint = 'http://127.0.0.1:43822';
const challenge = 'a'.repeat(64);
const ticket = 'b'.repeat(64);
async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
it('automatically connects through a same-channel challenge without exposing credentials in inspection', async () => {
  vi.useFakeTimers();
  const h = setup(undefined, 'dev');
  h.ports.readBlocked = vi.fn().mockResolvedValue(false);
  h.ports.saveBlocked = vi.fn().mockResolvedValue(undefined);
  await h.connection.start();
  expect(h.connection.inspect()).toEqual({
    status: 'unpaired',
    autoAllowed: true,
    browserId: undefined,
  });
  const pending = h.connection.probe({ endpoint: autoEndpoint, name: 'Dev' });
  await flush();
  h.current().onopen?.(new Event('open'));
  expect(h.current().send).toHaveBeenCalledWith(
    JSON.stringify({
      v: 1,
      type: 'auto-probe',
      channel: 'dev',
      profileId: 'profile',
      name: 'Dev',
    }),
  );
  expect(h.ports.tabs).not.toHaveBeenCalled();
  await h.receive({ v: 1, channel: 'dev', type: 'auto-challenge', challenge });
  await expect(pending).resolves.toBe(challenge);
  h.connection.redeem(ticket);
  expect(h.current().send).toHaveBeenCalledWith(
    JSON.stringify({ v: 1, type: 'auto-redeem', ticket }),
  );
  await h.receive({
    v: 1,
    channel: 'dev',
    type: 'paired',
    browserId: 'browser',
    token: 'secret',
  });
  expect(h.ports.save).toHaveBeenCalledWith({
    channel: 'dev',
    endpoint: autoEndpoint,
    profileId: 'profile',
    name: 'Dev',
    browserId: 'browser',
    token: 'secret',
  });
  await h.receive({
    v: 1,
    channel: 'dev',
    type: 'ready',
    browserId: 'browser',
    connectionId: 'connection',
  });
  expect(h.connection.inspect()).toEqual({
    status: 'connected',
    autoAllowed: false,
    browserId: 'browser',
  });
  expect(JSON.stringify(h.connection.inspect())).not.toContain('secret');
  expect(() => {
    h.connection.redeem(ticket);
  }).toThrow('Invalid ticket');
  await h.connection.disconnect();
});
it('refuses cross-channel challenge, invalid redemption and late challenge from an obsolete generation', async () => {
  vi.useFakeTimers();
  const h = setup(undefined, 'dev');
  expect(() => {
    h.connection.redeem(ticket);
  }).toThrow('Invalid ticket');
  const pending = h.connection.probe({ endpoint: autoEndpoint, name: 'Dev' });
  const rejected = expect(pending).rejects.toThrow(
    'Automatic connection unavailable',
  );
  await flush();
  expect(() => {
    h.connection.redeem('bad');
  }).toThrow('Invalid ticket');
  await h.receive({ v: 1, channel: 'prod', type: 'auto-challenge', challenge });
  await rejected;
  expect(h.connection.inspect().autoAllowed).toBe(false);
  expect(h.ports.save).not.toHaveBeenCalled();
  const fresh = setup();
  const first = fresh.connection.probe({
    endpoint: saved.endpoint,
    name: 'Work',
  });
  const cancelled = expect(first).rejects.toThrow(
    'Automatic connection unavailable',
  );
  await flush();
  const oldSocket = fresh.current();
  await fresh.connection.pair({ endpoint: saved.endpoint, name: 'Manual' });
  await cancelled;
  oldSocket.onmessage?.(
    new MessageEvent('message', {
      data: JSON.stringify({ v: 1, type: 'auto-challenge', challenge }),
    }),
  );
  await flush();
  expect(fresh.connection.status().code).toBe('connecting');
  expect(fresh.ports.save).not.toHaveBeenCalled();
  await fresh.connection.disconnect();
});
it.each(['revoked', 'unauthorized'])(
  'persists %s and refuses silent re-pair even after background restart',
  async (code) => {
    const h = setup(saved);
    let blocked = false;
    h.ports.readBlocked = () => Promise.resolve(blocked);
    h.ports.saveBlocked = vi.fn((value: boolean) => {
      blocked = value;
      return Promise.resolve();
    });
    await h.connection.start();
    await h.receive({ v: 1, type: 'error', code });
    expect(h.ports.saveBlocked).toHaveBeenCalledWith(true);
    expect(h.connection.inspect().autoAllowed).toBe(false);
    await expect(
      h.connection.probe({ endpoint: saved.endpoint, name: 'Work' }),
    ).rejects.toThrow('Automatic connection unavailable');
    vi.mocked(h.ports.read).mockResolvedValue(undefined);
    const restarted = new Connection(h.ports);
    await restarted.start();
    expect(restarted.inspect().autoAllowed).toBe(false);
    await expect(
      restarted.probe({ endpoint: saved.endpoint, name: 'Work' }),
    ).rejects.toThrow('Automatic connection unavailable');
    expect(h.sockets).toHaveLength(1);
    await restarted.pair({
      endpoint: saved.endpoint,
      name: 'Explicit user re-enable',
    });
    expect(h.ports.saveBlocked).toHaveBeenLastCalledWith(false);
    expect(h.sockets).toHaveLength(2);
    await restarted.disconnect();
  },
);
it('restores existing credentials rather than opening a fresh automatic pair', async () => {
  const h = setup(saved);
  await h.connection.start();
  expect(h.connection.inspect().autoAllowed).toBe(false);
  await expect(
    h.connection.probe({ endpoint: saved.endpoint, name: 'Work' }),
  ).rejects.toThrow('Automatic connection unavailable');
  expect(h.sockets).toHaveLength(1);
  h.current().onopen?.(new Event('open'));
  expect(h.current().send).toHaveBeenCalledWith(
    expect.stringContaining('authenticate'),
  );
  await h.connection.disconnect();
});
it('expires unanswered automatic probe and rejects concurrent superseded preparation', async () => {
  vi.useFakeTimers();
  const h = setup();
  const pending = h.connection.probe({
    endpoint: saved.endpoint,
    name: 'Work',
  });
  const rejected = expect(pending).rejects.toThrow(
    'Automatic connection unavailable',
  );
  await flush();
  await vi.advanceTimersByTimeAsync(8000);
  await rejected;
  expect(h.ports.save).not.toHaveBeenCalled();
  expect(h.connection.inspect().status).toBe('protocolError');
  expect(h.connection.inspect().autoAllowed).toBe(false);
  const fresh = setup();
  const one = fresh.connection.probe({
    endpoint: saved.endpoint,
    name: 'first',
  });
  const superseded = expect(one).rejects.toThrow('Connection superseded');
  const two = fresh.connection.probe({
    endpoint: saved.endpoint,
    name: 'second',
  });
  const cancelled = expect(two).rejects.toThrow(
    'Automatic connection unavailable',
  );
  await flush();
  await superseded;
  await fresh.connection.disconnect();
  await cancelled;
});
it('ignores a blocked-state read completing after an explicit disconnect', async () => {
  const h = setup(saved);
  let finish: ((value: boolean) => void) | undefined;
  h.ports.readBlocked = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const pending = h.connection.start();
  await flush();
  await h.connection.disconnect();
  finish?.(false);
  await pending;
  expect(h.connection.inspect().autoAllowed).toBe(false);
  expect(h.sockets).toHaveLength(0);
});
it('does not acknowledge ticket submission after a socket send failure', async () => {
  const h = setup();
  const pending = h.connection.probe({
    endpoint: saved.endpoint,
    name: 'Work',
  });
  await flush();
  await h.receive({ v: 1, type: 'auto-challenge', challenge: 'a'.repeat(64) });
  await pending;
  h.current().send = () => {
    throw new Error('closed');
  };
  expect(() => {
    h.connection.redeem('b'.repeat(64));
  }).toThrow('Connection unavailable');
  expect(h.connection.inspect().status).toBe('protocolError');
  expect(h.ports.save).not.toHaveBeenCalled();
});
