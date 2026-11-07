export interface CurrentBrowser {
  status:
    | 'unavailable'
    | 'detected'
    | 'connected'
    | 'blocked'
    | 'connecting'
    | 'failed';
  version?: string;
  browserId?: string;
}
export type ExtensionMessage = (
  id: string,
  message: unknown,
) => Promise<unknown>;
function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}
export function extensionMessaging(): ExtensionMessage {
  const chrome = object(object(globalThis).chrome);
  const runtime = object(chrome.runtime);
  const send = runtime.sendMessage;
  return (id, message) =>
    new Promise((resolve, reject) => {
      if (typeof send !== 'function') {
        reject(new Error('Unavailable'));
        return;
      }
      const timer = setTimeout(
        () => {
          reject(new Error('Unavailable'));
        },
        object(message).type === 'avru-probe' ? 12000 : 2000,
      );
      try {
        Reflect.apply(send, runtime, [
          id,
          message,
          (result: unknown) => {
            clearTimeout(timer);
            if (runtime.lastError) reject(new Error('Unavailable'));
            else resolve(result);
          },
        ]);
      } catch (error) {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('Unavailable'));
      }
    });
}
export async function detectCurrent(
  id: string,
  send: ExtensionMessage,
): Promise<CurrentBrowser> {
  try {
    const reply = object(await send(id, { type: 'avru-detect' }));
    if (typeof reply.version !== 'string' || reply.version.length > 64)
      throw new Error('Unavailable');
    if (reply.status === 'connected' && typeof reply.browserId === 'string')
      return {
        status: 'connected',
        version: reply.version,
        browserId: reply.browserId,
      };
    return {
      status: reply.autoAllowed === true ? 'detected' : 'blocked',
      version: reply.version,
    };
  } catch {
    return { status: 'unavailable' };
  }
}
export async function connectCurrent(
  id: string,
  send: ExtensionMessage,
  issue: (challenge: string) => Promise<unknown>,
): Promise<void> {
  const probe = object(await send(id, { type: 'avru-probe' }));
  if (
    typeof probe.challenge !== 'string' ||
    !/^[a-f0-9]{64}$/.test(probe.challenge)
  )
    throw new Error('Invalid challenge');
  const result = object(await issue(probe.challenge));
  if (
    typeof result.ticket !== 'string' ||
    !/^[a-f0-9]{64}$/.test(result.ticket)
  )
    throw new Error('Invalid ticket');
  const accepted = object(
    await send(id, {
      type: 'avru-redeem',
      challenge: probe.challenge,
      ticket: result.ticket,
    }),
  );
  if (accepted.accepted !== true) throw new Error('Connection unavailable');
}
