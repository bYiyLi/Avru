import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionChannel, type SendActionInput } from '../src/actions';

type Session = { id: string };
const input: SendActionInput = {
  browserId: 'browser-a',
  tabId: 7,
  generation: 1,
  method: 'cdp.send',
  args: ['Page.reload', {}],
  timeoutMs: 2_000,
};

function setup(sendSuccess = true) {
  const session: Session = { id: 'current' };
  const sent: Record<string, unknown>[] = [];
  const send = vi.fn((_peer: Session, value: Record<string, unknown>) => {
    sent.push(value);
    return sendSuccess;
  });
  const channel = new ActionChannel<Session>(send);
  const submit = () => {
    const result = channel.sendAction(session, input);
    const id = sent.at(-1)?.requestId as string;
    return { id, result };
  };
  return { channel, session, sent, send, submit };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('daemon action transport edge cases', () => {
  it('fails without retrying when the WebSocket send itself fails', async () => {
    const h = setup(false);
    const pending = h.submit();
    await expect(pending.result).resolves.toEqual({
      ok: false,
      error: {
        code: 'EXTENSION_OFFLINE',
        message: 'Browser extension is offline',
      },
    });
    expect(h.send).toHaveBeenCalledOnce();
    expect(h.channel.size).toBe(0);
  });

  it('ignores a result from the wrong browser profile', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = setup();
    const pending = h.submit();
    const reply = {
      v: 1 as const,
      type: 'action_result' as const,
      requestId: pending.id,
      ok: true as const,
      value: 42,
    };
    h.channel.receiveResult('other-browser', reply);
    expect(h.channel.size).toBe(1);
    h.channel.receiveResult('browser-a', reply);
    await expect(pending.result).resolves.toEqual({ ok: true, value: 42 });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('rejects a direct result that arrives after partial chunks', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = setup();
    const pending = h.submit();
    h.channel.receiveChunk('browser-a', {
      v: 1,
      type: 'chunk',
      requestId: pending.id,
      index: 0,
      total: 2,
      payload: '{"v":1,',
    });
    h.channel.receiveResult('browser-a', {
      v: 1,
      type: 'action_result',
      requestId: pending.id,
      ok: true,
      value: 1,
    });
    expect(h.channel.size).toBe(1);
    h.channel.failForSession(h.session);
    await expect(pending.result).resolves.toMatchObject({
      ok: false,
      error: { code: 'EXTENSION_OFFLINE' },
    });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('fails malformed assembled JSON without accepting a partial result', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = setup();
    const pending = h.submit();
    h.channel.receiveChunk('browser-a', {
      v: 1,
      type: 'chunk',
      requestId: pending.id,
      index: 0,
      total: 1,
      payload: '{"bad json',
    });
    await expect(pending.result).resolves.toEqual({
      ok: false,
      error: {
        code: 'TIMEOUT',
        message: 'Action result chunks incomplete',
      },
    });
    expect(h.channel.size).toBe(0);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('rejects a valid JSON chunk for an unexpected message type', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = setup();
    const pending = h.submit();
    h.channel.receiveChunk('browser-a', {
      v: 1,
      type: 'chunk',
      requestId: pending.id,
      index: 0,
      total: 1,
      payload: '{"v":1,"type":"ping"}',
    });
    await expect(pending.result).resolves.toMatchObject({
      ok: false,
      error: { code: 'TIMEOUT' },
    });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('rejects an assembled result whose requestId does not match', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = setup();
    const pending = h.submit();
    h.channel.receiveChunk('browser-a', {
      v: 1,
      type: 'chunk',
      requestId: pending.id,
      index: 0,
      total: 1,
      payload: JSON.stringify({
        v: 1,
        type: 'action_result',
        requestId: 'another-request',
        ok: true,
        value: 9,
      }),
    });
    await expect(pending.result).resolves.toMatchObject({
      ok: false,
      error: { code: 'TIMEOUT' },
    });
  });

  it('rejects duplicate chunks and never replays a browser action', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = setup();
    const pending = h.submit();
    const chunk = {
      v: 1 as const,
      type: 'chunk' as const,
      requestId: pending.id,
      index: 0,
      total: 2,
      payload: 'a',
    };
    h.channel.receiveChunk('browser-a', chunk);
    h.channel.receiveChunk('browser-a', chunk);
    await expect(pending.result).resolves.toMatchObject({
      ok: false,
      error: { code: 'TIMEOUT' },
    });
    expect(h.send).toHaveBeenCalledOnce();
  });
});
