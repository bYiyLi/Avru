import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Executions } from '../src/executions';
import { createMcpServer } from '../src/oauth/mcp';
import {
  BROWSER_TOOLS,
  callBrowserTool,
  toolErrorText,
} from '../src/oauth/tools';
import type { ToolContext } from '../src/oauth/tools';

const ALL_SCOPES = ['browser:read', 'browser:control'];
const READ_ONLY = ['browser:read'];

function stubExecutions() {
  return {
    browsers: () => [
      {
        id: 'a',
        name: 'A',
        connected: true,
        tabs: [
          { id: 12, title: 'A', url: 'https://a.example/', active: true },
          { id: 13, title: 'A2', url: 'https://a.example/2', active: false },
        ],
      },
      {
        id: 'b',
        name: 'B',
        connected: false,
        tabs: [{ id: 7, title: 'B', url: 'https://b.example/', active: true }],
      },
    ],
    isClaimed: () => false,
    claimTab: vi.fn((_owner: string, browserId: string, tabId: number) => ({
      browserId,
      tabId,
      title: 'A',
      url: 'https://a.example/',
      claimedAt: 123,
    })),
    run: vi.fn(() => ({
      executionId: 'exec-1',
      state: 'queued' as const,
      submittedAt: 456,
    })),
    get: vi.fn(() => ({
      executionId: 'exec-1',
      state: 'succeeded' as const,
      submittedAt: 1,
      result: 42,
      steps: [],
    })),
    cancel: vi.fn(() =>
      Promise.resolve({
        executionId: 'exec-1',
        state: 'cancelled' as const,
        completedSteps: [],
        pendingStepsCancelled: 0,
      }),
    ),
  } as unknown as Executions;
}

function ctx(
  executions: Executions | undefined,
  scopes: string[] = ALL_SCOPES,
): ToolContext {
  return { executions, owner: 'owner-a', scopes };
}

