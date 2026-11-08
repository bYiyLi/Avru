import { afterEach, expect, it, vi } from 'vitest';
import { setup, saved } from './connection-fixture';
afterEach(() => vi.useRealTimers());
it('connects on load without a page or pairing and retries before registration', async () => {
  vi.useFakeTimers();
  const h = setup(undefined, 'dev');
  h.ports.local = true;
  await h.connection.start();
  expect(h.ports.save).toHaveBeenCalledWith(
    expect.objectContaining({ profileId: 'profile', channel: 'dev' }),
  );
  h.current().onopen?.(new Event('open'));
  expect(
    JSON.parse(String(vi.mocked(h.current().send).mock.calls[0]?.[0])),
  ).toMatchObject({
    type: 'local-connect',
    channel: 'dev',
    profileId: 'profile',
  });
  h.current().onclose?.(new Event('close') as CloseEvent);
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.sockets).toHaveLength(2);
  await h.receive({ v: 1, type: 'error', code: 'busy' });
  await vi.advanceTimersByTimeAsync(2000);
  expect(h.sockets).toHaveLength(3);
  await h.receive({
    v: 1,
    type: 'paired',
    channel: 'dev',
    browserId: 'browser',
    token: 'token',
  });
  await h.receive({
    v: 1,
    type: 'ready',
    channel: 'dev',
    browserId: 'browser',
    connectionId: 'connection',
  });
  expect(h.connection.status()).toEqual({ code: 'connected' });
  await h.connection.disconnect();
});
it('preserves existing identity during upgrade and never accepts another environment', async () => {
  const h = setup({ ...saved, channel: 'prod' }, 'prod');
  h.ports.local = true;
  await h.connection.start();
  h.current().onopen?.(new Event('open'));
  expect(h.current().send).toHaveBeenCalledWith(
    expect.stringContaining('"profileId":"profile"'),
  );
  expect(h.ports.save).toHaveBeenCalledWith(
    expect.objectContaining({
      endpoint: 'http://127.0.0.1:43821',
      name: 'Work',
      browserId: saved.browserId,
      token: saved.token,
    }),
  );
  await h.connection.disconnect();
  const wrong = setup({ ...saved, channel: 'prod' }, 'dev');
  wrong.ports.local = true;
  await expect(wrong.connection.start()).rejects.toThrow('another channel');
  expect(wrong.sockets).toHaveLength(0);
  const absent = setup();
  absent.ports.local = true;
  await expect(absent.connection.start()).rejects.toThrow('compiled channel');
});
it('does not connect after a pending identity read or save is superseded', async () => {
  const h = setup(undefined, 'dev');
  h.ports.local = true;
  let done: (value: unknown) => void = () => {};
  vi.mocked(h.ports.read).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  );
  const started = h.connection.start();
  await h.connection.disconnect();
  done(null);
  await started;
  expect(h.sockets).toHaveLength(0);
  const next = setup({ profileId: '', name: '' }, 'dev');
  next.ports.local = true;
  let savedDone: () => void = () => {};
  vi.mocked(next.ports.save).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        savedDone = resolve;
      }),
  );
  const pending = next.connection.start();
  await Promise.resolve();
  await Promise.resolve();
  const stopped = next.connection.disconnect();
  savedDone();
  await pending;
  await stopped;
  expect(next.sockets).toHaveLength(0);
});
