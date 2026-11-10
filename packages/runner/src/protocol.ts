/**
 * Internal IPC only, not the browser SDK or an MCP contract.
 *
 * Production IPC (runner.md "生产桥接与进程间协议", browser-sdk.md
 * "daemon ↔ runner IPC"): NDJSON over inherited private pipes (extra stdio
 * fds, no ports, no inherited environment); one JSON object per line, UTF-8,
 * single message <= 64 KiB. Every message carries the envelope
 * `{ v: 1, type, taskId, seq }`; `seq` is strictly increasing from 1 per
 * direction per task (ping/pong are connection-scoped and use taskId '').
 * A message with the wrong task, a duplicate/out-of-order seq, or an
 * oversized frame is rejected and logged, never replayed.
 */
export const limits = Object.freeze({
  sourceBytes: 64 * 1024,
  valueBytes: 64 * 1024,
  messageBytes: 64 * 1024,
  heapBytes: 16 * 1024 * 1024,
  stackBytes: 256 * 1024,
  /** 5 s base wall clock (runner.md independent foundation, mock tasks). */
  timeoutMs: 5_000,
  /** Production task timeoutMs: default 60 s, hard cap 300 s (M0). */
  defaultTimeoutMs: 60_000,
  maxTimeoutMs: 300_000,
  maxQueue: 8,
  maxCalls: 32,
});

/**
 * Clamp a production timeoutMs. Absent means the 5 s base ceiling
 * (browser-sdk.md wall-clock section); a given value is clamped into
 * [1 ms, 300 s]; a non-finite value falls back to the 60 s default.
 */
export function clampTimeoutMs(value: number | undefined): number {
  if (value === undefined) return limits.timeoutMs;
  if (!Number.isFinite(value)) return limits.defaultTimeoutMs;
  return Math.min(limits.maxTimeoutMs, Math.max(1, Math.floor(value)));
}

/** Clamp an optional per-task byte/call budget into [1, max]. */
export function clampInt(value: number | undefined, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return max;
  return Math.min(max, Math.max(1, Math.floor(value)));
}

export type Result =
  | { status: 'completed'; json: string }
  | { status: 'failed'; reason: 'script' | 'output' | 'protocol' }
  | { status: 'cancelled' | 'timeout' | 'crashed' | 'unknown' };

export type TaskState = 'succeeded' | 'failed' | 'cancelled' | 'unknown';
export type FailureReason = 'script' | 'output' | 'protocol';

/** Claimed target tab for one task (daemon injects it; B5 generation). */
export interface RunTarget {
  browserId: string;
  tabId: string;
  generation: number;
}

/** Per-task budgets carried by run_task (all already clamped by Runner). */
export interface RunLimits {
  timeoutMs: number;
  maxOutputBytes: number;
  maxBridgeCalls: number;
}

export interface BridgeError {
  code: string;
  message: string;
}

export interface RunTaskMessage {
  v: 1;
  type: 'run_task';
  taskId: string;
  seq: number;
  script: string;
  /** Absent only for mock/local runs without a daemon target (see worker). */
  target?: RunTarget;
  limits: RunLimits;
}

export interface CancelTaskMessage {
  v: 1;
  type: 'cancel_task';
  taskId: string;
  seq: number;
  reason?: string;
}

export interface PingMessage {
  v: 1;
  type: 'ping';
  taskId: '';
  seq: number;
}

export interface PongMessage {
  v: 1;
  type: 'pong';
  taskId: '';
  seq: number;
}

/**
 * SDK method call request. `args` is the JSON value the script passed to
 * `__hostCall` (for every SDK method it is always a JSON array; the raw
 * probe may pass any JSON value and the supervisor forwards it verbatim).
 */
export interface BridgeCallMessage {
  v: 1;
  type: 'bridge_call';
  taskId: string;
  seq: number;
  callId: number;
  method: string;
  args: unknown;
}

export interface BridgeResultMessage {
  v: 1;
  type: 'bridge_result';
  taskId: string;
  seq: number;
  callId: number;
  ok: boolean;
  value?: unknown;
  error?: BridgeError;
}

/**
 * Task terminal state. `reason` is an internal extension (not in the design
 * table) so the supervisor can map a failed task to a `Result` reason;
 * `error.code` carries a design error-code (TIMEOUT / UNKNOWN_RESULT) when
 * one applies.
 */
export interface TaskResultMessage {
  v: 1;
  type: 'task_result';
  taskId: string;
  seq: number;
  state: TaskState;
  result?: unknown;
  error?: BridgeError;
  reason?: FailureReason;
}

export type IpcMessage =
  | RunTaskMessage
  | CancelTaskMessage
  | PingMessage
  | PongMessage
  | BridgeCallMessage
  | BridgeResultMessage
  | TaskResultMessage;

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function bounded(value: unknown, bytes: number): value is string {
  return typeof value === 'string' && Buffer.byteLength(value) <= bytes;
}

export function identity(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9-]{36}$/u.test(value);
}

