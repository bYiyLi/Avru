import { afterEach, describe, expect, it } from 'vitest';
import { frameMessage } from '../src/actions.js';
import { client, closeStores, pair, setup } from './connection-helpers.js';
afterEach(() => {
  closeStores();
});

describe('sendAction delivery', () => {
  it('delivers an action and resolves with the extension result', async () => {
    const { hub } = setup();
    const { peer, id } = pair(hub);
    expect(hub.generation(id)).toBe(1);
    peer.send({
      type: 'tabs',
      tabs: [{ id: 3, title: 'Example', url: 'https://example.com/' }],
    });
    const pending = hub.sendAction({
      browserId: id,
      tabId: 3,
      generation: 1,
      method: 'browser.tabs.list',
      args: [],
    });
    const sent = peer.messages.find((message) => message.type === 'action');
    expect(sent).toMatchObject({
      v: 1,
      type: 'action',
      tabId: 3,
      generation: 1,
      method: 'browser.tabs.list',
      args: [],
    });
    expect(typeof sent?.requestId).toBe('string');
    peer.send({
      type: 'action_result',
      requestId: sent?.requestId,
      ok: true,
      value: [{ id: 3, title: 'Example', url: 'https://example.com/' }],
    });
    await expect(pending).resolves.toEqual({
      ok: true,
      value: [{ id: 3, title: 'Example', url: 'https://example.com/' }],
    });
  });
  it('returns the extension error result', async () => {
    const { hub } = setup();
    const { peer, id } = pair(hub);
    const pending = hub.sendAction({
      browserId: id,
      tabId: 1,
      generation: 1,
      method: 'tab.title',
      args: [],
    });
    const sent = peer.messages.find((message) => message.type === 'action');
    peer.send({
      type: 'action_result',
      requestId: sent?.requestId,
      ok: false,
      error: { code: 'CAPABILITY_NOT_ALLOWED', message: 'nope' },
    });
    await expect(pending).resolves.toEqual({
      ok: false,
      error: { code: 'CAPABILITY_NOT_ALLOWED', message: 'nope' },
    });
  });
  it('chunks actions larger than the extension frame limit', async () => {
    const { hub } = setup();
    const { peer, id } = pair(hub);
    const pending = hub.sendAction({
      browserId: id,
      tabId: 1,
      generation: 1,
      method: 'tab.snapshot',
      args: ['x'.repeat(9000)],
    });
    const chunks = peer.messages.filter((message) => message.type === 'chunk');
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks)
      expect(
        Buffer.byteLength(JSON.stringify(chunk), 'utf8'),
      ).toBeLessThanOrEqual(8192);
    expect(peer.messages.some((message) => message.type === 'action')).toBe(
      false,
    );
    const reassembled = JSON.parse(
      chunks.map((chunk) => chunk.payload as string).join(''),
    ) as Record<string, unknown>;
    expect(reassembled).toMatchObject({
      v: 1,
      type: 'action',
      method: 'tab.snapshot',
    });
    peer.send({
      type: 'action_result',
      requestId: reassembled.requestId,
      ok: true,
      value: 'done',
    });
    await expect(pending).resolves.toEqual({ ok: true, value: 'done' });
  });
  it('times out without replaying', async () => {
    const { hub } = setup();
    const { peer, id } = pair(hub);
    const outcome = await hub.sendAction({
      browserId: id,
      tabId: 1,
      generation: 1,
      method: 'browser.tabs.list',
      args: [],
      timeoutMs: 10,
    });
    expect(outcome).toEqual({
      ok: false,
      error: { code: 'TIMEOUT', message: 'Action timed out' },
    });
    expect(
      peer.messages.filter((message) => message.type === 'action'),
    ).toHaveLength(1);
  });
  it('fails in-flight actions when the extension disconnects', async () => {
    const { hub } = setup();
    const { peer, id } = pair(hub);
    const pending = hub.sendAction({
      browserId: id,
      tabId: 1,
      generation: 1,
      method: 'browser.tabs.list',
      args: [],
    });
    peer.disconnect();
    await expect(pending).resolves.toEqual({
      ok: false,
      error: {
        code: 'EXTENSION_OFFLINE',
        message: 'Browser extension disconnected',
      },
    });
  });
});

