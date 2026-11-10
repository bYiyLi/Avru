import { describe, expect, it, vi } from 'vitest';
import { ExecutionBridge } from '../src/execution-bridge';
import { ClaimRegistry } from '../src/claims';
import type { Connections } from '../src/connections';
import type { Entry } from '../src/execution-types';

function fixture() {
  const browsers = vi.fn(() => [
    {
      id: 'a',
      connected: true,
      tabs: [
        { id: 7, title: 'A', url: 'https://example.test/', active: true },
        { id: 9, title: '', url: '', active: false },
      ],
    },
    {
      id: 'b',
      connected: false,
      tabs: [{ id: 8, title: 'B', url: 'https://other.test/', active: true }],
    },
  ]);
  const generation = vi.fn((id: string) => (id === 'a' ? 3 : undefined));
  const action = vi.fn(() => Promise.resolve<unknown>('A'));
  const sendAction = vi.fn(() =>
    Promise.resolve({
      ok: true as const,
      value: { result: { value: 2 } },
    }),
  );
  const connections = {
    browsers,
    generation,
    action,
    sendAction,
  } as unknown as Connections;
  const claims = new ClaimRegistry();
  const bridge = new ExecutionBridge(connections, claims);
  const entry = {
    id: 'execution-a',
    state: 'running',
    owner: 'owner-a',
    target: { browserId: 'a', tabId: 7, generation: 3 },
    inFlight: 0,
    steps: [],
  } as unknown as Entry;
  const signal = new AbortController().signal;
  const invoke = (method: string, args: unknown[] = [], abort = signal) =>
    bridge.invoke(entry, method, JSON.stringify(args), abort);
  const claimTarget = () => {
    claims.claim('owner-a', { browserId: 'a', tabId: 7, generation: 3 });
    claims.bind(entry.id, 'owner-a', 'a', 7);
  };
  return {
    bridge,
    browsers,
    generation,
    action,
    sendAction,
    connections,
    claims,
    entry,
    signal,
    invoke,
    claimTarget,
  };
}