const servers: { close: () => Promise<void> }[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

describe('MCP tool dispatch (T7)', () => {
  it('lists the six browser tools through the official SDK server', async () => {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createMcpServer(ctx(stubExecutions()));
    servers.push(server);
    await server.connect(serverTransport);
    const client = new Client(
      { name: 'test', version: '0.0.0' },
      { capabilities: {} },
    );
    await client.connect(clientTransport);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual([
        'browser_list',
        'browser_claim_tab',
        'browser_run_script',
        'browser_get_execution',
        'browser_cancel_execution',
        'browser_sdk_docs',
      ]);
      expect(BROWSER_TOOLS).toHaveLength(6);
      const called = await client.callTool({
        name: 'browser_sdk_docs',
        arguments: {},
      });
      expect(called.isError).toBeFalsy();
      const text = (called.content as { type: string; text: string }[])[0]
        ?.text;
      const docs = JSON.parse(text ?? '{}') as {
        version: unknown;
        index: { topic: string }[];
      };
      expect(typeof docs.version).toBe('string');
      expect(
        docs.index.some((item) => item.topic === 'browser.tab.title'),
      ).toBe(true);
      const rejected = await client.callTool({
        name: 'not_an_avru_tool',
        arguments: {},
      });
      expect(rejected.isError).toBe(true);
    } finally {
      await client.close();
    }
  });
  it('browser_list returns connected browsers only, in the design shape, paged', async () => {
    const executions = stubExecutions();
    const first = (await callBrowserTool(ctx(executions), 'browser_list', {
      limit: 1,
    })) as {
      browsers: unknown[];
      total: number;
      nextCursor?: string;
    };
    expect(first.browsers).toHaveLength(1);
    expect(first.total).toBe(1);
    expect(first.nextCursor).toBeUndefined();
    expect(first.browsers[0]).toEqual({
      browserId: 'a',
      name: 'A',
      type: 'extension',
      tabs: [
        { tabId: '12', title: 'A', url: 'https://a.example/', claimed: false },
        {
          tabId: '13',
          title: 'A2',
          url: 'https://a.example/2',
          claimed: false,
        },
      ],
    });
    const filtered = (await callBrowserTool(ctx(executions), 'browser_list', {
      browserId: 'b',
    })) as { browsers: unknown[]; total: number };
    expect(filtered).toEqual({ browsers: [], total: 0 });
    await expect(
      callBrowserTool(ctx(executions), 'browser_list', { limit: 0 }),
    ).rejects.toThrow('INVALID_ARGUMENT');
    await expect(
      callBrowserTool(ctx(executions), 'browser_list', {
        cursor: 'not-base64!!!',
      }),
    ).rejects.toThrow('INVALID_ARGUMENT');
  });
  it('browser_claim_tab normalizes a numeric-string tabId and passes the snapshot', async () => {
    const executions = stubExecutions();
    const claimTab = vi.spyOn(executions, 'claimTab');
    const result = await callBrowserTool(ctx(executions), 'browser_claim_tab', {
      browserId: 'a',
      tabId: '12',
      title: 'A',
    });
    expect(result).toEqual({
      browserId: 'a',
      tabId: '12',
      title: 'A',
      url: 'https://a.example/',
      claimedAt: 123,
    });
    expect(claimTab).toHaveBeenCalledWith('owner-a', 'a', 12, {
      title: 'A',
    });
    await callBrowserTool(ctx(executions), 'browser_claim_tab', {
      browserId: 'a',
      tabId: 12,
    });
    expect(claimTab).toHaveBeenCalledWith('owner-a', 'a', 12, {});
  });
  it('browser_run_script validates input and returns immediately', async () => {
    const executions = stubExecutions();
    const run = vi.spyOn(executions, 'run');
    const result = await callBrowserTool(
      ctx(executions),
      'browser_run_script',
      {
        browserId: 'a',
        tabId: '12',
        script: 'return 1;',
        taskName: 't',
        timeoutMs: 1000,
        limits: { maxOutputBytes: 100, maxSteps: 2 },
      },
    );
    expect(result).toEqual({
      executionId: 'exec-1',
      state: 'queued',
      submittedAt: 456,
    });
    expect(run).toHaveBeenCalledWith(
      'owner-a',
      'return 1;',
      { browserId: 'a', tabId: 12 },
      {
        timeoutMs: 1000,
        taskName: 't',
        limits: { maxOutputBytes: 100, maxSteps: 2 },
      },
    );
    await expect(
      callBrowserTool(ctx(executions), 'browser_run_script', {
        browserId: 'a',
        tabId: '12',
        script: '   ',
      }),
    ).rejects.toThrow('INVALID_ARGUMENT');
    await expect(
      callBrowserTool(ctx(executions), 'browser_run_script', {
        browserId: 'a',
        tabId: '12',
        script: 'return 1;',
        timeoutMs: 0,
      }),
    ).rejects.toThrow('INVALID_ARGUMENT');
  });
});

