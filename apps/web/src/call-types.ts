export type CallStatus = 'succeeded' | 'rejected' | 'failed' | 'unknown';
export interface CallSpan {
  spanId: string;
  parentSpanId: string | null;
  name: 'request' | 'authorization' | 'dispatch';
  startedAt: number;
  durationMs: number;
  status: CallStatus;
  events: { at: number; code: string }[];
}
export interface CallTrace {
  traceId: string;
  requestId: string;
  startedAt: number;
  durationMs: number;
  status: CallStatus;
  method: string;
  tool: string | null;
  spans: CallSpan[];
}
export interface CallHistory {
  calls: CallTrace[];
  retention: { limit: number; persistent: boolean };
}
