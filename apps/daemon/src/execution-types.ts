/**
 * Shared types, limits and small helpers for the execution manager (M1).
 * Kept separate so the bridge (execution-bridge.ts) and the queue
 * (executions.ts) can share the Entry shape without a circular import.
 */
import type { Execution as RunnerExecution } from '../../../packages/runner/dist/supervisor.js';
import { randomUUID } from 'node:crypto';

export const MAX_SOURCE_BYTES = 65_536;
export const MAX_OUTPUT_BYTES = 65_536;
export const MAX_BRIDGE_CALLS = 32;
export const MAX_QUEUE = 8;
export const MAX_ENTRIES = 128;
export const DEFAULT_TIMEOUT_MS = 60_000;
export const MAX_TIMEOUT_MS = 300_000;
export const TAB_WATCH_MS = 1000;
export const BACKSTOP_MS = 5000;
export const CANCEL_WAIT_MS = 10_000;

export interface RunTarget {
  browserId: string;
  tabId: number;
  generation?: number;
}
export type ExecutionState =
  'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
export interface ExecutionStep {
  stepId: string;
  action: string;
  target?: { browserId: string; tabId: number };
  durationMs: number;
  result: string;
}
export interface ExecutionObservation {
  mode: 'state' | 'screenshot' | 'both';
  state?: string;
  screenshot?: { data: string; mimeType: 'image/jpeg' };
}
export interface ExecutionError {
  code: string;
  message: string;
  step?: string;
}
export interface ExecutionEntry {
  executionId: string;
  state: ExecutionState;
  submittedAt: number;
  startedAt?: number;
  endedAt?: number;
  result?: unknown;
  error?: ExecutionError;
  steps: ExecutionStep[];
  observations?: ExecutionObservation[];
}
export interface BrowserTab {
  browserId: string;
  tabId: string;
  generation: number;
  title?: string;
  url?: string;
  active: boolean;
  claimed: boolean;
}
export interface RunOptions {
  timeoutMs?: number;
  taskName?: string;
  limits?: { maxOutputBytes?: number; maxSteps?: number };
  /** Internal MCP request provenance; not user-supplied script arguments. */
  audit?: { traceId: string; requestId: string };
}
/** A registered execution: the public view plus queue/bridge bookkeeping. */
export interface Entry {
  id: string;
  owner: string;
  taskName?: string;
  state: ExecutionState;
  submittedAt: number;
  startedAt?: number;
  endedAt?: number;
  result?: unknown;
  error?: ExecutionError;
  steps: ExecutionStep[];
  observations: ExecutionObservation[];
  target: { browserId: string; tabId: number; generation: number } | undefined;
  timeoutMs: number;
  limits: { maxOutputBytes: number; maxBridgeCalls: number };
  source: string;
  cancelReason?: string;
  lastFailedStep?: string;
  /** A browser side effect may already have happened; do not auto-retry. */
  uncertainStep?: string;
  /** Cancellation or lost target while a host call remains unresolved. */
  uncertainEffect?: boolean;
  inFlight: number;
  settled: boolean;
  settledPromise: Promise<void>;
  settledResolve: () => void;
  runner?: RunnerExecution;
  backstop?: NodeJS.Timeout;
}

export function executionView(entry: Entry): ExecutionEntry {
  return {
    executionId: entry.id,
    state: entry.state,
    submittedAt: entry.submittedAt,
    ...(entry.startedAt !== undefined ? { startedAt: entry.startedAt } : {}),
    ...(entry.endedAt !== undefined ? { endedAt: entry.endedAt } : {}),
    ...(entry.state === 'succeeded' && entry.result !== undefined
      ? { result: entry.result }
      : {}),
    ...(entry.error ? { error: entry.error } : {}),
    steps: entry.steps.map((step) => ({ ...step })),
    ...(entry.observations.length > 0
      ? {
          observations: entry.observations.map((item) => ({
            ...item,
            ...(item.screenshot ? { screenshot: { ...item.screenshot } } : {}),
          })),
        }
      : {}),
  };
}

