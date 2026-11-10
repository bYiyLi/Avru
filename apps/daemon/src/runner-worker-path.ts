import { fileURLToPath } from 'node:url';

/** Source builds use the checkout worker; standalone payloads carry their own. */
export function runnerWorkerPath(moduleUrl: string): string {
  return fileURLToPath(
    new URL(
      moduleUrl.endsWith('/daemon.mjs')
        ? './runner/worker.mjs'
        : '../../../packages/runner/worker.mjs',
      moduleUrl,
    ),
  );
}
