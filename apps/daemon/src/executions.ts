/**
 * Execution manager (M1, T4/T6/T9). One serial queue (8 waiting / 1
 * running), a registry of executions, and the claim registry. Scripts run
 * raw in the runner: the runner's sdk.ts injects the `browser` global, so
 * there is no daemon-side script wrapper. The bridge
 * (execution-bridge.ts) implements the five M1 methods and the T5
 * authorization checks; this class owns lifecycle, the queue, claims and
 * the runner process.
 *
 * Claim lifetime: the AI may select a tab directly (no manual claim step).
 * run_script atomically reserves and binds the claim when necessary; an
 * optional browser_claim_tab may still bind a preselected tab. Claims
 * are execution locks, not operation approvals, and release when the
 * execution ends or is cancelled. A target tab that closes cancels its task
 * with TAB_CLOSED (a 1 s watcher, plus the bridge escalation on tab.title).
 * A daemon-side backstop timer (timeoutMs + 5 s) settles a task the runner
 * failed to report as unknown.
 */
import { Runner } from '../../../packages/runner/dist/supervisor.js';
import type { RunOptions as RunnerRunOptions } from '../../../packages/runner/dist/supervisor.js';
import type { Result } from '../../../packages/runner/dist/protocol.js';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Connections } from './connections.js';
import { ClaimRegistry } from './claims.js';
import type { Claim } from './claims.js';
import { ExecutionBridge } from './execution-bridge.js';
import {
  interruptExecution,
  notifyExecutionVisual,
} from './execution-lifecycle.js';
import type { ExecutionAudit } from './execution-audit.js';
import type {
  Entry,
  ExecutionEntry,
  ExecutionError,
  ExecutionState,
  ExecutionStep,
  RunOptions,
  RunTarget,
} from './execution-types.js';
import {
  BACKSTOP_MS,
  CANCEL_WAIT_MS,
  MAX_ENTRIES,
  MAX_QUEUE,
  MAX_SOURCE_BYTES,
  TAB_WATCH_MS,
  normalizeSnapshotUrl,
  createExecutionEntry,
  executionView,
  sleep,
  submitErrorCode,
  submitErrorMessage,
  uncertainActionOutcome,
  validateRunOptions,
} from './execution-types.js';

/** Per-daemon execution queue: the OAuth grant owns each result and cancellation. */
export class Executions {
  private readonly runner = new Runner(() => {
    // Installed daemon.cjs lives next to payload/runner; source builds use the
    // repository's private runner. Never depend on an npx cache or user PATH.
    const worker =
      typeof import.meta.url === 'string' && import.meta.url.startsWith('file:')
        ? fileURLToPath(
            new URL('../../../packages/runner/worker.mjs', import.meta.url),
          )
        : join(__dirname, 'runner', 'worker.mjs');
    return spawn(process.execPath, ['--max-old-space-size=64', worker], {
      env: {},
      stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
    });
  });
  private readonly entries = new Map<string, Entry>();
  private readonly claims = new ClaimRegistry();
  private readonly bridge: ExecutionBridge;
  private readonly watcher: NodeJS.Timeout;
  private waiting: Entry[] = [];
  private running: Entry | null = null;
  constructor(
    private readonly connections: Connections,
    private readonly audit?: ExecutionAudit,
  ) {
    this.bridge = new ExecutionBridge(connections, this.claims, audit);
    this.watcher = setInterval(() => {
      this.watchTargets();
    }, TAB_WATCH_MS);
    this.watcher.unref();
  }

  /** Connected browsers with their known tabs (browser_list source). */
  browsers() {
    return this.connections.browsers();
  }
  isClaimed(browserId: string, tabId: number): boolean {
    return this.claims.isClaimed(browserId, tabId);
  }

  claimTab(
    owner: string,
    browserId: string,
    tabId: number,
    snapshot?: { title?: string; url?: string },
  ): Claim {
    if (
      typeof browserId !== 'string' ||
      !browserId ||
      browserId.length > 128 ||
      !Number.isSafeInteger(tabId) ||
      tabId < 0
    )
      throw new Error('INVALID_ARGUMENT');
    const title = snapshot?.title;
    const url = snapshot?.url;
    if (
      title !== undefined &&
      (typeof title !== 'string' || title.length > 256)
    )
      throw new Error('INVALID_ARGUMENT');
    if (url !== undefined && typeof url !== 'string')
      throw new Error('INVALID_ARGUMENT');
    const live = this.bridge.liveTab(browserId, tabId);
    if (!live) throw new Error('INVALID_TARGET');
    if (title !== undefined && title !== live.title)
      throw new Error('INVALID_TARGET');
    if (url !== undefined) {
      const normalized = normalizeSnapshotUrl(url);
      if (normalized !== live.url) throw new Error('INVALID_TARGET');
    }
    return this.claims.claim(owner, {
      browserId,
      tabId,
      generation: live.generation,
      title: live.title,
      url: live.url,
    });
  }

