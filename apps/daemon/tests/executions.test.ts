import { afterEach, describe, expect, it } from 'vitest';
import { Executions } from '../src/executions';
import type { Connections } from '../src/connections';
import { SDK_CAPABILITIES } from '../../../packages/runner/src/sdk';

const instances: Executions[] = [];
function fixture() {
  const connections = {
    browsers: () => [
      {
        id: 'a',
        name: 'A',
        connected: true,
        tabs: [{ id: 12, title: 'A', url: 'https://a.example/', active: true }],
      },
      {
        id: 'b',
        name: 'B',
        connected: true,
        tabs: [
          { id: 12, title: 'B', url: 'https://b.example/', active: false },
        ],
      },
    ],
    generation: () => 1,
    action: (browserId: string, tabId: number, method: string) =>
      Promise.resolve(
        method === 'tab.title'
          ? `${browserId}:${String(tabId)}`
          : { text: 'page', truncated: false },
      ),
  } as unknown as Connections;
  const executions = new Executions(connections);
  instances.push(executions);
  return executions;
}
async function completed(
  executions: Executions,
  owner: string,
  executionId: string,
) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const entry = executions.get(owner, executionId);
    if (entry.state !== 'running' && entry.state !== 'queued') return entry;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error('execution did not finish');
}

afterEach(() => {
  for (const instance of instances.splice(0)) instance.close();
});
describe('real QuickJS process integration', () => {
  it('lists design BrowserTabs for all connected browsers', async () => {
    const executions = fixture();
    const listed = executions.run(
      'owner-a',
      'return await browser.tabs.list();',
    );
    expect(listed.state).toBe('running');
    expect(
      await completed(executions, 'owner-a', listed.executionId),
    ).toMatchObject({
      state: 'succeeded',
      result: [
        {
          browserId: 'a',
          tabId: '12',
          generation: 1,
          title: 'A',
          url: 'https://a.example/',
          active: true,
          claimed: false,
        },
        {
          browserId: 'b',
          tabId: '12',
          generation: 1,
          title: 'B',
          url: 'https://b.example/',
          active: false,
          claimed: false,
        },
      ],
    });
  });
  it('reads tab.title through the extension hop on a claimed target', async () => {
    const executions = fixture();
    executions.claimTab('owner-a', 'b', 12);
    const selected = executions.run(
      'owner-a',
      'return await browser.tab.title();',
      { browserId: 'b', tabId: 12 },
    );
    expect(
      await completed(executions, 'owner-a', selected.executionId),
    ).toMatchObject({ state: 'succeeded', result: 'b:12' });
  });
  it('scopes tabs.get to the task target browser (same tabId elsewhere is not substituted)', async () => {
    const executions = fixture();
    executions.claimTab('owner-a', 'b', 12);
    const got = executions.run(
      'owner-a',
      "return await browser.tabs.get('12');",
      { browserId: 'b', tabId: 12 },
    );
    expect(
      await completed(executions, 'owner-a', got.executionId),
    ).toMatchObject({
      state: 'succeeded',
      result: { browserId: 'b', tabId: '12', title: 'B' },
    });
  });
  it('automatically reserves an AI-selected tab without a manual claim step', async () => {
    const executions = fixture();
    const selected = executions.run(
      'owner-a',
      'return await browser.tab.title();',
      { browserId: 'b', tabId: 12 },
    );
    expect(executions.isClaimed('b', 12)).toBe(true);
    expect(() => executions.claimTab('owner-b', 'b', 12)).toThrow(
      'TAB_ALREADY_CLAIMED',
    );
    expect(
      await completed(executions, 'owner-a', selected.executionId),
    ).toMatchObject({
      state: 'succeeded',
      result: 'b:12',
    });
    expect(executions.isClaimed('b', 12)).toBe(false);
    const next = executions.run(
      'owner-b',
      'return await browser.tab.title();',
      { browserId: 'b', tabId: 12 },
    );
    expect(
      await completed(executions, 'owner-b', next.executionId),
    ).toMatchObject({
      state: 'succeeded',
      result: 'b:12',
    });
  });
  it('rejects a claim whose snapshot does not match live metadata', () => {
    const executions = fixture();
    expect(() =>
      executions.claimTab('owner-a', 'b', 12, { title: 'Not B' }),
    ).toThrow('INVALID_TARGET');
    expect(() =>
      executions.claimTab('owner-a', 'b', 12, {
        url: 'https://other.example/',
      }),
    ).toThrow('INVALID_TARGET');
    expect(
      executions.claimTab('owner-a', 'b', 12, { title: 'B' }),
    ).toMatchObject({ browserId: 'b', tabId: 12, title: 'B' });
  });
  it('isolates execution results by authenticated grant owner', async () => {
    const executions = fixture();
    const submitted = executions.run('owner-a', 'return 42;');
    expect(() => executions.get('owner-b', submitted.executionId)).toThrow(
      'EXECUTION_NOT_FOUND',
    );
    expect(
      (await completed(executions, 'owner-a', submitted.executionId)).result,
    ).toBe(42);
  });
  it('reports CPU-only timeouts as failures, not unknown browser side effects', async () => {
    const executions = fixture();
    const task = executions.run('owner-a', 'while (true) {}', undefined, {
      timeoutMs: 75,
    });
    const result = await completed(executions, 'owner-a', task.executionId);
    expect(result.state).toBe('failed');
    expect(result.error).toMatchObject({ code: 'TIMEOUT' });
  });
  it('cancels a queued execution at once and a running one after the kill', async () => {
    const executions = fixture();
    const blocker = executions.run('owner-a', 'while (true) {}', undefined, {
      timeoutMs: 30_000,
    });
    expect(blocker.state).toBe('running');
    const queued = executions.run('owner-a', 'return 1;');
    expect(queued.state).toBe('queued');
    const cancelledQueued = await executions.cancel(
      'owner-a',
      queued.executionId,
    );
    expect(cancelledQueued.state).toBe('cancelled');
    expect(cancelledQueued.pendingStepsCancelled).toBe(0);
    const cancelledRunning = await executions.cancel(
      'owner-a',
      blocker.executionId,
    );
    expect(cancelledRunning.state).toBe('cancelled');
    expect(executions.get('owner-a', blocker.executionId).error).toMatchObject({
      code: 'CANCELLED',
    });
  });
  it('rejects the ninth waiting task with QUEUE_FULL (8 waiting / 1 running)', async () => {
    const executions = fixture();
    const blocker = executions.run('owner-a', 'while (true) {}', undefined, {
      timeoutMs: 30_000,
    });
    const queued: string[] = [];
    for (let i = 0; i < 8; i++)
      queued.push(executions.run('owner-a', 'return 1;').executionId);
    expect(() => executions.run('owner-a', 'return 1;')).toThrow('QUEUE_FULL');
    await executions.cancel('owner-a', blocker.executionId);
    for (const id of queued)
      expect((await completed(executions, 'owner-a', id)).state).toBe(
        'succeeded',
      );
  });
  it('records one step per bridge call with ok / error:<CODE> results', async () => {
    const executions = fixture();
    executions.claimTab('owner-a', 'b', 12);
    const task = executions.run(
      'owner-a',
      'await browser.tabs.list(); return await browser.tab.title();',
      { browserId: 'b', tabId: 12 },
    );
    const entry = await completed(executions, 'owner-a', task.executionId);
    expect(entry.state).toBe('succeeded');
    expect(entry.steps).toHaveLength(2);
    expect(entry.steps.map((step) => step.action)).toEqual([
      'tabs.list',
      'tab.title',
    ]);
    expect(entry.steps.every((step) => step.result === 'ok')).toBe(true);
    expect(entry.steps[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });
  it('rejects an over-limit script at submit with SCRIPT_TOO_LARGE', () => {
    const executions = fixture();
    expect(() => executions.run('owner-a', 'x'.repeat(65_537))).toThrow(
      'SCRIPT_TOO_LARGE',
    );
  });
  it('answers capabilities.list/get from the static minimal set', async () => {
    const executions = fixture();
    const listed = executions.run(
      'owner-a',
      'return await browser.capabilities.list();',
    );
    const list = await completed(executions, 'owner-a', listed.executionId);
    expect(list.state).toBe('succeeded');
    expect(
      (list.result as { name: string }[]).map((item) => item.name),
    ).toEqual(SDK_CAPABILITIES.map((item) => item.name));
    expect(SDK_CAPABILITIES.map((item) => item.name)).toEqual(
      expect.arrayContaining([
        'tab.click',
        'tab.fill',
        'tab.waitFor',
        'tab.locator',
        'cdp.send',
        'cdp.events',
      ]),
    );
    const got = executions.run(
      'owner-a',
      "return await browser.capabilities.get('tab.title');",
    );
    expect(
      await completed(executions, 'owner-a', got.executionId),
    ).toMatchObject({
      state: 'succeeded',
      result: { name: 'tab.title', supported: true },
    });
  });
});
