import { homedir } from 'node:os';
import { join } from 'node:path';
import { readActive } from './install-files.js';
import { startRuntime } from './runtime.js';
const root = process.env.AVRU_DATA_DIR ?? join(homedir(), '.avru');
const active = await readActive(join(root, 'program'));
if (!active)
  throw new Error('Avru installation is missing. Run the installer again.');
await startRuntime({
  dataRoot: root,
  payloadRoot: join(root, 'program', 'releases', active.release),
  execPath: active.execPath,
});
