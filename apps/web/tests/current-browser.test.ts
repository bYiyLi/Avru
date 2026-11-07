import { afterEach, expect, it, vi } from 'vitest';
import {
  connectCurrent,
  detectCurrent,
  extensionMessaging,
} from '../src/current-browser';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('classifies only current browser extension replies, never absent as uninstalled', async () => {
  const send = vi.fn();
  for (const value of [null, {}, { version: 2 }, { version: 'x'.repeat(65) }]) {
    send.mockResolvedValueOnce(value);
    expect(await detectCurrent('id', send)).toEqual({ status: 'unavailable' });
  }
  send.mockRejectedValueOnce(new Error());
  expect(await detectCurrent('id', send)).toEqual({ status: 'unavailable' });
  send.mockResolvedValueOnce({ version: '1', autoAllowed: true });
  expect(await detectCurrent('id', send)).toEqual({
    status: 'detected',
    version: '1',
  });
  send.mockResolvedValueOnce({
    version: '1',
    status: 'rejected',
    autoAllowed: false,
  });
  expect(await detectCurrent('id', send)).toEqual({
    status: 'blocked',
    version: '1',
  });
  send.mockResolvedValueOnce({
    version: '1',
    status: 'connected',
    browserId: 'b',
  });
  expect(await detectCurrent('id', send)).toEqual({
    status: 'connected',
    version: '1',
    browserId: 'b',
  });
});
it('passes only one-time challenge/ticket, not the management key, to current extension', async () => {
  const challenge = 'a'.repeat(64),
    ticket = 'b'.repeat(64);
  const send = vi
    .fn()
    .mockResolvedValueOnce({ challenge })
    .mockResolvedValueOnce({ accepted: true });
  const issue = vi.fn().mockResolvedValue({ ticket });
  await connectCurrent('id', send, issue);
  expect(issue).toHaveBeenCalledWith(challenge);
  expect(send).toHaveBeenLastCalledWith('id', {
    type: 'avru-redeem',
    challenge,
    ticket,
  });
  for (const invalid of [{}, { challenge: 'wrong' }])
    await expect(
      connectCurrent('id', vi.fn().mockResolvedValue(invalid), issue),
    ).rejects.toThrow('challenge');
  await expect(
    connectCurrent(
      'id',
      vi.fn().mockResolvedValue({ challenge }),
      vi.fn().mockResolvedValue({}),
    ),
  ).rejects.toThrow('ticket');
  await expect(
    connectCurrent('id', vi.fn().mockResolvedValue({ challenge }), issue),
  ).rejects.toThrow('unavailable');
});
it('wraps callback runtime, lastError, absence, throw and timeout without exposing errors', async () => {
  await expect(extensionMessaging()('id', {})).rejects.toThrow('Unavailable');
  const runtime: { sendMessage?: unknown; lastError?: unknown } = {};
  vi.stubGlobal('chrome', { runtime });
  runtime.sendMessage = (
    _id: string,
    _message: unknown,
    reply: (value: unknown) => void,
  ) => {
    reply({ version: '1' });
  };
  await expect(extensionMessaging()('id', {})).resolves.toEqual({
    version: '1',
  });
  runtime.lastError = { message: 'private' };
  await expect(extensionMessaging()('id', {})).rejects.toThrow('Unavailable');
  runtime.sendMessage = () => {
    throw new Error('failed');
  };
  await expect(extensionMessaging()('id', {})).rejects.toThrow('failed');
  vi.useFakeTimers();
  runtime.sendMessage = () => {};
  const promise = extensionMessaging()('id', {});
  const rejected = expect(promise).rejects.toThrow('Unavailable');
  await vi.advanceTimersByTimeAsync(2000);
  await rejected;
});
it('allows the probe response beyond detection timeout without retransmitting', async () => {
  vi.useFakeTimers();
  const runtime = {
    sendMessage: vi.fn(
      (_id: string, _message: unknown, reply: (value: unknown) => void) => {
        setTimeout(() => {
          reply({ challenge: 'a'.repeat(64) });
        }, 5000);
      },
    ),
  };
  vi.stubGlobal('chrome', { runtime });
  const pending = extensionMessaging()('id', { type: 'avru-probe' });
  await vi.advanceTimersByTimeAsync(5000);
  await expect(pending).resolves.toEqual({ challenge: 'a'.repeat(64) });
  expect(runtime.sendMessage).toHaveBeenCalledOnce();
});
it('discovers runtime added after the management page was opened', async () => {
  const send = extensionMessaging();
  await expect(send('id', {})).rejects.toThrow('Unavailable');
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: (
        _id: string,
        _message: unknown,
        respond: (reply: unknown) => void,
      ) => {
        respond({ version: '1' });
      },
    },
  });
  await expect(send('id', {})).resolves.toEqual({ version: '1' });
});
