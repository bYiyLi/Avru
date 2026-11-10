/**
 * M4 execution audit. Stores only server-owned identifiers and fixed action
 * statuses; never scripts, bridge arguments/results, page text or secrets.
 * A separate SQLite file prevents browser identity data mixing with audit.
 */
import { chmodSync, closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ExecutionState, ExecutionStep } from './execution-types.js';

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 1024 * 1024 * 1024;
const MAX_STEPS = 32;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu;
const safeBrowser = /^[a-zA-Z0-9_-]{1,128}$/u;
const safeError = /^[A-Z_]{3,64}$/u;
const steps = new Set([
  'tabs.list',
  'tabs.get',
  'tabs.new',
  'tabs.close',
  'tabs.select',
  'tabs.selected',
  'tab.title',
  'cdp.send',
  'cdp.events',
  'cdp.cursor',
  'capabilities.list',
  'capabilities.get',
]);
const finalStates = new Set<ExecutionState>([
  'succeeded',
  'failed',
  'cancelled',
  'unknown',
]);

export interface AuditStep {
  stepId: string;
  method: string;
  durationMs: number;
  outcome: 'ok' | 'failed' | 'unknown';
  errorCode?: string;
}
export interface AuditEntry {
  executionId: string;
  traceId: string | null;
  requestId: string | null;
  browserId: string | null;
  tabId: number | null;
  submittedAt: number;
  startedAt: number | null;
  endedAt: number | null;
  state: ExecutionState;
  errorCode: string | null;
  steps: AuditStep[];
}
export interface AuditLimits {
  retentionMs?: number;
  maxBytes?: number;
}

function validId(value: string | undefined): string | null {
  return typeof value === 'string' && uuid.test(value) ? value : null;
}
function safeCode(code: string | undefined): string | null {
  return typeof code === 'string' && safeError.test(code) ? code : null;
}
function safeStep(step: ExecutionStep): AuditStep {
  const raw = step.result.startsWith('error:') ? step.result.slice(6) : null;
  const code = raw === null ? null : safeCode(raw);
  const outcome: AuditStep['outcome'] =
    code === 'UNKNOWN_RESULT' ? 'unknown' : raw !== null ? 'failed' : 'ok';
  return {
    stepId: validId(step.stepId) ?? 'unknown',
    method: steps.has(step.action) ? step.action : 'other',
    durationMs: Math.min(
      300_000,
      Math.max(0, Number.isFinite(step.durationMs) ? step.durationMs : 0),
    ),
    outcome,
    ...(code !== null ? { errorCode: code } : {}),
  };
}

export class ExecutionAudit {
  private readonly db: DatabaseSync;
  private readonly retentionMs: number;
  private readonly maxBytes: number;
  private readonly persistent: boolean;

