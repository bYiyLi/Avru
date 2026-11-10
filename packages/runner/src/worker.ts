import { execute, type Bridge } from './engine.js';
import {
  isBridgeResult,
  isCancelTask,
  isPing,
  isRunTask,
  type BridgeError,
  type FailureReason,
  type IpcMessage,
  type Result,
  type RunTaskMessage,
  type TaskState,
} from './protocol.js';

export interface WorkerPort {
  onMessage: (listener: (message: unknown) => void) => void;
  send: (message: IpcMessage) => void;
  stop: () => void;
}

export type WorkerLog = (message: string) => void;

function codedError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

function taskResultBody(result: Result): {
  state: TaskState;
  result?: unknown;
  error?: BridgeError;
  reason?: FailureReason;
} {
  switch (result.status) {
    case 'completed': {
      try {
        return {
          state: 'succeeded',
          result: JSON.parse(result.json) as unknown,
        };
      } catch {
        return { state: 'failed', reason: 'protocol' };
      }
    }
    case 'failed':
      return { state: 'failed', reason: result.reason };
    case 'timeout':
      // The supervisor maps this to timeout (pure compute) or unknown
      // (bridge in flight) with its own clock; see supervisor.taskResult.
      return {
        state: 'failed',
        error: { code: 'TIMEOUT', message: 'task timed out' },
      };
    case 'cancelled':
      return { state: 'cancelled' };
    case 'unknown':
      return {
        state: 'unknown',
        error: {
          code: 'UNKNOWN_RESULT',
          message: 'a bridge call may have executed; result unknown',
        },
      };
    case 'crashed':
      // Unreachable: a worker cannot report its own crash.
      return { state: 'failed', reason: 'protocol' };
  }
}

interface WorkerState {
  active: string | undefined;
  controller: AbortController | undefined;
  /** Next expected inbound seq (run_task consumed seq 1). */
  inSeq: number;
  /** Next outbound seq (first bridge_call / task_result uses seq 1). */
  outSeq: number;
  /** Connection-scoped ping/pong seq (taskId ''). */
  connInSeq: number;
  connOutSeq: number;
  callId: number;
  finished: boolean;
  pending: Map<
    number,
    { resolve: (json: string) => void; reject: (error: Error) => void }
  >;
}

function createWorkerState(): WorkerState {
  return {
    active: undefined,
    controller: undefined,
    inSeq: 0,
    outSeq: 0,
    connInSeq: 0,
    connOutSeq: 0,
    callId: 0,
    finished: false,
    pending: new Map(),
  };
}

function startTask(
  state: WorkerState,
  port: WorkerPort,
  message: RunTaskMessage,
) {
  state.active = message.taskId;
  state.inSeq = 1;
  state.outSeq = 0;
  state.callId = 0;
  state.finished = false;
  state.pending.clear();
  const taskController = new AbortController();
  state.controller = taskController;
  const invoke: Bridge = (method, json, signal) =>
    new Promise<string>((resolve, reject) => {
      if (state.finished || state.active !== message.taskId) {
        reject(codedError('BRIDGE_REJECTED', 'task is finished'));
        return;
      }
      if (signal.aborted) {
        reject(codedError('BRIDGE_REJECTED', 'bridge aborted'));
        return;
      }
      let args: unknown;
      try {
        args = JSON.parse(json) as unknown;
      } catch {
        reject(codedError('INVALID_ARGUMENT', 'bridge args must be JSON'));
        return;
      }
      const id = ++state.callId;
      const onAbort = () => {
        state.pending.delete(id);
        reject(codedError('BRIDGE_REJECTED', 'bridge aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      state.pending.set(id, {
        resolve: (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        reject: (error) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      });
      port.send({
        v: 1,
        type: 'bridge_call',
        taskId: message.taskId,
        seq: ++state.outSeq,
        callId: id,
        method,
        args,
      });
    });
  execute(message.script, invoke, message.limits.timeoutMs, {
    ...(message.target !== undefined ? { target: message.target } : {}),
    signal: taskController.signal,
    maxOutputBytes: message.limits.maxOutputBytes,
    maxBridgeCalls: message.limits.maxBridgeCalls,
  })
    .then((result) => {
      state.pending.clear();
      state.finished = true;
      state.active = undefined;
      state.controller = undefined;
      port.send({
        v: 1,
        type: 'task_result',
        taskId: message.taskId,
        seq: ++state.outSeq,
        ...taskResultBody(result),
      });
    })
    .catch(() => {
      port.stop();
    });
}

/** Connection-scoped ping; true when the message was a ping. */
function handlePing(
  state: WorkerState,
  port: WorkerPort,
  log: WorkerLog,
  message: unknown,
): boolean {
  if (!isPing(message)) return false;
  if (message.seq !== state.connInSeq + 1) {
    log(`worker: rejected ping with unexpected seq ${String(message.seq)}`);
    return true;
  }
  state.connInSeq = message.seq;
  port.send({ v: 1, type: 'pong', taskId: '', seq: ++state.connOutSeq });
  return true;
}

/**
 * cancel_task / bridge_result for the active task; true when handled.
 * Late results (wrong task, after task_result, unknown callId) are dropped,
 * never forwarded to the engine.
 */
function handleTaskMessage(
  state: WorkerState,
  log: WorkerLog,
  message: unknown,
): boolean {
  if (isCancelTask(message)) {
    if (message.taskId !== state.active) {
      log('worker: ignored cancel_task for unknown or finished task');
      return true;
    }
    if (message.seq !== state.inSeq + 1) {
      log(
        `worker: rejected cancel_task with unexpected seq ${String(message.seq)}`,
      );
      return true;
    }
    state.inSeq = message.seq;
    state.controller?.abort();
    return true;
  }
  if (isBridgeResult(message)) {
    if (message.taskId !== state.active || state.finished) {
      log('worker: dropped late bridge_result');
      return true;
    }
    if (message.seq !== state.inSeq + 1) {
      log(
        `worker: rejected bridge_result with unexpected seq ${String(message.seq)}`,
      );
      return true;
    }
    state.inSeq = message.seq;
    const entry = state.pending.get(message.callId);
    if (!entry) {
      log(
        `worker: dropped bridge_result for unknown call ${String(message.callId)}`,
      );
      return true;
    }
    state.pending.delete(message.callId);
    if (message.ok) entry.resolve(JSON.stringify(message.value ?? null));
    else
      entry.reject(
        codedError(
          message.error?.code ?? 'BRIDGE_REJECTED',
          message.error?.message ?? 'bridge rejected',
        ),
      );
    return true;
  }
  return false;
}

function dispatchMessage(
  state: WorkerState,
  port: WorkerPort,
  log: WorkerLog,
  message: unknown,
): void {
  if (handlePing(state, port, log, message)) return;
  if (isRunTask(message)) {
    if (state.active !== undefined) {
      log('worker: rejected run_task while a task is active');
      port.stop();
      return;
    }
    startTask(state, port, message);
    return;
  }
  if (handleTaskMessage(state, log, message)) return;
  log('worker: rejected unknown IPC message');
  // Fail closed: an unrecognized message means the other end is broken.
  port.stop();
}

export function attachWorker(
  port: WorkerPort,
  log: WorkerLog = (message) => {
    console.error(message);
  },
) {
  const state = createWorkerState();
  port.onMessage((message) => {
    dispatchMessage(state, port, log, message);
  });
}
