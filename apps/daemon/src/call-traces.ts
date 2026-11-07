import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
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
      },
      finish: (status: TraceStatus, code: TraceCode) => {
        if (finished) return;
        finished = true;
        trace.status = status;
        trace.durationMs = Math.max(0, performance.now() - started);
        root.status = status;
        root.durationMs = trace.durationMs;
        root.events.push({ at: Date.now(), code });
        this.calls.unshift(trace);
        this.calls.splice(200);
      },
    };
  }
  snapshot() {
    return {
      calls: structuredClone(this.calls),
      retention: { limit: 200, persistent: false },
    };
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
