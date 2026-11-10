import type { Connections } from './connections.js';
import { unknownAfterDispatch } from './execution-types.js';

export interface CdpBridgeRequest {
  target?: { browserId: string; tabId: number; generation: number } | undefined;
  method: 'cdp.send' | 'cdp.events' | 'cdp.cursor';
  args: unknown[];
  signal: AbortSignal;
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** One exact-target CDP request. The CDP command namespace is unrestricted. */
export async function executeCdpAction(
  connections: Pick<Connections, 'generation' | 'sendAction'>,
  request: CdpBridgeRequest,
): Promise<unknown> {
  const { target, method, args, signal } = request;
  if (!target) throw new Error('INVALID_TARGET');
  if (isAborted(signal)) throw new Error('CANCELLED');
  if (connections.generation(target.browserId) !== target.generation)
    throw new Error('INVALID_TARGET');
  if (!validCdpArguments(method, args)) throw new Error('INVALID_ARGUMENT');
  const result = await connections.sendAction({
    browserId: target.browserId,
    tabId: target.tabId,
    generation: target.generation,
    method,
    args,
  });
  if (isAborted(signal)) throw new Error('UNKNOWN_RESULT');
  if (!result.ok)
    throw new Error(
      unknownAfterDispatch(result.error.code)
        ? 'UNKNOWN_RESULT'
        : result.error.code,
    );
  return result.value;
}

export function validCdpArguments(
  method: CdpBridgeRequest['method'],
  args: unknown[],
): boolean {
  if (method === 'cdp.cursor') return args.length === 0;
  if (method === 'cdp.events')
    return (
      args.length <= 1 &&
      (args.length === 0 ||
        (typeof args[0] === 'string' && /^\d+$/u.test(args[0])))
    );
  if (args.length < 1 || args.length > 2 || typeof args[0] !== 'string')
    return false;
  if (!/^[A-Za-z][\w.]{0,127}$/u.test(args[0])) return false;
  const params = args[1];
  return (
    params === undefined ||
    (typeof params === 'object' && params !== null && !Array.isArray(params))
  );
}
