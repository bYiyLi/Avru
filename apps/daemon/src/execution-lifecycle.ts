import type { Connections } from './connections.js';
import type { Entry } from './execution-types.js';

/** Chrome's Cancel button stops only the task controlling that exact tab. */
export function interruptExecution(
  entry: Entry | null,
  browserId: string,
  tabId: number,
): void {
  if (
    !entry ||
    entry.settled ||
    entry.target?.browserId !== browserId ||
    entry.target.tabId !== tabId
  )
    return;
  if (entry.inFlight > 0) entry.uncertainEffect = true;
  entry.cancelReason = 'USER_STOPPED';
  entry.runner?.cancel();
}

/** Start/finish signals are cosmetic and must not cause action retries. */
export function notifyExecutionVisual(
  connections: Connections,
  entry: Entry,
  phase: 'start' | 'finish',
): void {
  if (!entry.target || typeof connections.sendAction !== 'function') return;
  void connections
    .sendAction({
      ...entry.target,
      method: `tab.execution.${phase}`,
      args:
        phase === 'start'
          ? [entry.id, entry.taskName ?? 'Avru']
          : [entry.id, entry.state],
    })
    .catch(() => {
      // An unavailable overlay never changes execution semantics.
    });
}
