import {
  getQuickJS,
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
  type QuickJSRuntime,
} from 'quickjs-emscripten';
import { bounded, clampInt, limits, type Result } from './protocol.js';
import { installSdk, type SdkTarget } from './sdk.js';

export type Bridge = (
  method: string,
  json: string,
  signal: AbortSignal,
) => Promise<string>;
type GuestBridge = (method: string, json: string) => Promise<string>;
const denied: Bridge = () => Promise.reject(new Error('denied'));

export interface ExecuteOptions {
  /** Claimed target tab (run_task.target); its ids are exposed on browser.tab. */
  target?: SdkTarget;
  /** External cancellation (worker cancel_task); aborts in-flight bridges. */
  signal?: AbortSignal;
  /** Per-task budgets, clamped to the global limits when given. */
  maxOutputBytes?: number;
  maxBridgeCalls?: number;
}

/** Error code carried by a rejected bridge call, if any (else fallback). */
function bridgeErrorCode(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return 'BRIDGE_REJECTED';
}

/** No host API except this explicit internal bridge; no module loader. */
function installBridge(
  vm: QuickJSContext,
  invoke: GuestBridge,
  alive: () => boolean,
  maxCalls: number,
) {
  let calls = 0;
  let unsettled = 0;
  const pending: QuickJSDeferredPromise[] = [];
  const bridge = vm.newFunction('__hostCall', (methodHandle, inputHandle) => {
    const method = vm.getString(methodHandle);
    const json = vm.getString(inputHandle);
    if (
      !/^[a-z][A-Za-z0-9.]{0,63}$/u.test(method) ||
      !bounded(json, limits.valueBytes) ||
      ++calls > maxCalls
    )
      throw new Error('bridge limit');
    const deferred = vm.newPromise();
    pending.push(deferred);
    ++unsettled;
    Promise.resolve()
      .then(() => invoke(method, json))
      .then(
        (response) => {
          if (!alive()) return;
          if (!bounded(response, limits.valueBytes)) {
            const error = vm.newError('bridge limit');
            deferred.reject(error);
            error.dispose();
          } else {
            const value = vm.newString(response);
            deferred.resolve(value);
            value.dispose();
          }
        },
        (error: unknown) => {
          if (!alive()) return;
          // Carry the bridge error code into the guest so the SDK shell can
          // rethrow it as an SdkError with the daemon's code (BRIDGE_REJECTED
          // when the host gave no code).
          const code = bridgeErrorCode(error);
          const message =
            error instanceof Error ? error.message : 'bridge rejected';
          const hostError = vm.newError(message);
          const codeHandle = vm.newString(code);
          vm.setProp(hostError, 'code', codeHandle);
          codeHandle.dispose();
          deferred.reject(hostError);
          hostError.dispose();
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

interface ResultOfOptions {
  vm: QuickJSContext;
  code: string;
  deadline: number;
  pending: () => boolean;
  signal: AbortSignal | undefined;
  maxOutputBytes: number;
}

/** Read one settled promise state; undefined means keep pumping jobs. */
function settle(
  options: ResultOfOptions,
  handle: QuickJSHandle,
): Result | undefined {
  const { vm, pending, signal, maxOutputBytes } = options;
  if (signal?.aborted) return { status: 'cancelled' };
  const state = vm.getPromiseState(handle);
  if (state.type === 'rejected') {
    state.error.dispose();
    return signal?.aborted
      ? { status: 'cancelled' }
      : { status: 'failed', reason: 'script' };
  }
  if (state.type === 'fulfilled') {
    const json = vm.getString(state.value);
    state.value.dispose();
    if (pending() || vm.runtime.hasPendingJob()) return undefined;
    return bounded(json, maxOutputBytes)
      ? { status: 'completed', json }
      : { status: 'failed', reason: 'output' };
  }
  return undefined;
}

async function resultOf(options: ResultOfOptions): Promise<Result> {
  const { vm, code, deadline, pending } = options;
  const evaluated = vm.evalCode(
    `(async () => { const value = await (async () => { ${code}\n})(); return JSON.stringify(value) ?? 'null'; })()`,
  );
  if (evaluated.error) {
    evaluated.error.dispose();
    // The interrupt handler also fires while evaluating when the external
    // signal was already aborted; that is a cancellation, not a script bug.
    return options.signal?.aborted
      ? { status: 'cancelled' }
      : { status: 'failed', reason: 'script' };
  }
  const handle = evaluated.value;
  try {
    while (Date.now() < deadline) {
      const settled = settle(options, handle);
      if (settled) return settled;
      await pump(vm.runtime);
    }
    // Deadline reached: a bridge call still in flight means its side effect
    // may or may not have happened, so the result is unknown; pure
    // computation timing out is a plain timeout (browser-sdk.md state
    // machine). The supervisor applies the same rule with its own clock.
    return pending() ? { status: 'unknown' } : { status: 'timeout' };
  } finally {
    handle.dispose();
  }
}

export async function execute(
  code: string,
  invoke: Bridge = denied,
  timeoutMs: number = limits.timeoutMs,
  options: ExecuteOptions = {},
): Promise<Result> {
  if (!bounded(code, limits.sourceBytes))
    return { status: 'failed', reason: 'protocol' };
  const maxOutputBytes = clampInt(options.maxOutputBytes, limits.valueBytes);
  const maxBridgeCalls = clampInt(options.maxBridgeCalls, limits.maxCalls);
  const module = await getQuickJS();
  const runtime = module.newRuntime();
  runtime.setMemoryLimit(limits.heapBytes);
  runtime.setMaxStackSize(limits.stackBytes);
  const deadline = Date.now() + timeoutMs;
  runtime.setInterruptHandler(
    () => Date.now() >= deadline || options.signal?.aborted === true,
  );
  const vm = runtime.newContext();
  let alive = true;
  const controller = new AbortController();
  const onExternalAbort = () => {
    controller.abort();
  };
  options.signal?.addEventListener('abort', onExternalAbort, { once: true });
  const bridge = installBridge(
    vm,
    (method, json) => invoke(method, json, controller.signal),
    () => alive,
    maxBridgeCalls,
  );
  try {
    try {
      installSdk(vm, options.target);
    } catch {
      // The interrupt handler also fires while installing when the external
      // signal was already aborted; that is a cancellation, not an install
      // failure.
      return options.signal?.aborted
        ? { status: 'cancelled' }
        : { status: 'failed', reason: 'protocol' };
    }
    const result = await resultOf({
      vm,
      code,
      deadline,
      pending: bridge.pending,
      signal: options.signal,
      maxOutputBytes,
    });
    if (options.signal?.aborted) return { status: 'cancelled' };
    if (Date.now() >= deadline)
      return bridge.pending() ? { status: 'unknown' } : { status: 'timeout' };
    return result;
  } catch {
    // An interrupt fired by the deadline or by cancellation surfaces here
    // as a script error; cancellation wins over the script failure.
    return options.signal?.aborted
      ? { status: 'cancelled' }
      : { status: 'failed', reason: 'script' };
  } finally {
    alive = false;
    options.signal?.removeEventListener('abort', onExternalAbort);
    controller.abort();
    bridge.cleanup();
    vm.dispose();
    runtime.dispose();
  }
}
