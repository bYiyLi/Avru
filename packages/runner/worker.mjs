// Thin isolated-process bootstrap: NDJSON over inherited private pipes.
// fd 3: parent -> worker, fd 4: worker -> parent. No ports, no inherited
// environment, fixed Node args (see supervisor startChild). A line that is
// not JSON or exceeds 64 KiB fails the process closed (the supervisor
// reports the task crashed and rebuilds a fresh child for the next task);
// a well-formed but invalid run_task is rejected by attachWorker, which
// exits the same way.
import { createReadStream, createWriteStream, fstatSync } from 'node:fs';

try {
  fstatSync(3);
  fstatSync(4);
} catch {
  process.exit(1);
}
const input = createReadStream('', { fd: 3 });
const output = createWriteStream('', { fd: 4 });
input.on('error', () => process.exit(1));
output.on('error', () => process.exit(1));
input.on('end', () => process.exit(0));
input.on('close', () => process.exit(0));

const waiting = [];
let receive = (message) => {
  waiting.push(message);
};
let buffer = '';
input.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let newline = buffer.indexOf('\n');
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.length > 0) {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        process.exit(1);
      }
      if (Buffer.byteLength(line, 'utf8') > 64 * 1024) process.exit(1);
      receive(message);
    }
    newline = buffer.indexOf('\n');
  }
  if (Buffer.byteLength(buffer, 'utf8') > 64 * 1024) process.exit(1);
});

const { attachWorker } = await import('./dist/worker.js');
attachWorker({
  onMessage: (listener) => {
    receive = listener;
    for (const message of waiting.splice(0)) listener(message);
  },
  send: (message) => {
    output.write(`${JSON.stringify(message)}\n`);
  },
  stop: () => process.exit(1),
});
