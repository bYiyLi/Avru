import { describe, expect, it, vi } from 'vitest';
import { ClaimRegistry } from '../src/claims';
import type { Connections } from '../src/connections';
import { ExecutionBridge } from '../src/execution-bridge';
import { createExecutionEntry } from '../src/execution-types';

const selected = { browserId: 'profile-a', tabId: 7, generation: 3 };
const tab = {
  id: 7,
  title: 'Page',
  url: 'https://example.test/',
  active: true,
};

function fixture() {
  const sendAction = vi.fn<Connections['sendAction']>(() =>
    Promise.resolve({ ok: true as const, value: { ok: true } }),
  );
  const browsers = vi.fn(() => [
    { id: 'profile-a', connected: true, tabs: [tab] },
  ]);
  const generation = vi.fn(() => 3);
  const connections = {
    sendAction,
    browsers,
    generation,
  } as unknown as Connections;
  const claims = new ClaimRegistry();
  const bridge = new ExecutionBridge(connections, claims);
  const entry = createExecutionEntry({
    owner: 'owner-a',
    source: 'return 1;',
    target: selected,
    timeoutMs: 60_000,
    limits: { maxOutputBytes: 65_536, maxBridgeCalls: 32 },
  });
  entry.state = 'running';
  const signal = new AbortController();
  const run = (method: string, args: unknown[] = []) =>
    bridge.invoke(entry, method, JSON.stringify(args), signal.signal);
  const claim = () => {
    claims.claim('owner-a', selected);
    claims.bind(entry.id, 'owner-a', selected.browserId, selected.tabId);
  };
  return {
    sendAction,
    browsers,
    generation,
    bridge,
    claims,
    entry,
    signal,
    run,
    claim,
  };
}

describe('new 08 SDK bridge dispatch paths', () => {
  it('routes a target-scoped management API and does not allow it without a tab', async () => {
    const h = fixture();
    expect(JSON.parse(await h.run('browser.visibility.get'))).toEqual({
      ok: true,
    });
    expect(h.sendAction).toHaveBeenCalledWith({
      ...selected,
      method: 'browser.visibility.get',
      args: [],
    });
    expect(h.claims.get('profile-a', 7)?.executionId).toBe(h.entry.id);
    h.entry.target = undefined;
    await expect(h.run('tab.visual.cursor', [{ x: 1, y: 2 }])).rejects.toThrow(
      'task has no browser target',
    );
  });

  it('records model observation data without sending browser content to the extension', async () => {
    const h = fixture();
    expect(
      await h.run('tab.observe.write', [{ mode: 'state', state: 'opened' }]),
    ).toBe('null');
    expect(h.entry.observations).toEqual([{ mode: 'state', state: 'opened' }]);
    expect(h.sendAction).not.toHaveBeenCalled();
  });

  it('returns only management-prefixed action audit receipts', async () => {
    const h = fixture();
    h.entry.steps.push(
      {
        stepId: 's1',
        action: 'management.invoke',
        durationMs: 1,
        result: 'ok',
      },
      {
        stepId: 's2',
        action: 'cdp.send',
        durationMs: 2,
        result: 'ok',
      },
    );
    const logs = JSON.parse(await h.run('management.audit')) as {
      stepId: string;
    }[];
    expect(logs).toEqual([
      {
        stepId: 's1',
        action: 'management.invoke',
        durationMs: 1,
        result: 'ok',
      },
    ]);
    await expect(h.run('management.audit', ['unexpected'])).rejects.toThrow(
      'takes no arguments',
    );
  });

  it('returns the script SDK topic documentation and errors for unknown topics', async () => {
    const h = fixture();
    expect(
      JSON.parse(await h.run('documentation.get', ['overview'])),
    ).toContain('browser_run_script');
    await expect(h.run('documentation.get', ['absent-topic'])).rejects.toThrow(
      'SDK documentation topic not found',
    );
  });

  it('validates session names before grouping and includes the execution identity', async () => {
    const h = fixture();
    for (const args of [
      [],
      [null],
      ['   '],
      ['a'.repeat(129)],
      ['name', 'extra'],
    ])
      await expect(h.run('browser.nameSession', args)).rejects.toThrow(
        'invalid browser session name',
      );
    expect(
      JSON.parse(await h.run('browser.nameSession', ['  Research  '])),
    ).toEqual({ ok: true });
    expect(h.sendAction).toHaveBeenCalledWith({
      ...selected,
      method: 'browser.nameSession',
      args: ['Research', h.entry.id],
    });
    h.entry.target = undefined;
    await expect(h.run('browser.nameSession', ['Research'])).rejects.toThrow(
      'task has no browser target',
    );
  });

  it('rejects a bad multi-tab action method, shape and missing browser', async () => {
    const h = fixture();
    for (const args of [
      [],
      ['profile-a', '7', 3, 'Page.reload', []],
      ['profile-a', '7', 3, 'cdp.send', 'not-array'],
      ['profile-a', '7', 3, 'cdp.send'],
    ])
      await expect(h.run('tab.action', args)).rejects.toThrow(
        'invalid tab action',
      );
    await expect(
      h.run('tab.action', [
        'other-profile',
        '7',
        3,
        'cdp.send',
        ['Page.enable'],
      ]),
    ).rejects.toThrow('unavailable or stale');
  });

  it('records a secondary tab observation only while its profile and generation are live', async () => {
    const h = fixture();
    expect(
      await h.run('tab.action', [
        'profile-a',
        '7',
        3,
        'tab.observe.write',
        [{ mode: 'state', state: 'new state' }],
      ]),
    ).toBe('null');
    expect(h.entry.observations).toHaveLength(1);
    expect(h.sendAction).not.toHaveBeenCalled();
    await expect(
      h.run('tab.action', [
        'profile-a',
        '7',
        4,
        'tab.observe.write',
        [{ mode: 'state', state: 'stale' }],
      ]),
    ).rejects.toThrow('unavailable or stale');
  });
});

