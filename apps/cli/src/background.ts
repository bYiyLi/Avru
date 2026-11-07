import {
  channelPort,
  releaseChannel,
} from '../../../packages/protocol/environment.js';
import { readRootChannel } from './channel-root.js';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readActive } from './install-files.js';
import { inspectRuntime, startRuntime } from './runtime.js';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const channel = await readRootChannel(root);
if (channel !== releaseChannel()) throw new Error('Launcher channel mismatch');
const active = await readActive(join(root, 'program'));
if (!active)
  throw new Error('Avru installation is missing. Run the installer again.');
const payloadRoot = join(root, 'program', 'releases', active.release);
if (process.platform === 'darwin') {
  // launchd owns this long-running process rather than a launcher that exits early.
  if (!(await inspectRuntime(root, channel))) {
    process.env.AVRU_CHANNEL = channel;
    process.env.AVRU_PORT ??= String(channelPort(channel));
    process.env.AVRU_DATA_DIR = root;
    process.env.AVRU_WEB_ROOT = join(payloadRoot, 'web');
    await import(pathToFileURL(join(payloadRoot, 'daemon.cjs')).href);
  }
} else {
  await startRuntime({
    dataRoot: root,
    channel,
    payloadRoot,
    execPath: active.execPath,
    port: Number(process.env.AVRU_PORT ?? channelPort(channel)),
  });
}