/** Serialize one IPC message as a single NDJSON line, or null if too big. */
export function encodeMessage(message: IpcMessage): string | null {
  const line = `${JSON.stringify(message)}\n`;
  return Buffer.byteLength(line, 'utf8') <= limits.messageBytes ? line : null;
}

/** Parse one NDJSON line, or null when oversized / not JSON. */
export function decodeLine(line: string): unknown {
  if (Buffer.byteLength(line, 'utf8') > limits.messageBytes) return null;
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return null;
  }
}

function isEnvelope(
  value: unknown,
  type: string,
): value is Record<string, unknown> {
  return (
    record(value) &&
    value.v === 1 &&
    value.type === type &&
    typeof value.taskId === 'string' &&
    typeof value.seq === 'number' &&
    Number.isSafeInteger(value.seq) &&
    value.seq >= 1
  );
}

export function isRunTarget(value: unknown): value is RunTarget {
  if (!record(value)) return false;
  const { browserId, tabId, generation } = value;
  return (
    typeof browserId === 'string' &&
    browserId.length > 0 &&
    typeof tabId === 'string' &&
    tabId.length > 0 &&
    typeof generation === 'number' &&
    Number.isSafeInteger(generation) &&
    generation >= 0
  );
}

function isRunLimits(value: unknown): value is RunLimits {
  if (!record(value)) return false;
  const { timeoutMs, maxOutputBytes, maxBridgeCalls } = value;
  return (
    typeof timeoutMs === 'number' &&
    Number.isFinite(timeoutMs) &&
    timeoutMs >= 1 &&
    timeoutMs <= limits.maxTimeoutMs &&
    typeof maxOutputBytes === 'number' &&
    Number.isSafeInteger(maxOutputBytes) &&
    maxOutputBytes >= 1 &&
    maxOutputBytes <= limits.valueBytes &&
    typeof maxBridgeCalls === 'number' &&
    Number.isSafeInteger(maxBridgeCalls) &&
    maxBridgeCalls >= 1 &&
    maxBridgeCalls <= limits.maxCalls
  );
}

export function isRunTask(value: unknown): value is RunTaskMessage {
  if (!isEnvelope(value, 'run_task')) return false;
  // run_task is always the first message of a task in its direction.
  if (value.seq !== 1 || !identity(value.taskId)) return false;
  if (!bounded(value.script, limits.sourceBytes)) return false;
  if (value.target !== undefined && !isRunTarget(value.target)) return false;
  return isRunLimits(value.limits);
}

export function isCancelTask(value: unknown): value is CancelTaskMessage {
  if (!isEnvelope(value, 'cancel_task')) return false;
  if (!identity(value.taskId)) return false;
  return value.reason === undefined || typeof value.reason === 'string';
}

export function isPing(value: unknown): value is PingMessage {
  return isEnvelope(value, 'ping') && value.taskId === '';
}

export function isPong(value: unknown): value is PongMessage {
  return isEnvelope(value, 'pong') && value.taskId === '';
}

export function isBridgeCall(value: unknown): value is BridgeCallMessage {
  if (!isEnvelope(value, 'bridge_call')) return false;
  if (!identity(value.taskId)) return false;
  const { callId, method } = value;
  return (
    typeof callId === 'number' &&
    Number.isSafeInteger(callId) &&
    callId >= 1 &&
    callId <= limits.maxCalls &&
    typeof method === 'string' &&
    /^[a-z][a-z0-9.]{0,63}$/u.test(method) &&
    'args' in value
  );
}

function isBridgeError(value: unknown): value is BridgeError {
  return (
    record(value) &&
    typeof value.code === 'string' &&
    typeof value.message === 'string'
  );
}

export function isBridgeResult(value: unknown): value is BridgeResultMessage {
  if (!isEnvelope(value, 'bridge_result')) return false;
  if (!identity(value.taskId)) return false;
  const { callId, ok } = value;
  if (
    typeof callId !== 'number' ||
    !Number.isSafeInteger(callId) ||
    callId < 1 ||
    typeof ok !== 'boolean'
  )
    return false;
  return ok ? 'value' in value : isBridgeError(value.error);
}

export function isTaskResult(value: unknown): value is TaskResultMessage {
  if (!isEnvelope(value, 'task_result')) return false;
  if (!identity(value.taskId)) return false;
  const { state } = value;
  // isDone fix, option chosen: ALLOW. The old isDone accepted only
  // completed/timeout/failed although Result also contains
  // cancelled/crashed/unknown; the supervisor must accept worker-reported
  // cancelled and unknown terminal states, so the validator now accepts
  // every Result status instead of dropping statuses from Result.
  if (
    state !== 'succeeded' &&
    state !== 'failed' &&
    state !== 'cancelled' &&
    state !== 'unknown'
  )
    return false;
  if (value.reason !== undefined) {
    const reason = value.reason;
    if (reason !== 'script' && reason !== 'output' && reason !== 'protocol')
      return false;
  }
  if (value.error !== undefined && !isBridgeError(value.error)) return false;
  return true;
}