describe('selected user tab and native browser management dispatch', () => {
  it('requires a single valid identity before a user selects a secondary tab', async () => {
    const h = fixture();
    await expect(h.run('browser.user.claimTab', [])).rejects.toThrow(
      'requires one tab identity',
    );
    await expect(
      h.run('browser.user.claimTab', [selected, selected]),
    ).rejects.toThrow('requires one tab identity');
    await expect(
      h.run('browser.user.claimTab', [{ ...selected, generation: 9 }]),
    ).rejects.toThrow('no longer available');
    expect(h.claims.size()).toBe(0);
    const result = JSON.parse(
      await h.run('browser.user.claimTab', [selected]),
    ) as { claimed: boolean; tabId: string };
    expect(result).toMatchObject({ tabId: '7', claimed: true });
    expect(h.claims.get('profile-a', 7)?.owner).toBe('owner-a');
  });

  it('rejects a user tab context without the required identity and valid snapshot', async () => {
    const h = fixture();
    await expect(h.run('browser.user.getTabContext', [])).rejects.toThrow(
      'requires one tab identity',
    );
    h.sendAction.mockResolvedValueOnce({ ok: true as const, value: null });
    await expect(
      h.run('browser.user.getTabContext', [selected]),
    ).rejects.toThrow('tab context is unavailable');
    h.sendAction.mockResolvedValueOnce({
      ok: true as const,
      value: { url: 'https://example.test', title: 3 },
    });
    await expect(
      h.run('browser.user.getTabContext', [selected]),
    ).rejects.toThrow('tab context response is invalid');
    expect(h.claims.get('profile-a', 7)).toBeUndefined();
  });

  it('reads user tab context without claiming the tab or executing a write', async () => {
    const h = fixture();
    h.sendAction.mockResolvedValueOnce({
      ok: true as const,
      value: {
        url: 'https://example.test/',
        title: 'Page',
        text: 'Visible',
        truncated: false,
      },
    });
    const context = JSON.parse(
      await h.run('browser.user.getTabContext', [selected]),
    ) as Record<string, unknown>;
    expect(context).toMatchObject({
      kind: 'text',
      title: 'Page',
      text: 'Visible',
      truncated: false,
    });
    expect(h.sendAction).toHaveBeenCalledWith({
      ...selected,
      method: 'tab.snapshot',
      args: [],
    });
    expect(h.claims.get('profile-a', 7)).toBeUndefined();
  });

  it('prevents tab management after connection generation changes or target disappears', async () => {
    const h = fixture();
    h.entry.target = undefined;
    await expect(h.run('tabs.selected')).rejects.toThrow(
      'task has no browser target',
    );
    h.entry.target = selected;
    h.generation.mockReturnValueOnce(4);
    await expect(h.run('tabs.selected')).rejects.toThrow(
      'stale browser connection',
    );
    expect(h.sendAction).not.toHaveBeenCalled();
  });

  it('validates tab management before forwarding operations', async () => {
    const h = fixture();
    await expect(h.run('tabs.move', ['7', { index: -2 }])).rejects.toThrow(
      'invalid tabs.move destination',
    );
    await expect(h.run('tabs.new', ['javascript:bad', null])).rejects.toThrow(
      'invalid new tab arguments',
    );
    await expect(h.run('tabs.close', ['bad-tab'])).rejects.toThrow(
      'invalid tab ID',
    );
    expect(h.sendAction).not.toHaveBeenCalled();
  });

  it('treats a tab-management failure after dispatch as uncertain only for transport errors', async () => {
    const h = fixture();
    h.sendAction.mockResolvedValueOnce({
      ok: false,
      error: { code: 'TIMEOUT', message: 'slow' },
    });
    await expect(h.run('tabs.close', ['7'])).rejects.toMatchObject({
      code: 'UNKNOWN_RESULT',
    });
    h.sendAction.mockResolvedValueOnce({
      ok: false,
      error: { code: 'INVALID_TARGET', message: 'gone' },
    });
    await expect(h.run('tabs.close', ['7'])).rejects.toMatchObject({
      code: 'INVALID_TARGET',
    });
  });

  it('never reports cancelled tab management as safe after dispatch was attempted', async () => {
    const h = fixture();
    h.sendAction.mockImplementationOnce(() => {
      h.signal.abort();
      return Promise.resolve({ ok: true as const, value: { ok: true } });
    });
    await expect(h.run('tabs.close', ['7'])).rejects.toMatchObject({
      code: 'UNKNOWN_RESULT',
    });
  });
});
