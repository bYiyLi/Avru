import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import {
  bounded,
  clampInt,
  clampTimeoutMs,
  decodeLine,
  encodeMessage,
  isBridgeCall,
  isPong,
  isRunTarget,
  isTaskResult,
  limits,
  record,
  type BridgeError,
  type IpcMessage,
  type Result,
  type RunLimits,
  type RunTarget,
} from './protocol.js';
import type { Bridge } from './engine.js';

export interface RunOptions {
  /**
   * Production wall clock. Absent: the 5 s base ceiling (runner.md
   * independent foundation). Given: clamped into [1 ms, 300 s]
   * (browser-sdk.md limits table, M0).
   */
  timeoutMs?: number;
  /** Claimed target tab (run_task.target); absent only for mock/local runs. */
  target?: RunTarget;
  /** Per-task budgets; each is clamped to its global limit when given. */
  limits?: { maxOutputBytes?: number; maxBridgeCalls?: number };
}

export interface Execution {
  id: string;
  result: Promise<Result>;
  cancel: () => void;
}

export type Factory = () => ChildProcess;
export type RunnerLog = (message: string) => void;

interface Task {
  id: string;
  code: string;
  invoke: Bridge;
  resolve: (result: Result) => void;
  timer?: ReturnType<typeof setTimeout>;
  calls: Set<number>;
  pending: Set<number>;
  controller: AbortController;
  timeoutMs: number;
  target: RunTarget | undefined;
  runLimits: RunLimits;
  runMessage: IpcMessage;
  /** Next expected inbound seq for this task (first bridge_call is seq 1). */
  inSeq: number;
  /** Next outbound seq (run_task already used seq 1). */
  outSeq: number;
}

