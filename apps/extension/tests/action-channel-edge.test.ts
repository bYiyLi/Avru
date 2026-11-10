import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionChannel, type ActionPorts } from '../utils/action-channel';
import { MAX_REASSEMBLED_ACTION_BYTES } from '../utils/protocol';

const action = {
  type: 'action',
  v: 1,
  requestId: 'request-1',
  tabId: 5,
  generation: 1,
  method: 'tab.title',
  args: [],
};

function fixture() {
  const sent: unknown[] = [];
  let current = true;
  const ports: ActionPorts = {
    tabs: () => Promise.resolve([]),
    action: () => Promise.resolve('Title'),
    send: (value) => {
      sent.push(value);
    },
    isReady: () => true,
    isCurrentGeneration: (generation) => generation === 1 && current,
  };
  const channel = new ActionChannel(ports);
  const setCurrent = (next: boolean) => {
    current = next;
  };
  return { channel, ports, sent, setCurrent };
}

function chunk(payload: string, requestId = 'request-1') {
  return {
    type: 'chunk',
    requestId,
    index: 0,
    total: 1,
    payload,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('extension action delivery boundaries', () => {
  it('ignores unrelated messages and stale-generation tab listings', async () => {
    const h = fixture();
    expect(await h.channel.receiveMessage({ type: 'heartbeat' }, 1)).toBe(
      false,
    );
    h.setCurrent(false);
    expect(
      await h.channel.receiveMessage(
        {
          ...action,
          method: 'browser.tabs.list',
        },
        1,
      ),
    ).toBe(true);
    expect(h.sent).toEqual([]);
  });

  it('returns a structured error when the browser action hook is absent', async () => {
    const h = fixture();
    delete h.ports.action;
    await h.channel.receiveMessage(action, 1);
    expect(h.sent).toEqual([
      {
        v: 1,
        type: 'action_result',
        requestId: 'request-1',
        ok: false,
        error: { code: 'CAPABILITY_NOT_ALLOWED', message: 'Action failed' },
      },
    ]);
  });

  it('omits undefined results and drops late host replies after reconnect', async () => {
    const h = fixture();
    h.ports.action = () => Promise.resolve(undefined);
    await h.channel.receiveMessage(action, 1);
    expect(h.sent).toEqual([
      { v: 1, type: 'action_result', requestId: 'request-1', ok: true },
    ]);
    h.sent.length = 0;
    let finish: ((value: unknown) => void) | undefined;
    h.ports.action = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const pending = h.channel.receiveMessage(action, 1);
    h.setCurrent(false);
    finish?.('Late result');
    await pending;
    expect(h.sent).toEqual([]);
  });

  it('sanitizes unexpected host errors and suppresses late failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = fixture();
    h.ports.action = () => Promise.reject(new Error('private source text'));
    await h.channel.receiveMessage(action, 1);
    expect(h.sent).toEqual([
      {
        v: 1,
        type: 'action_result',
        requestId: 'request-1',
        ok: false,
        error: { code: 'ACTION_FAILED', message: 'Action failed' },
      },
    ]);
    h.sent.length = 0;
    h.setCurrent(false);
    await h.channel.receiveMessage(action, 1);
    expect(h.sent).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('drops malformed, unexpected and nested chunk payloads without executing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = fixture();
    await h.channel.receiveMessage(chunk('{'), 1);
    await h.channel.receiveMessage(chunk('{"v":2,"type":"action"}'), 1);
    await h.channel.receiveMessage(chunk('{"v":1,"type":"ping"}'), 1);
    await h.channel.receiveMessage(
      chunk(
        JSON.stringify({
          v: 1,
          type: 'chunk',
          requestId: 'nested',
          index: 0,
          total: 1,
          payload: '{"v":1,"type":"ping"}',
        }),
      ),
      1,
    );
    expect(h.sent).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it('rejects oversized reassembled action payloads before JSON parsing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = fixture();
    await h.channel.receiveMessage(
      chunk('x'.repeat(MAX_REASSEMBLED_ACTION_BYTES + 1)),
      1,
    );
    expect(h.sent).toEqual([]);
    expect(warn).toHaveBeenCalledWith('Ignoring oversized action chunks');
  });
});
