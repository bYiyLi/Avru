import {
  getQuickJS,
  type QuickJSContext,
  type QuickJSRuntime,
  type QuickJSDeferredPromise,
} from 'quickjs-emscripten';
import { bounded, limits, type Result } from './protocol.js';
export type Bridge = (
  method: string,
  json: string,
  signal: AbortSignal,
) => Promise<string>;
type GuestBridge = (method: string, json: string) => Promise<string>;
const denied: Bridge = () => Promise.reject(new Error('denied'));

/** No host API except this explicit internal bridge; no module loader. */
function installBridge(
  vm: QuickJSContext,
  invoke: GuestBridge,
  alive: () => boolean,
) {
  let calls = 0;
  let unsettled = 0;
  let failed = false;
  const pending: QuickJSDeferredPromise[] = [];
  const bridge = vm.newFunction('__hostCall', (methodHandle, inputHandle) => {
    const method = vm.getString(methodHandle);
    const json = vm.getString(inputHandle);
    if (
      !/^[a-z][a-z0-9.]{0,63}$/u.test(method) ||
      !bounded(json, limits.valueBytes) ||
      ++calls > limits.maxCalls
    )
      throw new Error('bridge limit');
    const deferred = vm.newPromise();
    pending.push(deferred);
    ++unsettled;
    invoke(method, json)
      .then(
        (response) => {
          if (!alive()) return;
          if (!bounded(response, limits.valueBytes)) {
            failed = true;
            const error = vm.newError('bridge limit');
            deferred.reject(error);
            error.dispose();
          } else {
            const value = vm.newString(response);
            deferred.resolve(value);
            value.dispose();
          }
        },
        () => {
          if (!alive()) return;
          failed = true;
          const error = vm.newError('bridge denied');
          deferred.reject(error);
          error.dispose();
        },
      )
      .finally(() => {
        --unsettled;
      })
      .catch(() => {
        /* Engine disposal wins over late host results. */
      });
    return deferred.handle;
  });
  vm.setProp(vm.global, '__hostCall', bridge);
  bridge.dispose();
  return {
    pending: () => unsettled > 0,
    failed: () => failed,
    cleanup: () => {
      for (const promise of pending) promise.dispose();
    },
  };
}
function pump(runtime: QuickJSRuntime): Promise<void> {
  const jobs = runtime.executePendingJobs(32);
  if (jobs.error) {
    jobs.error.dispose();
    throw new Error('script');
  }
  return new Promise((resolve) => setTimeout(resolve, 1));
}
async function resultOf(
  vm: QuickJSContext,
  code: string,
  deadline: number,
  pending: () => boolean,
): Promise<Result> {
  const evaluated = vm.evalCode(
    `(async () => { const value = await (async () => { ${code}\n})(); return JSON.stringify(value) ?? 'null'; })()`,
  );
  if (evaluated.error) {
    evaluated.error.dispose();
    return { status: 'failed', reason: 'script' };
  }
  const handle = evaluated.value;
  try {
    while (Date.now() < deadline) {
      const state = vm.getPromiseState(handle);
      if (state.type === 'rejected') {
        state.error.dispose();
        return { status: 'failed', reason: 'script' };
      }
      if (state.type === 'fulfilled') {
        const json = vm.getString(state.value);
        state.value.dispose();
        if (pending() || vm.runtime.hasPendingJob()) {
          await pump(vm.runtime);
          continue;
        }
        return bounded(json, limits.valueBytes)
          ? { status: 'completed', json }
          : { status: 'failed', reason: 'output' };
      }
      await pump(vm.runtime);
    }
    return { status: 'timeout' };
  } finally {
    handle.dispose();
  }
}
export async function execute(
  code: string,
  invoke: Bridge = denied,
  timeoutMs: number = limits.timeoutMs,
): Promise<Result> {
  if (!bounded(code, limits.sourceBytes))
    return { status: 'failed', reason: 'protocol' };
  const module = await getQuickJS();
  const runtime = module.newRuntime();
  runtime.setMemoryLimit(limits.heapBytes);
  runtime.setMaxStackSize(limits.stackBytes);
  const deadline = Date.now() + timeoutMs;
  runtime.setInterruptHandler(() => Date.now() >= deadline);
  const vm = runtime.newContext();
  let alive = true;
  const controller = new AbortController();
  const bridge = installBridge(
    vm,
    (method, json) => invoke(method, json, controller.signal),
    () => alive,
  );
  try {
    const result = await resultOf(vm, code, deadline, bridge.pending);
    if (Date.now() >= deadline) return { status: 'timeout' };
    return bridge.failed() ? { status: 'failed', reason: 'script' } : result;
  } catch {
    return { status: 'failed', reason: 'script' };
  } finally {
    alive = false;
    controller.abort();
    bridge.cleanup();
    vm.dispose();
    runtime.dispose();
  }
}
