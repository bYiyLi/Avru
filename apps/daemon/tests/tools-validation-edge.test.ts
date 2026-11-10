import { describe, expect, it, vi } from 'vitest';
import type { Executions } from '../src/executions';
import {
  BROWSER_TOOLS,
  callBrowserTool,
  type ToolContext,
} from '../src/oauth/tools';

function fixture(): ToolContext {
  const executions = {
    browsers: () => [
      {
        id: 'a',
        name: 'Primary',
        connected: true,
        tabs: [
          { id: 1, title: 'Search', url: 'https://example.test/' },
          { id: 2, title: '', url: '' },
        ],
      },
      { id: 'b', name: 'Secondary', connected: true, tabs: [] },
      { id: 'c', name: 'Offline', connected: false, tabs: [] },
    ],
    isClaimed: (browserId: string, tabId: number) =>
      browserId === 'a' && tabId === 1,
    claimTab: vi.fn((_owner: string, browserId: string, tabId: number) => ({
      browserId,
      tabId,
      claimedAt: 99,
    })),
    run: vi.fn(() => ({
      executionId: 'exec-123',
      state: 'queued',
      submittedAt: 1,
    })),
    get: vi.fn(() => ({ executionId: 'exec-123', state: 'succeeded' })),
    cancel: vi.fn(() =>
      Promise.resolve({ executionId: 'exec-123', state: 'cancelled' }),
    ),
  } as unknown as Executions;
  return {
    owner: 'owner-a',
    scopes: ['browser:read', 'browser:control'],
    executions,
  };
}

describe('MCP tool input and pagination boundaries', () => {
  it('paginates connected profiles and never exposes tabs of offline browsers', async () => {
    const ctx = fixture();
    const first = (await callBrowserTool(ctx, 'browser_list', {
      limit: 1,
    })) as {
      browsers: {
        browserId: string;
        tabs: {
          tabId: string;
          claimed: boolean;
          title?: string;
          url?: string;
        }[];
      }[];
      nextCursor: string;
      total: number;
    };
    expect(first.total).toBe(2);
    expect(first.browsers[0]?.browserId).toBe('a');
    expect(first.browsers[0]?.tabs[0]).toMatchObject({
      tabId: '1',
      claimed: true,
    });
    expect(first.browsers[0]?.tabs[1]).toEqual({
      tabId: '2',
      claimed: false,
    });
    const second = (await callBrowserTool(ctx, 'browser_list', {
      cursor: first.nextCursor,
      limit: 1,
    })) as { browsers: { browserId: string }[]; total: number };
    expect(second).toMatchObject({
      browsers: [{ browserId: 'b' }],
      total: 2,
    });
    expect(
      await callBrowserTool(ctx, 'browser_list', { browserId: 'c' }),
    ).toMatchObject({ browsers: [], total: 0 });
  });

  it('rejects malformed pagination and filters before accessing browser data', async () => {
    const ctx = fixture();
    const encoded = (value: unknown) =>
      Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    for (const args of [
      { limit: '10' },
      { limit: 1.2 },
      { limit: -1 },
      { limit: 1001 },
      { browserId: 123 },
      { cursor: 123 },
      { cursor: encoded(null) },
      { cursor: encoded({ a: 2 }) },
      { cursor: encoded({ o: -1 }) },
      { cursor: encoded({ o: 1.5 }) },
      { cursor: encoded({ o: '2' }) },
      { cursor: 'this is not valid base64json' },
    ]) {
      await expect(callBrowserTool(ctx, 'browser_list', args)).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    }
  });

  it('rejects invalid tab references and conflicting optional claim fields', async () => {
    const ctx = fixture();
    for (const args of [
      { browserId: '', tabId: '1' },
      { browserId: 'a', tabId: -1 },
      { browserId: 'a', tabId: 1.5 },
      { browserId: 'a', tabId: 'not-an-id' },
      { browserId: 'a', tabId: '9007199254740992' },
      { browserId: 'a', tabId: 0, title: 99 },
      { browserId: 'a', tabId: 0, title: 'x'.repeat(257) },
      { browserId: 'a', tabId: 0, url: false },
    ]) {
      await expect(
        callBrowserTool(ctx, 'browser_claim_tab', args),
      ).rejects.toThrow('INVALID_ARGUMENT');
    }
    const result = await callBrowserTool(ctx, 'browser_claim_tab', {
      browserId: 'a',
      tabId: '2',
    });
    expect(result).toEqual({
      browserId: 'a',
      tabId: '2',
      claimedAt: 99,
    });
  });

  it('validates every optional script budget before submitting execution', async () => {
    const ctx = fixture();
    const base = { browserId: 'a', tabId: '1', script: 'return 1;' };
    for (const extra of [
      { script: 99 },
      { script: ' ' },
      { timeoutMs: -1 },
      { timeoutMs: 3.14 },
      { timeoutMs: 300_001 },
      { taskName: 1 },
      { taskName: 'x'.repeat(129) },
      { limits: [] },
      { limits: null },
      { limits: { maxOutputBytes: 0 } },
      { limits: { maxSteps: '5' } },
      { limits: { maxSteps: 1.5 } },
    ]) {
      await expect(
        callBrowserTool(ctx, 'browser_run_script', {
          ...base,
          ...extra,
        }),
      ).rejects.toThrow('INVALID_ARGUMENT');
    }
    expect(
      await callBrowserTool(ctx, 'browser_run_script', base),
    ).toMatchObject({ state: 'queued', executionId: 'exec-123' });
  });

  it('rejects missing execution IDs and invalid requested documentation topics', async () => {
    const ctx = fixture();
    for (const tool of ['browser_get_execution', 'browser_cancel_execution']) {
      await expect(callBrowserTool(ctx, tool, {})).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
      await expect(
        callBrowserTool(ctx, tool, {
          executionId: 'x'.repeat(129),
        }),
      ).rejects.toThrow('INVALID_ARGUMENT');
    }
    for (const topic of ['', [12], ['browser.tab.cdp', '']]) {
      await expect(
        callBrowserTool(ctx, 'browser_sdk_docs', { topic }),
      ).rejects.toThrow('INVALID_ARGUMENT');
    }
    await expect(
      callBrowserTool(ctx, 'not_a_browser_tool', {}),
    ).rejects.toThrow('INVALID_ARGUMENT');
  });

  it('describes automatic tab execution instead of requiring manual claiming', () => {
    const claim = BROWSER_TOOLS.find(
      (tool) => tool.name === 'browser_claim_tab',
    );
    const run = BROWSER_TOOLS.find(
      (tool) => tool.name === 'browser_run_script',
    );
    expect(claim?.description).toContain('manual claiming');
    expect(run?.description).toContain('automatically acquire');
  });
});
