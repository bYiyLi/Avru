import { execute } from './engine.js';
import { isReply, isRun } from './protocol.js';
import type { CallMessage, DoneMessage } from './protocol.js';
export interface WorkerPort {
  onMessage: (listener: (message: unknown) => void) => void;
  send: (message: CallMessage | DoneMessage) => void;
  stop: () => void;
}
export function attachWorker(port: WorkerPort) {
  let active: string | undefined;
  let call = 0;
  const pending = new Map<number, (json: string) => void>();
  port.onMessage((message) => {
    if (
      isReply(message) &&
      message.id === active &&
      pending.has(message.call)
    ) {
      pending.get(message.call)?.(message.json);
      pending.delete(message.call);
      return;
    }
    if (!isRun(message) || active) {
      port.stop();
      return;
    }
    active = message.id;
    call = 0;
    const invoke = (method: string, json: string) =>
      new Promise<string>((resolve) => {
        ++call;
        pending.set(call, resolve);
        port.send({ type: 'call', id: message.id, call, method, json });
      });
    execute(message.code, invoke)
      .then((result) => {
        pending.clear();
        active = undefined;
        port.send({ type: 'done', id: message.id, result });
      })
      .catch(() => {
        port.stop();
      });
  });
}