describe('SDK bridge target discovery and scope', () => {
  it('discovers only connected browsers and omits empty title and URL', async () => {
    const h = fixture();
    h.entry.target = undefined;
    const result = JSON.parse(await h.invoke('tabs.list')) as {
      browserId: string;
      tabId: string;
      title?: string;
      url?: string;
      claimed: boolean;
    }[];
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      browserId: 'a',
      tabId: '7',
      title: 'A',
      claimed: false,
    });
    expect(result[1]).toEqual({
      browserId: 'a',
      tabId: '9',
      generation: 3,
      active: false,
      claimed: false,
    });
    expect(h.entry.steps).toEqual([
      expect.objectContaining({ action: 'tabs.list', result: 'ok' }),
    ]);
  });

  it('never resolves same-number tab IDs from another browser profile', async () => {
    const h = fixture();
    expect(JSON.parse(await h.invoke('tabs.get', ['7']))).toMatchObject({
      browserId: 'a',
      tabId: '7',
    });
    await expect(h.invoke('tabs.get', ['8'])).rejects.toThrow('unknown tab');
    h.entry.target = undefined;
    h.browsers.mockReturnValueOnce([
      { id: 'a', connected: false, tabs: [] },
      {
        id: 'b',
        connected: true,
        tabs: [{ id: 8, title: 'B', url: 'https://other.test/', active: true }],
      },
    ]);
    expect(JSON.parse(await h.invoke('tabs.get', ['8']))).toMatchObject({
      browserId: 'b',
      tabId: '8',
    });
  });

  it('validates all public bridge envelopes and does not dispatch bad calls', async () => {
    const h = fixture();
    const invalid = [
      { method: 'tabs.list', json: '{' },
      { method: 'tabs.list', json: '{}' },
      { method: 'tabs.list', json: '[1]' },
      { method: 'tabs.get', json: '[]' },
      { method: 'tabs.get', json: '[12]' },
      { method: 'tabs.get', json: '[""]' },
      { method: 'tabs.get', json: '["bogus"]' },
      { method: 'capabilities.get', json: '[]' },
      { method: 'capabilities.get', json: '[""]' },
      { method: 'capabilities.list', json: '["extra"]' },
      { method: 'nonexistent', json: '[]' },
    ];
    for (const item of invalid)
      await expect(
        h.bridge.invoke(h.entry, item.method, item.json, h.signal),
      ).rejects.toThrow();
    expect(h.sendAction).not.toHaveBeenCalled();
    expect(h.action).not.toHaveBeenCalled();
    expect(h.entry.inFlight).toBe(0);
    expect(h.entry.steps).toHaveLength(invalid.length);
  });

  it('describes known capabilities but rejects unsupported SDK methods', async () => {
    const h = fixture();
    const listed = JSON.parse(await h.invoke('capabilities.list')) as {
      name: string;
    }[];
    expect(listed.some((capability) => capability.name === 'cdp.send')).toBe(
      true,
    );
    expect(
      JSON.parse(await h.invoke('capabilities.get', ['cdp.send'])),
    ).toMatchObject({ name: 'cdp.send', supported: true });
    await expect(
      h.invoke('capabilities.get', ['not.a.capability']),
    ).rejects.toThrow('unknown capability');
    expect(h.entry.steps.at(-1)?.result).toBe('error:CAPABILITY_NOT_ALLOWED');
  });

  it('blocks a late SDK call after cancellation or task termination', async () => {
    const h = fixture();
    h.entry.state = 'cancelled';
    await expect(h.invoke('tabs.list')).rejects.toThrow(
      'task is no longer running',
    );
    h.entry.state = 'running';
    const controller = new AbortController();
    controller.abort();
    await expect(h.invoke('tabs.list', [], controller.signal)).rejects.toThrow(
      'task cancelled',
    );
    expect(h.browsers).not.toHaveBeenCalled();
  });
});

describe('automatic tab claim and connection generation', () => {
  it('reserves the current tab without requiring manual claim', () => {
    const h = fixture();
    expect(
      h.bridge.resolveTarget('owner-a', {
        browserId: 'a',
        tabId: 7,
        generation: 3,
      }),
    ).toEqual({ browserId: 'a', tabId: 7, generation: 3 });
    expect(h.claims.isClaimed('a', 7)).toBe(true);
  });

  it('rejects missing targets, invalid tab IDs and stale generations', () => {
    const h = fixture();
    expect(h.bridge.resolveTarget('owner-a', undefined)).toBeUndefined();
    for (const target of [
      { browserId: '', tabId: 7 },
      { browserId: 'a', tabId: -1 },
      { browserId: 'a', tabId: 1.5 },
    ])
      expect(() => h.bridge.resolveTarget('owner-a', target)).toThrow(
        'INVALID_ARGUMENT',
      );
    for (const target of [
      { browserId: 'z', tabId: 7 },
      { browserId: 'b', tabId: 8 },
      { browserId: 'a', tabId: 88 },
      { browserId: 'a', tabId: 7, generation: 99 },
    ])
      expect(() => h.bridge.resolveTarget('owner-a', target)).toThrow(
        'INVALID_TARGET',
      );
  });

  it('rejects a different owner, bound claim and stale claim generation', () => {
    const h = fixture();
    const target = { browserId: 'a', tabId: 7, generation: 3 };
    h.claims.claim('owner-b', target);
    expect(() => h.bridge.resolveTarget('owner-a', target)).toThrow(
      'TAB_ALREADY_CLAIMED',
    );
    h.claims.release('a', 7);
    h.claims.claim('owner-a', target);
    h.claims.bind('other-task', 'owner-a', 'a', 7);
    expect(() => h.bridge.resolveTarget('owner-a', target)).toThrow(
      'TAB_ALREADY_CLAIMED',
    );
    h.claims.release('a', 7);
    h.claims.claim('owner-a', { ...target, generation: 2 });
    expect(() => h.bridge.resolveTarget('owner-a', target)).toThrow(
      'INVALID_TARGET',
    );
  });

  it('returns no target when the browser generation or metadata vanished', () => {
    const h = fixture();
    h.generation.mockReturnValueOnce(undefined);
    expect(h.bridge.liveTab('a', 7)).toBeUndefined();
    expect(h.bridge.liveTab('missing', 7)).toBeUndefined();
    expect(h.bridge.liveTab('a', 18)).toBeUndefined();
  });
});

