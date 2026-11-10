import { afterEach, describe, expect, it, vi } from 'vitest';
import { Executions } from '../src/executions';
import type { Connections } from '../src/connections';

type SyntheticOutcome =
  | { ok: false; error: { code: string; message: string } }
  | { ok: true; value: { result: { value: number } } };

const instances: Executions[] = [];
function fixture(errorCode?: string) {
  const sendAction = vi.fn((request: unknown): Promise<SyntheticOutcome> => {
    expect(request).toEqual(
      expect.objectContaining({ browserId: 'a', generation: 1 }),
    );
    if (errorCode)
      return Promise.resolve({
        ok: false as const,
        error: { code: errorCode, message: 'action response was not received' },
      });
    return Promise.resolve({
      ok: true as const,
      value: { result: { value: 2 } },
    });
  });
  const connections = {
    browsers: () => [
      {
        id: 'a',
        connected: true,
        tabs: [
          {
            id: 12,
            title: 'Main',
            url: 'https://example.test/',
            active: true,
          },
        ],
      },
    ],
    generation: () => 1,
    sendAction,
  } as unknown as Connections;
  const executions = new Executions(connections);
  instances.push(executions);
  return { executions, sendAction };
}

/** Lifecycle signals are decorative; count actual browser operations only. */
function actionCalls(
  sendAction: ReturnType<typeof fixture>['sendAction'],
  method: string,
) {
  return sendAction.mock.calls.filter(
    ([request]) => (request as { method: string }).method === method,
  );
}

async function terminal(executions: Executions, executionId: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const entry = executions.get('owner-a', executionId);
    if (entry.state !== 'running' && entry.state !== 'queued') return entry;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error('script did not reach a terminal state');
}

afterEach(() => {
  for (const instance of instances.splice(0)) instance.close();
});

describe('uncertain browser side effects', () => {
  it('marks a timed-out CDP action unknown rather than a safe script failure', async () => {
    const h = fixture('TIMEOUT');
    const running = h.executions.run(
      'owner-a',
      'return await browser.tab.cdp.send("Page.reload");',
      { browserId: 'a', tabId: 12 },
    );
    const entry = await terminal(h.executions, running.executionId);
    expect(entry.state).toBe('unknown');
    expect(entry.error?.code).toBe('UNKNOWN_RESULT');
    expect(entry.error?.message).toContain('may have completed');
    expect(typeof entry.error?.step).toBe('string');
    expect(entry.steps).toEqual([
      expect.objectContaining({
        action: 'cdp.send',
        result: 'error:UNKNOWN_RESULT',
      }),
    ]);
    expect(actionCalls(h.sendAction, 'cdp.send')).toHaveLength(1);
  });

  it('marks a disconnected extension after a tab close as unknown', async () => {
    const h = fixture('EXTENSION_OFFLINE');
    const running = h.executions.run(
      'owner-a',
      'return await browser.tabs.close("98");',
      { browserId: 'a', tabId: 12 },
    );
    const entry = await terminal(h.executions, running.executionId);
    expect(entry.state).toBe('unknown');
    expect(entry.error?.code).toBe('UNKNOWN_RESULT');
    expect(entry.steps).toEqual([
      expect.objectContaining({
        action: 'tabs.close',
        result: 'error:UNKNOWN_RESULT',
      }),
    ]);
    expect(actionCalls(h.sendAction, 'tabs.close')).toHaveLength(1);
  });

  it('does not turn a successfully acknowledged CDP action into unknown', async () => {
    const h = fixture();
    const running = h.executions.run(
      'owner-a',
      'return await browser.tab.cdp.send("Runtime.evaluate", {expression:"1 + 1"});',
      { browserId: 'a', tabId: 12 },
    );
    const entry = await terminal(h.executions, running.executionId);
    expect(entry).toMatchObject({
      state: 'succeeded',
      result: { result: { value: 2 } },
    });
    expect(actionCalls(h.sendAction, 'cdp.send')).toHaveLength(1);
  });

  it('does not report a safe cancellation while a browser write is unresolved', async () => {
    const h = fixture();
    h.sendAction.mockImplementation((request: unknown) => {
      if ((request as { method: string }).method === 'cdp.send')
        return new Promise<SyntheticOutcome>(() => {
          // The extension might already have performed this action.
        });
      return Promise.resolve({
        ok: true as const,
        value: { result: { value: 2 } },
      });
    });
    const running = h.executions.run(
      'owner-a',
      'return await browser.tab.cdp.send("Page.reload");',
      { browserId: 'a', tabId: 12 },
    );
    await vi.waitFor(
      () => {
        expect(actionCalls(h.sendAction, 'cdp.send')).toHaveLength(1);
      },
      { timeout: 5_000 },
    );
    const cancelled = await h.executions.cancel('owner-a', running.executionId);
    expect(cancelled.pendingStepsCancelled).toBeGreaterThan(0);
    expect(cancelled.state).toBe('unknown');
    const settled = h.executions.get('owner-a', running.executionId);
    expect(settled.error?.code).toBe('UNKNOWN_RESULT');
  });
});