function startChild() {
  // NDJSON over inherited private pipes (fd 3 parent->child, fd 4
  // child->parent). No ports, no inherited environment, fixed Node args.
  return spawn(
    process.execPath,
    [
      '--max-old-space-size=64',
      fileURLToPath(new URL('../worker.mjs', import.meta.url)),
    ],
    { env: {}, stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
  );
}

const deny: Bridge = () => Promise.reject(new Error('denied'));

/**
 * Internal foundation only: not instantiated by daemon or exposed to MCP
 * directly — the daemon's ExecutionManager (T4) owns one Runner and drives
 * it through run()/cancel(). One Runner runs at most 1 task, queues at
 * most 8, and reuses one healthy child process across tasks.
 */
export class Runner {
  private child: ChildProcess | undefined;
  private active: Task | undefined;
  private queue: Task[] = [];
  private closed = false;
  private retiring = false;
  private inFlight = 0;
  private connInSeq = 1;
  private connOutSeq = 1;

  constructor(
    private readonly factory: Factory = startChild,
    private readonly log: RunnerLog = (message) => {
      console.error(message);
    },
  ) {}

  run(
    code: string,
    invoke: Bridge = deny,
    options: RunOptions = {},
  ): Execution {
    if (this.closed) throw new Error('runner closed');
    if (!bounded(code, limits.sourceBytes)) throw new Error('source limit');
    if (this.queue.length >= limits.maxQueue) throw new Error('queue full');
    const timeoutMs = clampTimeoutMs(options.timeoutMs);
    const runLimits: RunLimits = {
      timeoutMs,
      maxOutputBytes: clampInt(
        options.limits?.maxOutputBytes,
        limits.valueBytes,
      ),
      maxBridgeCalls: clampInt(options.limits?.maxBridgeCalls, limits.maxCalls),
    };
    const target = options.target;
    if (target !== undefined && !isRunTarget(target))
      throw new Error('invalid target');
    const id = randomUUID();
    const runMessage: IpcMessage =
      target === undefined
        ? {
            v: 1,
            type: 'run_task',
            taskId: id,
            seq: 1,
            script: code,
            limits: runLimits,
          }
        : {
            v: 1,
            type: 'run_task',
            taskId: id,
            seq: 1,
            script: code,
            target,
            limits: runLimits,
          };
    if (encodeMessage(runMessage) === null) throw new Error('source limit');
    const result = new Promise<Result>((resolve) => {
      this.queue.push({
        id,
        code,
        invoke,
        resolve,
        calls: new Set(),
        pending: new Set(),
        controller: new AbortController(),
        timeoutMs,
        target,
        runLimits,
        runMessage,
        inSeq: 1,
        outSeq: 2,
      });
    });
    this.next();
    return {
      id,
      result,
      cancel: () => {
        this.cancel(id);
      },
    };
  }

  close() {
    this.closed = true;
    for (const task of this.queue.splice(0))
      task.resolve({ status: 'cancelled' });
    if (this.active) this.end({ status: 'cancelled' }, true);
    else this.child?.kill();
  }

  private cancel(id: string) {
    const index = this.queue.findIndex((task) => task.id === id);
    if (index >= 0)
      this.queue.splice(index, 1)[0]?.resolve({ status: 'cancelled' });
    else if (this.active?.id === id) {
      const task = this.active;
      // cancel_task -> AbortSignal for the task; the process is then
      // force-ended below, so the message is best-effort (the worker may
      // never read it). In-flight bridge calls are aborted via the
      // controller in end(); late bridge results are dropped.
      if (this.child)
        this.send(this.child, {
          v: 1,
          type: 'cancel_task',
          taskId: id,
          seq: task.outSeq++,
          reason: 'cancelled',
        });
      this.end({ status: 'cancelled' }, true);
    }
  }

  private next() {
    if (this.closed || this.retiring || this.active || !this.queue.length)
      return;
    const task = this.queue.shift();
    if (!task) return;
    this.active = task;
    try {
      if (!this.child) this.connect();
      const child = this.child;
      if (!child) {
        this.end({ status: 'crashed' }, true);
        return;
      }
      // Daemon-side independent timing (runner.md): a bridge call still in
      // flight at the deadline means its side effect is unknown.
      task.timer = setTimeout(() => {
        if (this.active === task)
          this.end(
            task.pending.size ? { status: 'unknown' } : { status: 'timeout' },
            true,
          );
      }, task.timeoutMs);
      this.send(child, task.runMessage, () => {
        if (this.active === task) this.end({ status: 'crashed' }, true);
      });
    } catch {
      this.end({ status: 'crashed' }, true);
    }
  }

  private connect() {
    const child = this.factory();
    this.child = child;
    this.connInSeq = 1;
    this.connOutSeq = 1;
    const input = child.stdio[4] as Readable | null | undefined;
    const output = child.stdio[3] as Writable | null | undefined;
    if (!input || !output) throw new Error('runner child has no IPC pipes');
    let buffer = '';
    input.on('data', (chunk: Buffer | string) => {
      if (this.child !== child) return;
      buffer += chunk.toString('utf8');
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.length > 0) this.line(child, line);
        newline = buffer.indexOf('\n');
      }
      if (Buffer.byteLength(buffer, 'utf8') > limits.messageBytes) {
        this.log('runner: rejected oversized IPC line');
        if (this.active)
          this.end({ status: 'failed', reason: 'protocol' }, true);
        else child.kill('SIGKILL');
      }
    });
    child.on('error', () => {
      if (this.child === child) this.end({ status: 'crashed' }, true);
    });
    const stopped = () => {
      if (this.child !== child) return;
      this.child = undefined;
      this.end({ status: 'crashed' }, false);
    };
    child.on('exit', stopped);
    child.on('close', stopped);
    // Keepalive handshake (connection-scoped ping/pong, taskId '').
    this.send(child, {
      v: 1,
      type: 'ping',
      taskId: '',
      seq: this.connOutSeq++,
    });
  }

  private send(
    child: ChildProcess,
    message: IpcMessage,
    onError?: () => void,
  ): void {
    const line = encodeMessage(message);
    if (line === null) {
      this.log(`runner: refused oversized IPC message ${message.type}`);
      onError?.();
      return;
    }
    const output = child.stdio[3] as Writable | null | undefined;
    if (!output) {
      onError?.();
      return;
    }
    output.write(line, (error) => {
      if (error) {
        this.log(`runner: IPC write failed: ${error.message}`);
        onError?.();
      }
    });
  }

  /** Connection-scoped pong; true when the message was a pong. */
  private handlePong(message: Record<string, unknown>): boolean {
    if (message.type !== 'pong') return false;
    if (!isPong(message)) {
      this.log('runner: rejected malformed pong');
      return true;
    }
    if (message.seq !== this.connInSeq) {
      this.log(
        `runner: rejected pong with unexpected seq ${String(message.seq)}`,
      );
      return true;
    }
    this.connInSeq = message.seq + 1;
    return true;
  }

  private sendBridgeResult(
    child: ChildProcess,
    task: Task,
    callId: number,
    outcome: { ok: true; value: unknown } | { ok: false; error: BridgeError },
  ): void {
    const message: IpcMessage = outcome.ok
      ? {
          v: 1,
          type: 'bridge_result',
          taskId: task.id,
          seq: task.outSeq++,
          callId,
          ok: true,
          value: outcome.value,
        }
      : {
          v: 1,
          type: 'bridge_result',
          taskId: task.id,
          seq: task.outSeq++,
          callId,
          ok: false,
          error: outcome.error,
        };
    this.send(child, message, () => {
      if (this.active === task) this.end({ status: 'crashed' }, true);
    });
  }

  private line(child: ChildProcess, line: string) {
    const message = decodeLine(line);
    if (!record(message)) {
      this.log('runner: rejected undecodable IPC line');
      if (this.active) this.end({ status: 'failed', reason: 'protocol' }, true);
      return;
    }
    if (message.v !== 1 || typeof message.type !== 'string') {
      this.log('runner: rejected IPC message without v:1 envelope');
      if (this.active) this.end({ status: 'failed', reason: 'protocol' }, true);
      return;
    }
    if (this.handlePong(message)) return;
    const task = this.active;
    if (!task || message.taskId !== task.id) {
      this.log(
        `runner: ignored IPC message for unknown task ${String(message.taskId)}`,
      );
      return;
    }
    const seq = message.seq;
    if (
      typeof seq !== 'number' ||
      !Number.isSafeInteger(seq) ||
      seq !== task.inSeq
    ) {
      this.log(
        `runner: rejected ${message.type} with unexpected seq ${String(seq)} for task ${task.id}`,
      );
      return;
    }
    task.inSeq = seq + 1;
    if (message.type === 'bridge_call') this.bridgeCall(child, task, message);
    else if (message.type === 'task_result') this.taskResult(task, message);
    else {
      this.log(
        `runner: rejected unexpected IPC type ${message.type} for task ${task.id}`,
      );
      this.end({ status: 'failed', reason: 'protocol' }, true);
    }
  }

  private bridgeCall(child: ChildProcess, task: Task, value: unknown) {
    if (
      !isBridgeCall(value) ||
      value.callId !== task.calls.size + 1 ||
      value.callId > task.runLimits.maxBridgeCalls
    ) {
      this.log(`runner: rejected bridge_call for task ${task.id}`);
      this.end({ status: 'failed', reason: 'protocol' }, true);
      return;
    }
    task.calls.add(value.callId);
    task.pending.add(value.callId);
    Promise.resolve()
      .then(async () => {
        if (
          this.active !== task ||
          this.closed ||
          task.controller.signal.aborted
        )
          throw new Error('cancelled');
        if (this.inFlight >= limits.maxCalls) throw new Error('bridge busy');
        ++this.inFlight;
        try {
          return await task.invoke(
            value.method,
            JSON.stringify(value.args),
            task.controller.signal,
          );
        } finally {
          --this.inFlight;
        }
      })
      .then((json) => {
        if (this.active !== task) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(json) as unknown;
        } catch {
          this.end({ status: 'failed', reason: 'protocol' }, true);
          return;
        }
        if (!bounded(json, task.runLimits.maxOutputBytes)) {
          this.end({ status: 'failed', reason: 'protocol' }, true);
          return;
        }
        task.pending.delete(value.callId);
        this.sendBridgeResult(child, task, value.callId, {
          ok: true,
          value: parsed,
        });
      })
      .catch((error: unknown) => {
        if (this.active !== task) return;
        // Per-call bridge failure: report it as bridge_result ok:false so
        // the script sees an SdkError with the daemon's code; the task
        // itself continues unless the script lets the error escape.
        const maybeCode =
          error instanceof Error
            ? (error as { code?: unknown }).code
            : undefined;
        const code =
          typeof maybeCode === 'string' && maybeCode.length > 0
            ? maybeCode
            : 'BRIDGE_REJECTED';
        const messageText =
          error instanceof Error ? error.message : 'bridge rejected';
        task.pending.delete(value.callId);
        this.sendBridgeResult(child, task, value.callId, {
          ok: false,
          error: { code, message: messageText },
        });
      });
  }

  private taskResult(task: Task, value: unknown) {
    if (!isTaskResult(value)) {
      this.log(`runner: rejected malformed task_result for task ${task.id}`);
      this.end({ status: 'failed', reason: 'protocol' }, true);
      return;
    }
    // A task_result that reports unknown is *defined* by a bridge call
    // still being in flight (its side effect may or may not have happened),
    // so unsettled calls are expected for that state, not a violation. Any
    // other terminal state with unsettled calls means the worker broke its
    // promise to settle every bridge call before reporting.
    if (task.pending.size && value.state !== 'unknown') {
      this.log(
        `runner: rejected task_result with ${String(task.pending.size)} unsettled bridge calls`,
      );
      this.end({ status: 'failed', reason: 'protocol' }, true);
      return;
    }
    let result: Result = { status: 'failed', reason: 'protocol' };
    let replace = false;
    switch (value.state) {
      case 'succeeded': {
        const json = JSON.stringify(value.result ?? null);
        result = bounded(json, task.runLimits.maxOutputBytes)
          ? { status: 'completed', json }
          : { status: 'failed', reason: 'output' };
        break;
      }
      case 'failed':
        if (value.error?.code === 'TIMEOUT') {
          result = { status: 'timeout' };
          replace = true;
        } else {
          result = { status: 'failed', reason: value.reason ?? 'script' };
        }
        break;
      case 'cancelled':
        result = { status: 'cancelled' };
        break;
      case 'unknown':
        result = { status: 'unknown' };
        replace = true;
        break;
    }
    this.end(result, replace);
  }

  private end(result: Result, replace: boolean) {
    const task = this.active;
    this.active = undefined;
    if (task) {
      task.controller.abort();
      clearTimeout(task.timer);
      task.resolve(result);
    }
    if (replace && this.child) {
      const child = this.child;
      this.child = undefined;
      this.retiring = true;
      const stopped = () => {
        child.removeListener('exit', stopped);
        child.removeListener('close', stopped);
        this.retiring = false;
        this.next();
      };
      child.once('exit', stopped);
      child.once('close', stopped);
      child.kill('SIGKILL');
      return;
    }
    this.next();
  }
}
