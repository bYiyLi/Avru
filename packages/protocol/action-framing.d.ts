/** Frame a logical message for the daemon/extension websocket protocol. */
export function frameMessage(
  requestId: string,
  message: Record<string, unknown>,
  maxFrameBytes: number,
): Record<string, unknown>[];