describe('MCP tool validation (T7)', () => {
  it('rejects undeclared arguments (additionalProperties: false)', async () => {
    const executions = stubExecutions();
    await expect(
      callBrowserTool(ctx(executions), 'browser_list', { unexpected: 1 }),
    ).rejects.toThrow('INVALID_ARGUMENT');
    await expect(
      callBrowserTool(ctx(executions), 'browser_run_script', {
        browserId: 'a',
        tabId: '12',
        script: 'return 1;',
        bogus: true,
      }),
    ).rejects.toThrow('INVALID_ARGUMENT');
  });
  it('browser_get_execution and browser_cancel_execution delegate to the runtime', async () => {
    const executions = stubExecutions();
    const get = vi.spyOn(executions, 'get');
    const cancel = vi.spyOn(executions, 'cancel');
    expect(
      await callBrowserTool(ctx(executions), 'browser_get_execution', {
        executionId: 'exec-1',
      }),
    ).toMatchObject({ executionId: 'exec-1', state: 'succeeded' });
    expect(get).toHaveBeenCalledWith('owner-a', 'exec-1');
    expect(
      await callBrowserTool(ctx(executions), 'browser_cancel_execution', {
        executionId: 'exec-1',
      }),
    ).toMatchObject({ executionId: 'exec-1', state: 'cancelled' });
    expect(cancel).toHaveBeenCalledWith('owner-a', 'exec-1');
  });
  it('returns AX write observations as model-visible image content', async () => {
    const executions = stubExecutions();
    vi.spyOn(executions, 'get').mockReturnValue({
      executionId: 'exec-1',
      state: 'succeeded',
      submittedAt: 1,
      result: null,
      steps: [],
      observations: [
        {
          mode: 'both',
          state: '[0] button Search',
          screenshot: { data: '/9j/AA==', mimeType: 'image/jpeg' },
        },
      ],
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createMcpServer(ctx(executions));
    servers.push(server);
    await server.connect(serverTransport);
    const client = new Client(
      { name: 'observation-test', version: '0.0.0' },
      { capabilities: {} },
    );
    await client.connect(clientTransport);
    try {
      const called = await client.callTool({
        name: 'browser_get_execution',
        arguments: { executionId: 'exec-1' },
      });
      expect(called.isError).toBeFalsy();
      const content = called.content as { type: string; text?: string }[];
      expect(content.some((item) => item.type === 'image')).toBe(true);
      const text = content.find((item) => item.type === 'text');
      expect(text?.type === 'text' ? text.text : '').toContain('button Search');
    } finally {
      await client.close();
    }
  });
  it('browser_sdk_docs answers index, one topic, and many topics in order', async () => {
    const noTopic = await callBrowserTool(
      ctx(undefined),
      'browser_sdk_docs',
      {},
    );
    const docs = noTopic as { version: unknown; index: { topic: string }[] };
    expect(typeof docs.version).toBe('string');
    expect(docs.index.some((item) => item.topic === 'browser.tab.title')).toBe(
      true,
    );
    const one = (await callBrowserTool(ctx(undefined), 'browser_sdk_docs', {
      topic: 'browser.tab.title',
    })) as { documents: { topic: string; title: string; content: string }[] };
    expect(one.documents).toHaveLength(1);
    expect(one.documents[0]?.topic).toBe('browser.tab.title');
    expect(one.documents[0]?.content).toContain('tab.title');
    const many = (await callBrowserTool(ctx(undefined), 'browser_sdk_docs', {
      topic: ['mcp.browser_list', 'browser.tab.title'],
    })) as { documents: { topic: string }[] };
    expect(many.documents.map((item) => item.topic)).toEqual([
      'mcp.browser_list',
      'browser.tab.title',
    ]);
    await expect(
      callBrowserTool(ctx(undefined), 'browser_sdk_docs', {
        topic: 'missing.method',
      }),
    ).rejects.toThrow('TOPIC_NOT_FOUND: missing.method');
  });
  it('enforces per-tool scopes (read vs control)', async () => {
    const executions = stubExecutions();
    await expect(
      callBrowserTool(ctx(executions, READ_ONLY), 'browser_claim_tab', {
        browserId: 'a',
        tabId: '12',
      }),
    ).rejects.toThrow('PERMISSION_DENIED');
    await expect(
      callBrowserTool(ctx(executions, ['browser:control']), 'browser_list', {}),
    ).rejects.toThrow('PERMISSION_DENIED');
    await expect(
      callBrowserTool(ctx(executions, READ_ONLY), 'browser_list', {}),
    ).resolves.toBeDefined();
    await expect(
      callBrowserTool(ctx(executions, READ_ONLY), 'browser_sdk_docs', {}),
    ).resolves.toBeDefined();
  });
  it('reports DAEMON_UNAVAILABLE for runtime tools without a runtime', async () => {
    await expect(
      callBrowserTool(ctx(undefined), 'browser_list', {}),
    ).rejects.toThrow('DAEMON_UNAVAILABLE');
    await expect(
      callBrowserTool(ctx(undefined), 'browser_get_execution', {
        executionId: 'x',
      }),
    ).rejects.toThrow('DAEMON_UNAVAILABLE');
    await expect(
      callBrowserTool(ctx(undefined), 'browser_sdk_docs', {}),
    ).resolves.toBeDefined();
  });
  it('maps tool errors to text (known codes pass, anything else is INTERNAL_ERROR)', () => {
    expect(toolErrorText(new Error('INVALID_TARGET'))).toBe('INVALID_TARGET');
    expect(toolErrorText(new Error('TOPIC_NOT_FOUND: missing.method'))).toBe(
      'TOPIC_NOT_FOUND: missing.method',
    );
    expect(toolErrorText(new Error('something went wrong'))).toBe(
      'INTERNAL_ERROR',
    );
    expect(toolErrorText('not an error')).toBe('INTERNAL_ERROR');
  });
});