describe('multi-tab SDK routing', () => {
  it('routes a secondary tab and acquires an execution-scoped lock', async () => {
    const h = fixture();
    const result = JSON.parse(
      await h.invoke('tab.action', ['a', '9', 3, 'tab.title', []]),
    ) as unknown;
    expect(result).toEqual({ result: { value: 2 } });
    expect(h.sendAction).toHaveBeenCalledWith({
      browserId: 'a',
      tabId: 9,
      generation: 3,
      method: 'tab.title',
      args: [],
    });
    expect(h.claims.get('a', 9)).toMatchObject({
      owner: 'owner-a',
      executionId: 'execution-a',
      generation: 3,
    });
    expect(h.entry.steps[0]).toMatchObject({
      action: 'tab.title',
      target: { browserId: 'a', tabId: 9 },
      result: 'ok',
    });
  });

  it('rejects stale, disconnected and concurrently locked secondary targets', async () => {
    const h = fixture();
    await expect(
      h.invoke('tab.action', ['a', '9', 4, 'tab.title', []]),
    ).rejects.toThrow('unavailable or stale');
    await expect(
      h.invoke('tab.action', ['b', '8', 3, 'tab.title', []]),
    ).rejects.toThrow('unavailable or stale');
    h.claims.claim('owner-b', { browserId: 'a', tabId: 9, generation: 3 });
    await expect(
      h.invoke('tab.action', ['a', '9', 3, 'tab.title', []]),
    ).rejects.toMatchObject({ code: 'TAB_ALREADY_CLAIMED' });
    expect(h.sendAction).not.toHaveBeenCalled();
  });

  it('reads user tab context without acquiring an operation lock', async () => {
    const h = fixture();
    h.sendAction.mockResolvedValueOnce({
      ok: true,
      value: {
        title: 'Secondary',
        url: 'https://example.test/secondary',
        text: 'Visible page text',
        truncated: false,
      },
    } as never);
    const result = JSON.parse(
      await h.invoke('browser.user.getTabContext', [
        { browserId: 'a', tabId: '9', generation: 3 },
      ]),
    ) as unknown;
    expect(result).toMatchObject({
      kind: 'text',
      title: 'Secondary',
      text: 'Visible page text',
    });
    expect(h.sendAction).toHaveBeenCalledWith({
      browserId: 'a',
      tabId: 9,
      generation: 3,
      method: 'tab.snapshot',
      args: [],
    });
    expect(h.claims.get('a', 9)).toBeUndefined();
  });

  it('returns generation-bound user tab references and supports optional claims', async () => {
    const h = fixture();
    const tabs = JSON.parse(
      await h.invoke('browser.user.openTabs'),
    ) as unknown[];
    expect(tabs[0]).toMatchObject({ id: 'a:7:3', providerTabId: 'a:7:3' });
    const claimed = JSON.parse(
      await h.invoke('browser.user.claimTab', [
        { browserId: 'a', tabId: '9', generation: 3 },
      ]),
    ) as unknown;
    expect(claimed).toMatchObject({
      browserId: 'a',
      tabId: '9',
      generation: 3,
      claimed: true,
    });
    expect(h.claims.get('a', 9)).toMatchObject({
      owner: 'owner-a',
      generation: 3,
    });
  });
});