  constructor(
    path = ':memory:',
    limits: AuditLimits = {},
    private readonly now: () => number = Date.now,
  ) {
    this.retentionMs = limits.retentionMs ?? RETENTION_MS;
    this.maxBytes = limits.maxBytes ?? MAX_BYTES;
    this.persistent = path !== ':memory:';
    if (
      !Number.isSafeInteger(this.retentionMs) ||
      this.retentionMs <= 0 ||
      !Number.isSafeInteger(this.maxBytes) ||
      this.maxBytes < 1
    )
      throw new Error('INVALID_AUDIT_LIMITS');
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      closeSync(openSync(path, 'a', 0o600));
      chmodSync(path, 0o600);
    }
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    // Cap SQLite database pages as well as logical audit rows. Small quotas
    // used in tests retain the logical policy because one SQLite page alone
    // exceeds their budget. WAL growth is managed separately by checkpoints.
    const page = this.db.prepare('PRAGMA page_size').get()?.page_size;
    if (this.persistent && typeof page === 'number' && this.maxBytes >= page) {
      const pages = Math.max(1, Math.floor(this.maxBytes / page));
      this.db.exec(`PRAGMA max_page_count=${String(pages)}`);
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS execution_audit (
      execution_id TEXT PRIMARY KEY,
      trace_id TEXT,
      request_id TEXT,
      browser_id TEXT,
      tab_id INTEGER,
      submitted_at INTEGER NOT NULL,
      started_at INTEGER,
      ended_at INTEGER,
      state TEXT NOT NULL,
      error_code TEXT,
      steps TEXT NOT NULL
    )`);
    // A previous process cannot prove the result of interrupted browser work.
    this.db.exec(`UPDATE execution_audit SET state='unknown',
      error_code='INTERRUPTED', ended_at=COALESCE(ended_at,submitted_at)
      WHERE state IN ('running','queued')`);
    this.prune();
  }

  begin(input: {
    executionId: string;
    traceId?: string;
    requestId?: string;
    browserId?: string;
    tabId?: number;
    submittedAt: number;
  }): void {
    if (!uuid.test(input.executionId)) throw new Error('INVALID_AUDIT_ID');
    const browserId =
      input.browserId && safeBrowser.test(input.browserId)
        ? input.browserId
        : null;
    const tabId =
      input.tabId !== undefined && Number.isSafeInteger(input.tabId)
        ? input.tabId
        : null;
    this.db
      .prepare(
        `INSERT INTO execution_audit (
      execution_id,trace_id,request_id,browser_id,tab_id,submitted_at,
      started_at,ended_at,state,error_code,steps
    ) VALUES (?,?,?,?,?,?,NULL,NULL,'queued',NULL,'[]')`,
      )
      .run(
        input.executionId,
        validId(input.traceId),
        validId(input.requestId),
        browserId,
        tabId,
        input.submittedAt,
      );
    this.prune();
  }

  start(executionId: string, time: number): void {
    this.db
      .prepare(
        `UPDATE execution_audit SET state='running',
      started_at=? WHERE execution_id=? AND state='queued'`,
      )
      .run(time, executionId);
  }

  append(executionId: string, step: ExecutionStep): void {
    const row = this.db
      .prepare('SELECT steps FROM execution_audit WHERE execution_id=?')
      .get(executionId);
    if (!row) return;
    const stored = JSON.parse(String(row.steps)) as AuditStep[];
    if (stored.length >= MAX_STEPS) return;
    stored.push(safeStep(step));
    this.db
      .prepare('UPDATE execution_audit SET steps=? WHERE execution_id=?')
      .run(JSON.stringify(stored), executionId);
  }

  finish(executionId: string, state: ExecutionState, code?: string): void {
    if (!finalStates.has(state)) throw new Error('INVALID_AUDIT_STATE');
    this.db
      .prepare(
        `UPDATE execution_audit SET state=?, ended_at=?,
      error_code=? WHERE execution_id=? AND state IN ('queued','running')`,
      )
      .run(state, this.now(), safeCode(code), executionId);
    this.prune();
  }

  remove(executionId: string): void {
    this.db
      .prepare('DELETE FROM execution_audit WHERE execution_id=?')
      .run(executionId);
  }

  snapshot() {
    this.prune();
    const rows = this.db
      .prepare(
        `SELECT
      execution_id, trace_id, request_id, browser_id, tab_id,
      submitted_at, started_at, ended_at, state, error_code, steps
      FROM execution_audit ORDER BY submitted_at DESC LIMIT 200`,
      )
      .all();
    const entries = rows.map((row): AuditEntry => ({
      executionId: String(row.execution_id),
      traceId: row.trace_id === null ? null : String(row.trace_id),
      requestId: row.request_id === null ? null : String(row.request_id),
      browserId: row.browser_id === null ? null : String(row.browser_id),
      tabId: row.tab_id === null ? null : Number(row.tab_id),
      submittedAt: Number(row.submitted_at),
      startedAt: row.started_at === null ? null : Number(row.started_at),
      endedAt: row.ended_at === null ? null : Number(row.ended_at),
      state: row.state as ExecutionState,
      errorCode: row.error_code === null ? null : String(row.error_code),
      steps: JSON.parse(String(row.steps)) as AuditStep[],
    }));
    return {
      entries,
      retention: {
        days: Math.ceil(this.retentionMs / 86_400_000),
        maxBytes: this.maxBytes,
        persistent: this.persistent,
      },
    };
  }

  close(): void {
    this.db.close();
  }

  private prune(): void {
    this.db
      .prepare('DELETE FROM execution_audit WHERE submitted_at < ?')
      .run(this.now() - this.retentionMs);
    // Bound stored data even if an installation receives more than 200 tasks.
    let size = this.db
      .prepare(
        `SELECT COALESCE(SUM(
      LENGTH(steps)+LENGTH(execution_id)+128),0) AS bytes
      FROM execution_audit`,
      )
      .get()?.bytes;
    while (typeof size === 'number' && size > this.maxBytes) {
      const removed = this.db
        .prepare(
          `DELETE FROM execution_audit WHERE
        execution_id=(SELECT execution_id FROM execution_audit
        ORDER BY submitted_at ASC, rowid ASC LIMIT 1)`,
        )
        .run();
      if (removed.changes === 0) break;
      size = this.db
        .prepare(
          `SELECT COALESCE(SUM(
        LENGTH(steps)+LENGTH(execution_id)+128),0) AS bytes
        FROM execution_audit`,
        )
        .get()?.bytes;
    }
  }
}
