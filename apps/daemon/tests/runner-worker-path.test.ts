import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runnerWorkerPath } from '../src/runner-worker-path.js';

describe('QuickJS worker location across source and installed layouts', () => {
  it('loads a source-build worker from its own repository', () => {
    const moduleUrl = pathToFileURL(
      resolve('apps/daemon/dist/executions.js'),
    ).href;
    expect(runnerWorkerPath(moduleUrl)).toBe(
      resolve('packages/runner/worker.mjs'),
    );
  });

  it('loads the bundled worker next to the installed daemon entry', () => {
    const moduleUrl = pathToFileURL(
      resolve('artifacts/avru-prod/payload/daemon.mjs'),
    ).href;
    expect(runnerWorkerPath(moduleUrl)).toBe(
      resolve('artifacts/avru-prod/payload/runner/worker.mjs'),
    );
    expect(runnerWorkerPath(moduleUrl)).not.toBe(
      resolve('packages/runner/worker.mjs'),
    );
  });

  it('does not depend on the install directory name or a checkout layout', () => {
    const moduleUrl = pathToFileURL(
      resolve('dist/isolated-install/daemon.mjs'),
    ).href;
    expect(runnerWorkerPath(moduleUrl)).toBe(
      resolve('dist/isolated-install/runner/worker.mjs'),
    );
  });
});
