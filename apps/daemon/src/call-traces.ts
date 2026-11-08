import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
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
        raw.params.name === 'browsers_list'
          ? 'browsers_list'
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
    const calls = this.db
      ? this.db
          .prepare('SELECT trace FROM call_traces ORDER BY rowid DESC')
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
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
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
