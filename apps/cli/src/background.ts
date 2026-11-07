import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readActive } from './install-files.js';
import { inspectRuntime, startRuntime } from './runtime.js';
const root = process.env.AVRU_DATA_DIR ?? join(homedir(), '.avru');
const active = await readActive(join(root, 'program'));
if (!active)
  throw new Error('Avru installation is missing. Run the installer again.');
const payloadRoot = join(root, 'program', 'releases', active.release);
if (process.platform === 'darwin') {
  // launchd owns this long-running process rather than a launcher that exits early.
  if (!(await inspectRuntime(root))) {
    process.env.AVRU_DATA_DIR = root;
    process.env.AVRU_WEB_ROOT = join(payloadRoot, 'web');
    await import(pathToFileURL(join(payloadRoot, 'daemon.cjs')).href);
  }
} else {
  await startRuntime({
    dataRoot: root,
    payloadRoot,
    execPath: active.execPath,
  });
}