/** Create queue bookkeeping without performing any browser I/O. */
export function createExecutionEntry(input: {
  owner: string;
  source: string;
  target: Entry['target'];
  timeoutMs: number;
  limits: Entry['limits'];
}): Entry {
  let settledResolve!: () => void;
  const settledPromise = new Promise<void>((resolve) => {
    settledResolve = resolve;
  });
  return {
    id: randomUUID(),
    owner: input.owner,
    state: 'queued',
    submittedAt: Date.now(),
    target: input.target,
    timeoutMs: input.timeoutMs,
    limits: input.limits,
    source: input.source,
    steps: [],
    observations: [],
    inFlight: 0,
    settled: false,
    settledPromise,
    settledResolve,
  };
}

export function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** The design error code carried by an error (a code-like message, else UNKNOWN_RESULT). */
export function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code: unknown = error.code;
    if (typeof code === 'string') return code;
  }
  if (error instanceof Error && /^[A-Z_]{3,64}$/.test(error.message))
    return error.message;
  return 'UNKNOWN_RESULT';
}

/** Transport failed after a potentially non-idempotent browser action was sent. */
export function unknownAfterDispatch(code: string): boolean {
  return code === 'TIMEOUT' || code === 'EXTENSION_OFFLINE';
}

/** Preserve uncertainty from a possibly executed browser write in the final task. */
export function uncertainActionOutcome(step?: string): {
  state: 'unknown';
  error: ExecutionError;
} {
  return {
    state: 'unknown',
    error: {
      code: 'UNKNOWN_RESULT',
      message:
        'browser action may have completed; inspect the page before retrying',
      ...(step ? { step } : {}),
    },
  };
}

/** A tab id from the MCP layer (number) or the script bridge (numeric string). */
export function normalizeTabId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
    return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

/** Runner submit-time throws mapped to design error codes (undefined: unknown). */
export function submitErrorCode(error: unknown): string | undefined {
  if (error instanceof Error) {
    switch (error.message) {
      case 'source limit':
        return 'SCRIPT_TOO_LARGE';
      case 'queue full':
        return 'QUEUE_FULL';
      case 'invalid target':
        return 'INVALID_TARGET';
      case 'runner closed':
        return 'DAEMON_UNAVAILABLE';
      default:
        return undefined;
    }
  }
  return undefined;
}

export function submitErrorMessage(code: string): string {
  switch (code) {
    case 'SCRIPT_TOO_LARGE':
      return 'script exceeds the 64 KiB limit';
    case 'QUEUE_FULL':
      return 'execution queue is full';
    case 'INVALID_TARGET':
      return 'target tab is not available';
    case 'DAEMON_UNAVAILABLE':
      return 'execution runner is unavailable';
    default:
      return 'runner failed to start the task';
  }
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Validate timeout/taskName/limits; returns the clamped effective values. */
export function validateRunOptions(options: RunOptions): {
  timeoutMs: number;
  limits: { maxOutputBytes: number; maxBridgeCalls: number };
} {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMEOUT_MS
  )
    throw new Error('INVALID_ARGUMENT');
  if (
    options.taskName !== undefined &&
    (typeof options.taskName !== 'string' ||
      !options.taskName ||
      options.taskName.length > 128)
  )
    throw new Error('INVALID_ARGUMENT');
  const maxOutputBytes = options.limits?.maxOutputBytes ?? MAX_OUTPUT_BYTES;
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1)
    throw new Error('INVALID_ARGUMENT');
  const maxBridgeCalls = options.limits?.maxSteps ?? MAX_BRIDGE_CALLS;
  if (!Number.isSafeInteger(maxBridgeCalls) || maxBridgeCalls < 1)
    throw new Error('INVALID_ARGUMENT');
  return {
    timeoutMs,
    limits: {
      maxOutputBytes: Math.min(maxOutputBytes, MAX_OUTPUT_BYTES),
      maxBridgeCalls: Math.min(maxBridgeCalls, MAX_BRIDGE_CALLS),
    },
  };
}

/** A snapshot url normalized the way the daemon tab parser strips it. */
export function normalizeSnapshotUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.href;
  } catch {
    throw new Error('INVALID_ARGUMENT');
  }
}