describe('sendAction failures', () => {
  it('rejects actions for offline browsers and stale generations without sending', async () => {
    const { hub } = setup();
    const { peer, id } = pair(hub);
    await expect(
      hub.sendAction({
        browserId: 'missing',
        tabId: 1,
        generation: 1,
        method: 'browser.tabs.list',
        args: [],
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'EXTENSION_OFFLINE',
        message: 'Browser extension is offline',
      },
    });
    await expect(
      hub.sendAction({
        browserId: id,
        tabId: 1,
        generation: 99,
        method: 'browser.tabs.list',
        args: [],
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'INVALID_TARGET', message: 'Stale connection generation' },
    });
    await expect(
      hub.sendAction({
        browserId: id,
        tabId: -1,
        generation: 1,
        method: 'browser.tabs.list',
        args: [],
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'INVALID_ARGUMENT', message: 'Invalid tabId' },
    });
    expect(peer.messages.some((message) => message.type === 'action')).toBe(
      false,
    );
  });
  it('reassembles chunked results', async () => {
    const { hub } = setup();
    const { peer, id } = pair(hub);
    const pending = hub.sendAction({
      browserId: id,
      tabId: 1,
      generation: 1,
      method: 'tab.snapshot',
      args: [],
    });
    const sent = peer.messages.find((message) => message.type === 'action');
    const requestId = sent?.requestId as string;
    const value = { text: 'x'.repeat(1_200_000) };
    const frames = frameMessage(
      requestId,
      { type: 'action_result', requestId, ok: true, value },
      1_048_576,
    );
    expect(frames.length).toBeGreaterThan(1);
    for (const frame of frames) peer.send(frame);
    await expect(pending).resolves.toEqual({ ok: true, value });
  });
  it('ignores results and chunks for unknown requests', () => {
    const { hub } = setup();
    const { peer } = pair(hub);
    peer.send({
      type: 'action_result',
      requestId: 'unknown',
      ok: true,
      value: 1,
    });
    peer.send({
      type: 'chunk',
      requestId: 'unknown',
      index: 0,
      total: 1,
      payload: '{}',
    });
    peer.send({ type: 'ping' });
    expect(peer.messages.at(-1)?.type).toBe('pong');
    expect(hub.browsers()[0]?.connected).toBe(true);
  });
  it('fails in-flight actions when the session is replaced', async () => {
    const { hub } = setup();
    const { id, token } = pair(hub);
    const pending = hub.sendAction({
      browserId: id,
      tabId: 1,
      generation: 1,
      method: 'browser.tabs.list',
      args: [],
    });
    const replacement = client(hub);
    replacement.send({ type: 'authenticate', browserId: id, token });
    expect(replacement.messages.at(-1)?.type).toBe('ready');
    await expect(pending).resolves.toEqual({
      ok: false,
      error: {
        code: 'EXTENSION_OFFLINE',
        message: 'Browser extension disconnected',
      },
    });
    expect(hub.generation(id)).toBe(2);
    await expect(
      hub.sendAction({
        browserId: id,
        tabId: 1,
        generation: 1,
        method: 'browser.tabs.list',
        args: [],
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_TARGET' },
    });
  });
});

describe('execution-manager adapter', () => {
  it('propagates the extension error from the tab-title adapter without retrying', async () => {
    const { hub } = setup();
    const { peer, id } = pair(hub);
    peer.send({
      type: 'tabs',
      tabs: [{ id: 3, title: 'Page', url: 'https://example.com/' }],
    });
    const pending = hub.action(
      id,
      3,
      'tab.title',
      new AbortController().signal,
    );
    const sent = peer.messages.find((message) => message.type === 'action');
    expect(sent).toMatchObject({ method: 'tab.title', tabId: 3 });
    peer.send({
      type: 'action_result',
      requestId: sent?.requestId,
      ok: false,
      error: { code: 'PAGE_NOT_ACCESSIBLE', message: 'restricted page' },
    });
    await expect(pending).rejects.toThrow('PAGE_NOT_ACCESSIBLE');
    expect(
      peer.messages.filter((message) => message.type === 'action'),
    ).toHaveLength(1);
  });
  it('keeps the execution-manager adapter working over sendAction', async () => {
    const { hub } = setup();
    const { peer, id } = pair(hub);
    peer.send({
      type: 'tabs',
      tabs: [{ id: 3, title: 'Example', url: 'https://example.com/' }],
    });
    const controller = new AbortController();
    const pending = hub.action(id, 3, 'tab.title', controller.signal);
    const sent = peer.messages.find((message) => message.type === 'action');
    expect(sent).toMatchObject({
      method: 'tab.title',
      tabId: 3,
      generation: 1,
    });
    peer.send({
      type: 'action_result',
      requestId: sent?.requestId,
      ok: true,
      value: 'Example',
    });
    await expect(pending).resolves.toBe('Example');
    await expect(
      hub.action(id, 99, 'tab.title', controller.signal),
    ).rejects.toThrow('INVALID_TARGET');
    await expect(
      hub.action(id, 3, 'tab.nope', controller.signal),
    ).rejects.toThrow('CAPABILITY_NOT_ALLOWED');
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      hub.action(id, 3, 'tab.title', aborted.signal),
    ).rejects.toThrow('CANCELLED');
  });
  it('rejects the adapter promise on abort while the action stays in flight', async () => {
    const { hub } = setup();
    const { peer, id } = pair(hub);
    peer.send({
      type: 'tabs',
      tabs: [{ id: 3, title: 'Example', url: 'https://example.com/' }],
    });
    const controller = new AbortController();
    const pending = hub.action(id, 3, 'tab.title', controller.signal);
    const sent = peer.messages.find((message) => message.type === 'action');
    controller.abort();
    await expect(pending).rejects.toThrow('CANCELLED');
    peer.send({
      type: 'action_result',
      requestId: sent?.requestId,
      ok: true,
      value: 'Example',
    });
    peer.send({ type: 'ping' });
    expect(peer.messages.at(-1)?.type).toBe('pong');
  });
});
