import type { BrowserActionAPI } from '../utils/browser-ports';
import { describe, expect, it, vi } from 'vitest';
import { ActionChannel } from '../utils/action-channel';
import { dispatchBrowserAction } from '../utils/browser-actions';
import type { CdpController } from '../utils/cdp';

function fixture() {
  const send = vi.fn(() => Promise.resolve({ result: 'ok' }));
  const events = vi.fn(() => Promise.resolve({ events: [], nextCursor: '1' }));
  const cursor = vi.fn(() => Promise.resolve('1'));
  const cdp: Pick<CdpController, 'send' | 'events' | 'cursor'> = {
    send,
    events,
    cursor,
  };
  const api: BrowserActionAPI = {
    tabs: {
      get: () =>
        Promise.resolve({ title: 'Example', url: 'https://example.test/' }),
    },
    scripting: {
      executeScript: () => Promise.resolve([]),
    },
  };
  const responses: unknown[] = [];
  const channel = new ActionChannel({
    tabs: () => Promise.resolve([]),
    action: (tabId, method, args) =>
      dispatchBrowserAction(api, cdp, { tabId, method, args }),
    send: (value) => {
      responses.push(value);
    },
    isReady: () => true,
    isCurrentGeneration: () => true,
  });
  return { channel, responses, send, events, cursor };
}
describe('CDP actions over the extension action protocol', () => {
  it('passes arbitrary protocol methods and arguments through without a whitelist', async () => {
    const h = fixture();
    await h.channel.receiveMessage(
      {
        type: 'action',
        requestId: 'request-1',
        tabId: 2,
        generation: 1,
        method: 'cdp.send',
        args: ['Storage.getCookies', { browserContextId: 'session' }],
      },
      1,
    );
    expect(h.send).toHaveBeenCalledWith(2, 'Storage.getCookies', {
      browserContextId: 'session',
    });
    expect(h.responses).toEqual([
      {
        v: 1,
        type: 'action_result',
        requestId: 'request-1',
        ok: true,
        value: { result: 'ok' },
      },
    ]);
  });
  it('forwards event reads and cursor requests for an attached tab', async () => {
    const h = fixture();
    await h.channel.receiveMessage(
      {
        type: 'action',
        requestId: 'request-2',
        tabId: 2,
        generation: 1,
        method: 'cdp.events',
        args: ['0'],
      },
      1,
    );
    expect(h.events).toHaveBeenCalledWith(2, '0');
    await h.channel.receiveMessage(
      {
        type: 'action',
        requestId: 'request-3',
        tabId: 2,
        generation: 1,
        method: 'cdp.cursor',
        args: [],
      },
      1,
    );
    expect(h.cursor).toHaveBeenCalledWith(2);
  });
  it('rejects malformed CDP parameters without invoking browser debugger', async () => {
    const h = fixture();
    await h.channel.receiveMessage(
      {
        type: 'action',
        requestId: 'request-4',
        tabId: 2,
        generation: 1,
        method: 'cdp.send',
        args: ['Runtime.evaluate', ['not-an-object']],
      },
      1,
    );
    expect(h.send).not.toHaveBeenCalled();
    expect(h.responses).toEqual([
      {
        v: 1,
        type: 'action_result',
        requestId: 'request-4',
        ok: false,
        error: { code: 'INVALID_ARGUMENT', message: 'Action failed' },
      },
    ]);
  });
});
