import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { bounded, isCall, isDone, limits, type Result } from './protocol.js';
import type { Bridge } from './engine.js';
interface Task {
  id: string;
  code: string;
  invoke: Bridge;
  resolve: (result: Result) => void;
  timer?: ReturnType<typeof setTimeout>;
  calls: Set<number>;
  pending: Set<number>;
  controller: AbortController;
}
export interface Execution {
  id: string;
  result: Promise<Result>;
  cancel: () => void;
}
export type Factory = () => ChildProcess;
function startChild() {
  return fork(fileURLToPath(new URL('../worker.mjs', import.meta.url)), [], {
    env: {},
    execArgv: ['--max-old-space-size=64'],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    serialization: 'json',
  });
}
const deny: Bridge = () => Promise.reject(new Error('denied'));
/** Internal foundation only: not instantiated by daemon or exposed to MCP. */
export class Runner {
  private child: ChildProcess | undefined;
  private active: Task | undefined;
  private queue: Task[] = [];
  private closed = false;
  private retiring = false;
  private inFlight = 0;
  constructor(private readonly factory: Factory = startChild) {}
  run(code: string, invoke: Bridge = deny): Execution {
    if (this.closed) throw new Error('runner closed');
    if (!bounded(code, limits.sourceBytes)) throw new Error('source limit');
    if (this.queue.length >= limits.maxQueue) throw new Error('queue full');
    const id = randomUUID();
    const result = new Promise<Result>((resolve) => {
      this.queue.push({
        id,
        code,
        invoke,
        resolve,
        calls: new Set(),
        pending: new Set(),
        controller: new AbortController(),
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
    else if (this.active?.id === id) this.end({ status: 'cancelled' }, true);
  }
  private next() {
    if (this.closed || this.retiring || this.active || !this.queue.length)
      return;
    this.active = this.queue.shift();
    try {
      if (!this.child) this.connect();
      const task = this.active;
      if (!task) return;
      task.timer = setTimeout(() => {
        this.end({ status: 'timeout' }, true);
      }, limits.timeoutMs);
      this.child?.send(
        { type: 'run', id: task.id, code: task.code },
        (error) => {
          if (error && this.active === task)
            this.end({ status: 'crashed' }, true);
        },
      );
    } catch {
      this.end({ status: 'crashed' }, true);
    }
  }
  private connect() {
    const child = this.factory();
    this.child = child;
    child.on('message', (message: unknown) => {
      if (this.child === child) this.message(message);
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
  }
  private message(message: unknown) {
    const task = this.active;
    if (!task) {
      this.end({ status: 'failed', reason: 'protocol' }, true);
      return;
    }
    if (isDone(message) && message.id === task.id) {
      if (task.pending.size) {
        this.end({ status: 'failed', reason: 'protocol' }, true);
        return;
      }
      this.end(message.result, message.result.status === 'timeout');
      return;
    }
    if (
      !isCall(message) ||
      message.id !== task.id ||
      message.call !== task.calls.size + 1
    ) {
      this.end({ status: 'failed', reason: 'protocol' }, true);
      return;
    }
    task.calls.add(message.call);
    task.pending.add(message.call);
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
            message.method,
            message.json,
            task.controller.signal,
          );
        } finally {
          --this.inFlight;
        }
      })
      .then((json) => {
        if (this.active !== task) return;
        if (!bounded(json, limits.valueBytes)) {
          this.end({ status: 'failed', reason: 'protocol' }, true);
          return;
        }
        task.pending.delete(message.call);
        this.child?.send(
          { type: 'reply', id: task.id, call: message.call, json },
          (error) => {
            if (error && this.active === task)
              this.end({ status: 'crashed' }, true);
          },
        );
      })
      .catch(() => {
        if (this.active === task)
          this.end({ status: 'failed', reason: 'script' }, true);
      });
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