  run(
    owner: string,
    source: string,
    target?: RunTarget,
    options: RunOptions = {},
  ): { executionId: string; state: 'queued' | 'running'; submittedAt: number } {
    if (typeof source !== 'string' || !source.trim())
      throw new Error('INVALID_ARGUMENT');
    if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES)
      throw new Error('SCRIPT_TOO_LARGE');
    const { timeoutMs, limits } = validateRunOptions(options);
    const queued = this.running !== null;
    this.checkQueueSpace(queued);
    const runTarget = this.bridge.resolveTarget(owner, target);
    const entry = createExecutionEntry({
      owner,
      source,
      target: runTarget,
      timeoutMs,
      limits,
    });
    if (options.taskName !== undefined) entry.taskName = options.taskName;
    if (runTarget)
      this.claims.bind(entry.id, owner, runTarget.browserId, runTarget.tabId);
    try {
      this.audit?.begin({
        executionId: entry.id,
        submittedAt: entry.submittedAt,
        ...(options.audit ? options.audit : {}),
        ...(runTarget
          ? { browserId: runTarget.browserId, tabId: runTarget.tabId }
          : {}),
      });
    } catch {
      if (runTarget) this.claims.releaseByExecution(entry.id);
      throw new Error('AUDIT_UNAVAILABLE');
    }
    this.entries.set(entry.id, entry);
    if (queued) {
      this.waiting.push(entry);
    } else {
      this.startOrRollback(entry, runTarget);
    }
    return {
      executionId: entry.id,
      state: entry.state === 'queued' ? 'queued' : 'running',
      submittedAt: entry.submittedAt,
    };
  }

  /** Queue admission: 8 waiting / 1 running, 128 registry entries. */
  private checkQueueSpace(queued: boolean): void {
    if (queued && this.waiting.length >= MAX_QUEUE)
      throw new Error('QUEUE_FULL');
    if (this.entries.size >= MAX_ENTRIES) this.prune();
    if (this.entries.size >= MAX_ENTRIES) throw new Error('QUEUE_FULL');
  }

  /** Start now; on a submit throw, roll the entry and its claim back. */
  private startOrRollback(
    entry: Entry,
    runTarget:
      { browserId: string; tabId: number; generation: number } | undefined,
  ): void {
    try {
      this.start(entry);
    } catch (error) {
      this.entries.delete(entry.id);
      this.audit?.remove(entry.id);
      if (runTarget) this.claims.releaseByExecution(entry.id);
      const code = submitErrorCode(error);
      if (code) throw new Error(code, { cause: error });
      throw error;
    }
  }

  get(owner: string, executionId: string): ExecutionEntry {
    const entry = this.entries.get(executionId);
    if (!entry || entry.owner !== owner) throw new Error('EXECUTION_NOT_FOUND');
    return executionView(entry);
  }

  async cancel(
    owner: string,
    executionId: string,
  ): Promise<{
    executionId: string;
    state: ExecutionState;
    completedSteps: ExecutionStep[];
    pendingStepsCancelled: number;
  }> {
    const entry = this.entries.get(executionId);
    if (!entry || entry.owner !== owner) throw new Error('EXECUTION_NOT_FOUND');
    if (entry.state === 'queued') {
      this.waiting = this.waiting.filter((item) => item !== entry);
      this.finish(entry, 'cancelled', {
        code: 'CANCELLED',
        message: 'task cancelled before start',
      });
      return {
        executionId: entry.id,
        state: entry.state,
        completedSteps: entry.steps.map((step) => ({ ...step })),
        pendingStepsCancelled: 0,
      };
    }
    if (entry.state === 'running') {
      const pending = entry.inFlight;
      if (pending > 0) entry.uncertainEffect = true;
      entry.cancelReason = 'CANCELLED';
      entry.runner?.cancel();
      await Promise.race([entry.settledPromise, sleep(CANCEL_WAIT_MS)]);
      return {
        executionId: entry.id,
        state: entry.state,
        completedSteps: entry.steps.map((step) => ({ ...step })),
        pendingStepsCancelled: pending,
      };
    }
    return {
      executionId: entry.id,
      state: entry.state,
      completedSteps: entry.steps.map((step) => ({ ...step })),
      pendingStepsCancelled: 0,
    };
  }

  /** Stop the running task when Chrome's own debugger Cancel is pressed. */
  interruptByUser(browserId: string, tabId: number): void {
    interruptExecution(this.running, browserId, tabId);
  }

  close(): void {
    clearInterval(this.watcher);
    for (const entry of this.entries.values())
      if (entry.backstop) clearTimeout(entry.backstop);
    this.runner.close();
    this.entries.clear();
    this.waiting = [];
    this.running = null;
  }

  private start(entry: Entry): void {
    entry.state = 'running';
    entry.startedAt = Date.now();
    this.audit?.start(entry.id, entry.startedAt);
    const runOptions: RunnerRunOptions = {
      timeoutMs: entry.timeoutMs,
      limits: {
        maxOutputBytes: entry.limits.maxOutputBytes,
        maxBridgeCalls: entry.limits.maxBridgeCalls,
      },
    };
    if (entry.target)
      runOptions.target = {
        browserId: entry.target.browserId,
        tabId: String(entry.target.tabId),
        generation: entry.target.generation,
      };
    notifyExecutionVisual(this.connections, entry, 'start');
    const task = this.runner.run(
      entry.source,
      (method, json, signal) => this.bridge.invoke(entry, method, json, signal),
      runOptions,
    );
    entry.runner = task;
    this.running = entry;
    entry.backstop = setTimeout(() => {
      this.backstop(entry);
    }, entry.timeoutMs + BACKSTOP_MS);
    entry.backstop.unref();
    task.result.then(
      (result) => {
        this.settle(entry, result);
      },
      () => {
        // The runner reports failures as Result values; a rejection means
        // the result was lost, so the outcome is unknown.
        this.finish(entry, 'unknown', {
          code: 'RUNNER_CRASHED',
          message: 'runner result was lost',
        });
      },
    );
  }

  private dequeue(): void {
    if (this.running !== null) return;
    const next = this.waiting.shift();
    if (!next) return;
    const problem = this.checkQueuedTarget(next);
    if (problem) {
      this.finish(next, problem.state, problem.error);
      this.dequeue();
      return;
    }
    try {
      this.start(next);
    } catch (error) {
      const code = submitErrorCode(error) ?? 'UNKNOWN_RESULT';
      this.finish(next, 'failed', {
        code,
        message: submitErrorMessage(code),
      });
      this.dequeue();
    }
  }

  /** Re-validate a queued entry's target before it starts (or the finish outcome). */
  private checkQueuedTarget(
    entry: Entry,
  ): { state: 'cancelled' | 'failed'; error: ExecutionError } | undefined {
    if (!entry.target) return undefined;
    const live = this.bridge.liveTab(
      entry.target.browserId,
      entry.target.tabId,
    );
    if (!live)
      return {
        state: 'cancelled',
        error: { code: 'TAB_CLOSED', message: 'target tab closed' },
      };
    if (live.generation !== entry.target.generation)
      return {
        state: 'failed',
        error: {
          code: 'INVALID_TARGET',
          message: 'stale connection generation',
        },
      };
    const claim = this.claims.get(entry.target.browserId, entry.target.tabId);
    if (!claim || claim.executionId !== entry.id)
      return {
        state: 'failed',
        error: {
          code: 'TAB_NOT_CLAIMED',
          message: 'target tab is not claimed by this task',
        },
      };
    return undefined;
  }

  private settle(entry: Entry, result: Result): void {
    if (entry.settled) return;
    const outcome = this.resultOutcome(entry, result);
    this.finish(entry, outcome.state, outcome.error, outcome.result);
  }

  /** Map a runner Result to the terminal outcome (step-aware for script errors). */
  private resultOutcome(
    entry: Entry,
    result: Result,
  ): {
    state: 'succeeded' | 'failed' | 'cancelled' | 'unknown';
    error?: ExecutionError;
    result?: unknown;
  } {
    if (entry.uncertainEffect || entry.uncertainStep)
      return uncertainActionOutcome(entry.uncertainStep);
    if (result.status === 'completed') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.json);
      } catch {
        return {
          state: 'failed',
          error: {
            code: 'INVALID_RESULT',
            message: 'script returned a non-JSON value',
          },
        };
      }
      return { state: 'succeeded', result: parsed };
    }
    if (result.status === 'failed')
      return this.failedOutcome(entry, result.reason);
    if (result.status === 'timeout')
      return {
        state: 'failed',
        error: { code: 'TIMEOUT', message: 'task timed out' },
      };
    if (result.status === 'cancelled') {
      const error: ExecutionError =
        entry.cancelReason === 'TAB_CLOSED'
          ? { code: 'TAB_CLOSED', message: 'target tab closed' }
          : entry.cancelReason === 'USER_STOPPED'
            ? {
                code: 'USER_STOPPED',
                message: 'browser control stopped by user',
              }
            : { code: 'CANCELLED', message: 'task cancelled' };
      return { state: 'cancelled', error };
    }
    if (result.status === 'crashed')
      return {
        state: 'unknown',
        error: { code: 'RUNNER_CRASHED', message: 'runner process crashed' },
      };
    return {
      state: 'unknown',
      error: {
        code: 'UNKNOWN_RESULT',
        message:
          'result unknown: a bridge call was in flight when the task timed out',
      },
    };
  }

  /** Map a failed runner Result (step-aware for script errors). */
  private failedOutcome(
    entry: Entry,
    reason: 'script' | 'output' | 'protocol',
  ): { state: 'failed'; error: ExecutionError } {
    if (reason === 'script')
      return {
        state: 'failed',
        error: {
          code: 'SCRIPT_ERROR',
          message: 'script execution failed',
          ...(entry.lastFailedStep ? { step: entry.lastFailedStep } : {}),
        },
      };
    if (reason === 'output')
      return {
        state: 'failed',
        error: {
          code: 'OUTPUT_LIMIT',
          message: 'script output exceeded the limit',
        },
      };
    return {
      state: 'failed',
      error: { code: 'PROTOCOL_ERROR', message: 'runner protocol error' },
    };
  }

  private finish(
    entry: Entry,
    state: 'succeeded' | 'failed' | 'cancelled' | 'unknown',
    error?: ExecutionError,
    result?: unknown,
  ): void {
    if (entry.settled) return;
    entry.settled = true;
    if (entry.backstop) clearTimeout(entry.backstop);
    try {
      this.audit?.finish(entry.id, state, error?.code);
    } catch {
      // A result without its required durable audit cannot be called a
      // verified success. Do not imply that a browser action can be replayed.
      state = 'unknown';
      error = {
        code: 'AUDIT_UNAVAILABLE',
        message: 'execution audit write failed after browser activity',
      };
      result = undefined;
    }
    entry.state = state;
    entry.endedAt = Date.now();
    entry.inFlight = 0;
    if (error !== undefined) entry.error = error;
    if (result !== undefined) entry.result = result;
    notifyExecutionVisual(this.connections, entry, 'finish');
    this.claims.releaseByExecution(entry.id);
    entry.settledResolve();
    if (this.running === entry) {
      this.running = null;
      this.dequeue();
    }
  }

  /** Backstop: the runner did not settle after its own timeout. */
  private backstop(entry: Entry): void {
    if (entry.settled || entry.state !== 'running') return;
    entry.runner?.cancel();
    this.finish(entry, 'unknown', {
      code: 'UNKNOWN_RESULT',
      message: 'runner did not settle after timeout',
    });
  }

  /** A target tab that closed cancels its task with TAB_CLOSED. */
  private watchTargets(): void {
    try {
      const entries = [this.running, ...this.waiting].filter(
        (item): item is Entry => item !== null && item.target !== undefined,
      );
      for (const entry of entries) {
        if (entry.settled || !entry.target) continue;
        if (!this.bridge.liveTab(entry.target.browserId, entry.target.tabId)) {
          if (entry.inFlight > 0) entry.uncertainEffect = true;
          if (entry.state === 'queued') {
            this.finish(entry, 'cancelled', {
              code: 'TAB_CLOSED',
              message: 'target tab closed',
            });
          } else if (entry.state === 'running') {
            entry.cancelReason = 'TAB_CLOSED';
            entry.runner?.cancel();
          }
        }
      }
    } catch {
      // The next tick retries; a watcher failure must not kill the daemon.
    }
  }

  private prune(): void {
    for (const [id, entry] of this.entries)
      if (entry.state !== 'running' && entry.state !== 'queued')
        this.entries.delete(id);
  }
}
