/** Internal IPC only, not the browser SDK or an MCP contract. */
export const limits = Object.freeze({
  sourceBytes: 64 * 1024,
  valueBytes: 64 * 1024,
  heapBytes: 16 * 1024 * 1024,
  stackBytes: 256 * 1024,
  timeoutMs: 5_000,
  maxQueue: 8,
  maxCalls: 32,
});
export type Result =
  | { status: 'completed'; json: string }
  | { status: 'failed'; reason: 'script' | 'output' | 'protocol' }
  | { status: 'cancelled' | 'timeout' | 'crashed' };
export interface RunMessage {
  type: 'run';
  id: string;
  code: string;
}
export interface ReplyMessage {
  type: 'reply';
  id: string;
  call: number;
  json: string;
}
export interface CallMessage {
  type: 'call';
  id: string;
  call: number;
  method: string;
  json: string;
}
export interface DoneMessage {
  type: 'done';
  id: string;
  result: Result;
}
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function bounded(value: unknown, bytes: number): value is string {
  return typeof value === 'string' && Buffer.byteLength(value) <= bytes;
}
export function identity(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9-]{36}$/u.test(value);
}
export function isRun(value: unknown): value is RunMessage {
  return (
    record(value) &&
    value.type === 'run' &&
    identity(value.id) &&
    bounded(value.code, limits.sourceBytes)
  );
}
export function isReply(value: unknown): value is ReplyMessage {
  return (
    record(value) &&
    value.type === 'reply' &&
    identity(value.id) &&
    Number.isSafeInteger(value.call) &&
    bounded(value.json, limits.valueBytes)
  );
}
export function isCall(value: unknown): value is CallMessage {
  return (
    record(value) &&
    value.type === 'call' &&
    identity(value.id) &&
    Number.isSafeInteger(value.call) &&
    typeof value.call === 'number' &&
    value.call > 0 &&
    value.call <= limits.maxCalls &&
    typeof value.method === 'string' &&
    /^[a-z][a-z0-9.]{0,63}$/u.test(value.method) &&
    bounded(value.json, limits.valueBytes)
  );
}
export function isDone(value: unknown): value is DoneMessage {
  if (
    !record(value) ||
    value.type !== 'done' ||
    !identity(value.id) ||
    !record(value.result)
  )
    return false;
  const result = value.result;
  return result.status === 'completed'
    ? bounded(result.json, limits.valueBytes)
    : result.status === 'timeout' ||
        (result.status === 'failed' &&
          ['script', 'output', 'protocol'].includes(String(result.reason)));
}
