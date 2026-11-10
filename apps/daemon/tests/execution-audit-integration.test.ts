import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { ExecutionAudit } from '../src/execution-audit.js';
import { Executions } from '../src/executions.js';
import type { Connections } from '../src/connections.js';
import { callBrowserTool } from '../src/oauth/tools.js';
import { buildApp } from '../src/app.js';

const root = mkdtempSync(join(tmpdir(), 'avru-audit-integration-'));
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
process.on('exit', () => {
  rmSync(root, { recursive: true, force: true });
});

function fixture(
  result: unknown = { ok: true, value: { result: { value: 42 } } },
) {
  const path = join(root, randomUUID(), 'execution-audit.sqlite');
  const audit = new ExecutionAudit(path);
  const connections = {
    browsers: () => [
      {
        id: 'browser-a',
        connected: true,
        tabs: [
          {
            id: 7,
            title: 'Search',
            url: 'https://example.test/',
            active: true,
          },
        ],
      },
    ],
    generation: (id: string) => (id === 'browser-a' ? 1 : undefined),
    sendAction: () => Promise.resolve(result),
  } as unknown as Connections;
  const executions = new Executions(connections, audit);
  cleanup.push(() => {
    executions.close();
    audit.close();
  });
  return { executions, audit, path };
}

async function finished(executions: Executions, id: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const task = executions.get('grant-a', id);
    if (task.state !== 'queued' && task.state !== 'running') return task;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error('no execution result');
}

describe('MCP → execution → SDK → SQLite audit', () => {
  it('correlates server-owned MCP IDs to execution steps without raw scripts', async () => {
    const h = fixture();
    const traceId = randomUUID();
    const requestId = randomUUID();
    const script =
      'return await browser.tab.cdp.send("Runtime.evaluate",' +
      '{expression:"secret page data",returnByValue:true});';
    const submitted = (await callBrowserTool(
      {
        owner: 'grant-a',
        scopes: ['browser:read', 'browser:control'],
        executions: h.executions,
        audit: { traceId, requestId },
      },
      'browser_run_script',
      {
        browserId: 'browser-a',
        tabId: '7',
        script,
      },
    )) as { executionId: string };
    expect(await finished(h.executions, submitted.executionId)).toMatchObject({
      state: 'succeeded',
    });
    const [record] = h.audit.snapshot().entries;
    expect(record).toMatchObject({
      traceId,
      requestId,
      executionId: submitted.executionId,
      browserId: 'browser-a',
      tabId: 7,
      state: 'succeeded',
      errorCode: null,
      steps: [
        {
          method: 'cdp.send',
          outcome: 'ok',
        },
      ],
    });
    expect(record?.startedAt).not.toBeNull();
    expect(record?.endedAt).not.toBeNull();
    expect(JSON.stringify(record)).not.toContain('secret page data');
    expect(readFileSync(h.path).toString('utf8')).not.toContain(
      'secret page data',
    );
  });

  it('persists the uncertain terminal state if a dispatched action times out', async () => {
    const h = fixture({
      ok: false,
      error: { code: 'TIMEOUT', message: 'private server details' },
    });
    const submitted = h.executions.run(
      'grant-a',
      'return await browser.tab.cdp.send("Page.reload");',
      { browserId: 'browser-a', tabId: 7 },
    );
    expect(await finished(h.executions, submitted.executionId)).toMatchObject({
      state: 'unknown',
    });
    const [entry] = h.audit.snapshot().entries;
    expect(entry).toMatchObject({
      state: 'unknown',
      errorCode: 'UNKNOWN_RESULT',
      steps: [
        {
          method: 'cdp.send',
          outcome: 'unknown',
          errorCode: 'UNKNOWN_RESULT',
        },
      ],
    });
    expect(JSON.stringify(entry)).not.toContain('private server details');
  });

  it('uses a separate physical database and protects the local audit endpoint', async () => {
    const dataDir = join(root, randomUUID());
    const dbPath = join(dataDir, 'browsers.sqlite');
    const auditPath = join(dataDir, 'browsers-execution-audit.sqlite');
    const key = 'a'.repeat(64);
    const instance = buildApp({
      port: 43821,
      adminKey: key,
      databasePath: dbPath,
    });
    cleanup.push(() => instance.close());
    const host = '127.0.0.1:43821';
    const headers = {
      host,
      origin: `http://${host}`,
      authorization: `Bearer ${key}`,
    };
    const denied = await instance.inject({
      url: '/api/execution-audit',
      headers: { ...headers, origin: 'https://evil.test' },
    });
    expect(denied.statusCode).toBe(403);
    const allowed = await instance.inject({
      url: '/api/execution-audit',
      headers,
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({
      entries: [],
      retention: { days: 7, persistent: true },
    });
    const browserDb = new DatabaseSync(dbPath);
    const auditDb = new DatabaseSync(auditPath);
    try {
      const tableNames = (db: DatabaseSync) =>
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
          .map((row) => String(row.name));
      expect(tableNames(browserDb)).not.toContain('execution_audit');
      expect(tableNames(auditDb)).toContain('execution_audit');
      expect(tableNames(auditDb)).not.toContain('browsers');
    } finally {
      auditDb.close();
      browserDb.close();
    }
  });
});
