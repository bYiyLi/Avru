import { describe, expect, it, vi } from 'vitest';
import { ExecutionBridge } from '../src/execution-bridge';
import { ClaimRegistry } from '../src/claims';
import type { Connections } from '../src/connections';
import type { ExecutionAudit } from '../src/execution-audit';
import type { Entry } from '../src/execution-types';

function fixture(audit?: ExecutionAudit) {
  const browsers = vi.fn(() => [
    {
      id: 'browser-a',
      connected: true,
      tabs: [
        {
          id: 7,
          title: 'Title',
          url: 'https://example.test/',
          active: true,
        },
      ],
    },
  ]);
  const generation = vi.fn(() => 3);
  const action = vi.fn(() => Promise.resolve<unknown>('Live title'));
  const connections = {
    browsers,
    generation,
    action,
  } as unknown as Connections;
  const claims = new ClaimRegistry();
  const bridge = new ExecutionBridge(connections, claims, audit);
  const entry = {
    id: 'task-a',
    owner: 'owner-a',
    state: 'running',
    target: { browserId: 'browser-a', tabId: 7, generation: 3 },
    inFlight: 0,
    steps: [],
  } as unknown as Entry;
  const run = () =>
    bridge.invoke(entry, 'tab.title', '[]', new AbortController().signal);
  const claim = () => {
    claims.claim('owner-a', {
      browserId: 'browser-a',
      tabId: 7,
      generation: 3,
    });
    claims.bind(entry.id, 'owner-a', 'browser-a', 7);
  };
  return { bridge, entry, claims, action, browsers, generation, run, claim };
}

describe('target tab title and extension failure mapping', () => {
  it('requires an execution-bound lock before reading a tab title', async () => {
    const h = fixture();
    await expect(h.run()).rejects.toThrow('target tab is not claimed');
    expect(h.entry.steps.at(-1)?.result).toBe('error:TAB_NOT_CLAIMED');
    expect(h.action).not.toHaveBeenCalled();
  });

  it('reads a live tab title only through the exact browser target', async () => {
    const h = fixture();
    h.claim();
    expect(await h.run()).toBe('"Live title"');
    expect(h.action).toHaveBeenCalledWith(
      'browser-a',
      7,
      'tab.title',
      expect.any(AbortSignal),
    );
    expect(h.entry.inFlight).toBe(0);
    expect(h.entry.steps).toEqual([
      expect.objectContaining({ action: 'tab.title', result: 'ok' }),
    ]);
  });

  it('rejects a stale browser generation before calling the extension', async () => {
    const h = fixture();
    h.claim();
    h.generation.mockReturnValueOnce(4);
    await expect(h.run()).rejects.toThrow('stale connection generation');
    expect(h.action).not.toHaveBeenCalled();
    expect(h.entry.steps.at(-1)?.result).toBe('error:INVALID_TARGET');
  });

  it('does not accept a nonstring title as a successful browser result', async () => {
    const h = fixture();
    h.claim();
    h.action.mockResolvedValueOnce({ leaked: 'secret' });
    await expect(h.run()).rejects.toThrow('non-string value');
    expect(h.entry.steps.at(-1)?.result).toBe('error:UNKNOWN_RESULT');
    expect(h.entry.uncertainStep).toBe(h.entry.steps.at(-1)?.stepId);
  });

  it('maps known extension failures to stable SDK error codes', async () => {
    const h = fixture();
    h.claim();
    h.action.mockRejectedValueOnce(new Error('PAGE_NOT_ACCESSIBLE'));
    await expect(h.run()).rejects.toThrow('target page is not accessible');
    expect(h.entry.steps.at(-1)?.result).toBe('error:PAGE_NOT_ACCESSIBLE');
    h.action.mockRejectedValueOnce(new Error('EXTENSION_OFFLINE'));
    await expect(h.run()).rejects.toThrow('browser extension is offline');
    expect(h.entry.steps.at(-1)?.result).toBe('error:EXTENSION_OFFLINE');
    h.action.mockRejectedValueOnce(new Error('unrecognized browser error'));
    await expect(h.run()).rejects.toThrow('tab.title failed');
    expect(h.entry.steps.at(-1)?.result).toBe('error:UNKNOWN_RESULT');
  });

  it('escalates a truly closed target tab to task cancellation', async () => {
    const h = fixture();
    h.claim();
    const cancel = vi.fn();
    h.entry.runner = { cancel } as unknown as NonNullable<Entry['runner']>;
    h.action.mockRejectedValueOnce(new Error('TARGET_GONE'));
    h.browsers.mockReturnValueOnce([]);
    await expect(h.run()).rejects.toThrow('target tab is gone');
    expect(h.entry.cancelReason).toBe('TAB_CLOSED');
    expect(cancel).toHaveBeenCalledOnce();
    expect(h.entry.steps.at(-1)?.result).toBe('error:INVALID_TARGET');
  });

  it('does not cancel when the target is still live after a transient lookup error', async () => {
    const h = fixture();
    h.claim();
    const cancel = vi.fn();
    h.entry.runner = { cancel } as unknown as NonNullable<Entry['runner']>;
    h.action.mockRejectedValueOnce(new Error('INVALID_TARGET'));
    await expect(h.run()).rejects.toThrow('target tab is gone');
    expect(h.entry.cancelReason).toBeUndefined();
    expect(cancel).not.toHaveBeenCalled();
  });
});

describe('durable step receipt semantics', () => {
  it('marks a completed browser action unknown if its audit receipt is lost', async () => {
    const append = vi.fn(() => {
      throw new Error('disk is unavailable');
    });
    const h = fixture({ append } as unknown as ExecutionAudit);
    h.claim();
    await expect(h.run()).rejects.toThrow('execution audit write failed');
    expect(append).toHaveBeenCalledOnce();
    expect(h.entry.steps).toHaveLength(1);
    expect(h.entry.uncertainStep).toBe(h.entry.steps[0]?.stepId);
    expect(h.entry.inFlight).toBe(0);
  });

  it('records a rejected SDK argument without exposing the argument text', async () => {
    const append = vi.fn();
    const h = fixture({ append } as unknown as ExecutionAudit);
    await expect(
      h.bridge.invoke(
        h.entry,
        'tab.title',
        '["secret argument"]',
        new AbortController().signal,
      ),
    ).rejects.toThrow('takes no arguments');
    expect(append).toHaveBeenCalledOnce();
    const step = append.mock.calls[0]?.[1] as unknown as {
      action: string;
      result: string;
    };
    expect(step).toMatchObject({
      action: 'tab.title',
      result: 'error:INVALID_ARGUMENT',
    });
    expect(JSON.stringify(step)).not.toContain('secret argument');
  });
});
