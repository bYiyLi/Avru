import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { ExecutionAudit } from '../src/execution-audit.js';

const root = mkdtempSync(join(tmpdir(), 'avru-audit-test-'));
let tick = Date.now();
const instances: ExecutionAudit[] = [];
function fixture(limits?: { retentionMs?: number; maxBytes?: number }) {
  const path = join(root, randomUUID(), 'audit.sqlite');
  const audit = new ExecutionAudit(path, limits, () => tick);
  instances.push(audit);
  return { audit, path };
}
afterEach(() => {
  for (const audit of instances.splice(0)) audit.close();
  tick = Date.now();
});
process.on('exit', () => {
  rmSync(root, { recursive: true, force: true });
});

describe('dedicated SQLite execution audit', () => {
  it('does not describe an in-memory audit as durable', () => {
    const audit = new ExecutionAudit(':memory:');
    try {
      expect(audit.snapshot().retention).toMatchObject({
        persistent: false,
        days: 7,
      });
    } finally {
      audit.close();
    }
  });

  it('reports the configured quota on persistent databases', () => {
    const { audit, path } = fixture();
    const db = new DatabaseSync(path);
    try {
      // max_page_count is connection-local and is configured again when the
      // daemon opens its audit writer, not on this independent inspection DB.
      expect(db.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('wal');
      expect(audit.snapshot().retention).toMatchObject({
        persistent: true,
        maxBytes: 1024 * 1024 * 1024,
      });
    } finally {
      db.close();
    }
  });

  it('stores request / execution correlation and sanitizes every browser step', () => {
    const { audit, path } = fixture();
    const executionId = randomUUID();
    const traceId = randomUUID();
    const requestId = randomUUID();
    const secret = 'private-cookie-value';
    audit.begin({
      executionId,
      traceId,
      requestId,
      submittedAt: tick,
      browserId: 'browser_a',
      tabId: 7,
    });
    audit.start(executionId, tick + 10);
    audit.append(executionId, {
      stepId: randomUUID(),
      action: 'cdp.send',
      durationMs: 123,
      result: 'ok',
    });
    audit.append(executionId, {
      stepId: randomUUID(),
      action: `tab.${secret}`,
      durationMs: 10,
      result: `error:${secret}`,
    });
    audit.finish(executionId, 'unknown', 'UNKNOWN_RESULT');
    const entries = audit.snapshot().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      executionId,
      traceId,
      requestId,
      state: 'unknown',
      browserId: 'browser_a',
      tabId: 7,
      errorCode: 'UNKNOWN_RESULT',
      steps: [
        { method: 'cdp.send', outcome: 'ok', durationMs: 123 },
        { method: 'other', outcome: 'failed', durationMs: 10 },
      ],
    });
    expect(JSON.stringify(entries)).not.toContain(secret);
    expect(readFileSync(path).includes(Buffer.from(secret))).toBe(false);
    expect(statSync(path).mode & 0o077).toBe(0);
  });

  it('never stores scripts, arguments, page text or results', () => {
    const { audit, path } = fixture();
    const executionId = randomUUID();
    audit.begin({
      executionId,
      traceId: 'not-a-trace-id',
      requestId: 'not-a-request-id',
      browserId: 'https://private.invalid/?token=secret',
      tabId: Number.NaN,
      submittedAt: tick,
    });
    audit.append(executionId, {
      stepId: 'cookie',
      action: 'Storage.getCookies',
      durationMs: Number.POSITIVE_INFINITY,
      result: 'error:UNKNOWN_RESULT',
    });
    const [entry] = audit.snapshot().entries;
    expect(entry).toMatchObject({
      traceId: null,
      requestId: null,
      browserId: null,
      tabId: null,
      steps: [
        {
          stepId: 'unknown',
          method: 'other',
          durationMs: 0,
          outcome: 'unknown',
          errorCode: 'UNKNOWN_RESULT',
        },
      ],
    });
    expect(JSON.stringify(entry)).not.toContain('token=');
    expect(readFileSync(path).toString('utf8')).not.toContain('cookie');
  });

  it('recovers an interrupted task as unknown across a daemon restart', () => {
    const { audit, path } = fixture();
    const executionId = randomUUID();
    audit.begin({ executionId, submittedAt: tick });
    audit.start(executionId, tick);
    audit.close();
    instances.splice(instances.indexOf(audit), 1);
    const restarted = new ExecutionAudit(path, {}, () => tick);
    instances.push(restarted);
    const [entry] = restarted.snapshot().entries;
    expect(entry).toMatchObject({
      state: 'unknown',
      errorCode: 'INTERRUPTED',
      executionId,
    });
    restarted.finish(executionId, 'succeeded');
    expect(restarted.snapshot().entries[0]?.state).toBe('unknown');
  });

  it('removes traces older than seven days without deleting recent records', () => {
    const { audit } = fixture();
    const old = randomUUID();
    const young = randomUUID();
    audit.begin({ executionId: old, submittedAt: tick });
    tick += 7 * 86_400_000 + 1;
    audit.begin({ executionId: young, submittedAt: tick });
    expect(audit.snapshot().entries.map((row) => row.executionId)).toEqual([
      young,
    ]);
  });

  it('prunes oldest records when a small configured size budget is reached', () => {
    const { audit } = fixture({ maxBytes: 380 });
    for (let i = 0; i < 4; i++) {
      const executionId = randomUUID();
      tick++;
      audit.begin({ executionId, submittedAt: tick });
      audit.finish(executionId, 'succeeded');
    }
    const remaining = audit.snapshot().entries;
    expect(remaining.length).toBeGreaterThan(0);
    expect(remaining.length).toBeLessThan(4);
  });

  it('ignores unknown steps and rejects illegal audit lifecycle transitions', () => {
    const { audit } = fixture();
    audit.append(randomUUID(), {
      stepId: randomUUID(),
      action: 'cdp.send',
      durationMs: 1,
      result: 'ok',
    });
    expect(() => {
      audit.begin({ executionId: 'bad-id', submittedAt: tick });
    }).toThrow('INVALID_AUDIT_ID');
    const executionId = randomUUID();
    audit.begin({ executionId, submittedAt: tick });
    expect(() => {
      audit.finish(executionId, 'running');
    }).toThrow('INVALID_AUDIT_STATE');
    audit.remove(executionId);
    expect(audit.snapshot().entries).toEqual([]);
  });

  it('keeps a distinct execution_audit table with WAL enabled', () => {
    const { audit, path } = fixture();
    const db = new DatabaseSync(path);
    try {
      expect(db.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('wal');
      expect(
        db.prepare('SELECT count(*) AS n FROM execution_audit').get()?.n,
      ).toBe(0);
      expect(audit.snapshot().retention.days).toBe(7);
    } finally {
      db.close();
    }
  });
});
