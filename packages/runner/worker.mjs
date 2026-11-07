// Thin isolated-process bootstrap. Real-process tests exercise startup races.
if (!process.send) throw new Error('IPC required');
if (!process.connected) process.exit(0);
process.on('disconnect', () => process.exit(0));
const waiting = [];
let receive = (message) => {
  if (waiting.length) process.exit(1);
  waiting.push(message);
};
process.on('message', (message) => receive(message));
const { attachWorker } = await import('./dist/worker.js');
attachWorker({
  onMessage: (listener) => {
    receive = listener;
    for (const message of waiting.splice(0)) listener(message);
  },
  send: (message) => process.send(message),
  stop: () => process.exit(1),
});
