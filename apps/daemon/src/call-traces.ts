import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { record } from './messages.js';
export type TraceCode =
  | 'notification_accepted'
  | 'authorized'
  | 'invalid_token'
  | 'unsupported_protocol_version'
  | 'not_acceptable'
  | 'completed'
  | 'protocol_error'
  | 'internal_error';
export type TraceStatus = 'succeeded' | 'rejected' | 'failed' | 'unknown';
export interface TraceSpan {
  spanId: string;
  parentSpanId: string | null;
  name: 'request' | 'authorization' | 'dispatch';
  startedAt: number;
  durationMs: number;
  status: TraceStatus;
  events: { at: number; code: string }[];
}
export interface CallTrace {
  traceId: string;
  requestId: string;
  startedAt: number;
  durationMs: number;
  status: TraceStatus;
  method: string;
  tool: string | null;
  spans: TraceSpan[];
}
const methods = new Set(['initialize', 'ping', 'tools/list', 'tools/call']);
const tools = new Set([
  'browser_list',
  'browser_claim_tab',
  'browser_run_script',
  'browser_get_execution',
  'browser_cancel_execution',
  'browser_sdk_docs',
]);
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export class CallTraces {
  private readonly calls: CallTrace[] = [];
  private readonly db: DatabaseSync | undefined;

  constructor(databasePath?: string) {
    if (databasePath !== undefined && databasePath !== ':memory:') {
      this.db = new DatabaseSync(databasePath);
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      this.db.exec(
        'CREATE TABLE IF NOT EXISTS call_traces (trace_id TEXT PRIMARY KEY, trace TEXT NOT NULL)',
      );
    }
  }
  /** Migrate sanitized request history from the previous browser database.
   * Preserve the source table for rollback and allow idempotent retries.
   */
  migrateLegacy(sourcePath: string): void {
    if (!this.db || !existsSync(sourcePath) || sourcePath === ':memory:')
      return;
    this.db.exec(`CREATE TABLE IF NOT EXISTS audit_migrations (
      name TEXT PRIMARY KEY
    )`);
    if (
      this.db
        .prepare(
          "SELECT name FROM audit_migrations WHERE name='legacy_call_traces_v1'",
        )
        .get()
    )
      return;
    const source = new DatabaseSync(sourcePath, { readOnly: true });
    try {
      const exists = source
        .prepare(
          `SELECT name FROM sqlite_master
        WHERE type='table' AND name='call_traces'`,
        )
        .get();
      if (!exists) return;
      const rows = source
        .prepare('SELECT trace_id,trace FROM call_traces ORDER BY rowid ASC')
        .all();
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const insert = this.db.prepare(
          'INSERT OR IGNORE INTO call_traces (trace_id,trace) VALUES (?,?)',
        );
        for (const row of rows)
          insert.run(String(row.trace_id), String(row.trace));
        this.prune();
        this.db.exec(`DELETE FROM call_traces WHERE rowid NOT IN (
          SELECT rowid FROM call_traces
          ORDER BY CAST(json_extract(trace,'$.startedAt') AS INTEGER)
          DESC, rowid DESC LIMIT 200)`);
        this.db
          .prepare('INSERT INTO audit_migrations(name) VALUES (?)')
          .run('legacy_call_traces_v1');
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    } finally {
      source.close();
    }
  }

  begin(raw: unknown) {
    const started = performance.now();
    const trace: CallTrace = {
      traceId: randomUUID(),
      requestId: randomUUID(),
      startedAt: Date.now(),
      durationMs: 0,
      status: 'unknown',
      method:
        record(raw) && typeof raw.method === 'string' && methods.has(raw.method)
          ? raw.method
          : 'other',
      tool:
        record(raw) &&
        raw.method === 'tools/call' &&
        raw.id !== undefined &&
        record(raw.params) &&
        typeof raw.params.name === 'string' &&
        tools.has(raw.params.name)
          ? raw.params.name
          : null,
      spans: [],
    };
    const root = this.span(trace, 'request', null);
    this.insert(trace);
    let finished = false;
    let stepStart = started;
    let stepAt = trace.startedAt;
    return {
      traceId: trace.traceId,
      requestId: trace.requestId,
      step: (
        name: 'authorization' | 'dispatch',
        status: TraceStatus,
        code: TraceCode,
      ) => {
        if (finished) return;
        const span = this.span(trace, name, root.spanId);
        span.startedAt = stepAt;
        span.durationMs = Math.max(0, performance.now() - stepStart);
        stepStart = performance.now();
        stepAt = Date.now();
        span.status = status;
        span.events.push({ at: Date.now(), code });
        this.update(trace);
      },
      finish: (status: TraceStatus, code: TraceCode) => {
        if (finished) return;
        finished = true;
        trace.status = status;
        trace.durationMs = Math.max(0, performance.now() - started);
        root.status = status;
        root.durationMs = trace.durationMs;
        root.events.push({ at: Date.now(), code });
        if (this.db) this.update(trace);
        else {
          this.calls.unshift(trace);
          this.calls.splice(200);
        }
      },
    };
  }
  snapshot() {
    this.prune();
    const calls = this.db
      ? this.db
          .prepare(
            `SELECT trace FROM call_traces
            ORDER BY CAST(json_extract(trace,'$.startedAt') AS INTEGER)
            DESC, rowid DESC`,
          )
          .all()
          .map((row) => JSON.parse(String(row.trace)) as CallTrace)
      : this.calls;
    return {
      calls: structuredClone(calls),
      retention: { limit: 200, persistent: this.db !== undefined },
    };
  }
  close(): void {
    this.db?.close();
  }
  private insert(trace: CallTrace): void {
    if (!this.db) return;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare('INSERT INTO call_traces (trace_id, trace) VALUES (?, ?)')
        .run(trace.traceId, JSON.stringify(trace));
      this.db.exec(
        'DELETE FROM call_traces WHERE rowid NOT IN (SELECT rowid FROM call_traces ORDER BY rowid DESC LIMIT 200)',
      );
      this.prune();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private prune(): void {
    const before = Date.now() - RETENTION_MS;
    if (this.db) {
      this.db
        .prepare(
          `DELETE FROM call_traces WHERE
        CAST(json_extract(trace,'$.startedAt') AS INTEGER) < ?`,
        )
        .run(before);
    } else {
      for (let index = this.calls.length - 1; index >= 0; index--)
        if ((this.calls[index]?.startedAt ?? Number.MAX_SAFE_INTEGER) < before)
          this.calls.splice(index, 1);
    }
  }

  private update(trace: CallTrace): void {
    this.db
      ?.prepare('UPDATE call_traces SET trace = ? WHERE trace_id = ?')
      .run(JSON.stringify(trace), trace.traceId);
  }
  private span(
    trace: CallTrace,
    name: TraceSpan['name'],
    parentSpanId: string | null,
  ): TraceSpan {
    const span: TraceSpan = {
      spanId: randomUUID(),
      parentSpanId,
      name,
      startedAt: Date.now(),
      durationMs: 0,
      status: 'unknown',
      events: [],
    };
    trace.spans.push(span);
    return span;
  }
}
