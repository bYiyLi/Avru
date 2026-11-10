import {
  EXTENSION_TO_DAEMON_MAX_FRAME_BYTES,
  frameMessage,
  MAX_ACTION_CHUNKS,
  MAX_REASSEMBLED_ACTION_BYTES,
  record,
  snapshot,
} from './protocol';
import type { Tab } from './protocol';

export type ActionResult =
  | { ok: true; value?: unknown }
  | { ok: false; error: { code: string; message: string } };

export interface ActionPorts {
  tabs: () => Promise<Tab[]>;
  action?: (
    tabId: number,
    method: string,
    args?: unknown[],
  ) => Promise<unknown> | undefined;
  send: (data: unknown) => void;
  isReady: () => boolean;
  isCurrentGeneration: (generation: number) => boolean;
}

/**
 * Owns the extension side of the daemon action channel: validating and
 * dispatching `action` messages, reassembling chunked actions and framing
 * large results. Connection keeps the socket, pairing and OAuth; this class
 * never touches them, so Connection stays under the repo's file-size limit.
 */
export class ActionChannel {
  private readonly incomingActions = new Map<
    string,
    {
      total: number;
      parts: (string | undefined)[];
      received: number;
      bytes: number;
    }
  >();
  constructor(private readonly ports: ActionPorts) {}
  clear(): void {
    this.incomingActions.clear();
  }
  async receiveMessage(
    message: Record<string, unknown>,
    generation: number,
  ): Promise<boolean> {
    if (message.type === 'chunk') {
      await this.receiveChunk(message, generation);
      return true;
    }
    if (message.type === 'action') {
      await this.receiveAction(message, generation);
      return true;
    }
    return false;
  }
  /**
   * Validate and dispatch one daemon action. The action port supports
   * browser tab lifecycle, page reads, and unrestricted CDP transport.
   * Unknown SDK method names (not CDP commands) are rejected.
   * Malformed actions are logged and refused with INVALID_ARGUMENT instead
   * of failing the connection; an action without a usable requestId is
   * dropped (it cannot be correlated with a reply).
   */
  private async receiveAction(
    message: Record<string, unknown>,
    generation: number,
  ): Promise<void> {
    const requestId = message.requestId;
    if (
      typeof requestId !== 'string' ||
      requestId.length === 0 ||
      requestId.length > 64
    ) {
      console.warn('Ignoring action without requestId');
      return;
    }
    if (
      typeof message.tabId !== 'number' ||
      !Number.isSafeInteger(message.tabId) ||
      message.tabId < 0 ||
      typeof message.generation !== 'number' ||
      !Number.isSafeInteger(message.generation) ||
      message.generation < 0 ||
      typeof message.method !== 'string' ||
      message.method.length === 0 ||
      message.method.length > 128 ||
      !Array.isArray(message.args)
    ) {
      console.warn(`Ignoring malformed action ${requestId}`);
      this.sendActionResult(requestId, {
        ok: false,
        error: { code: 'INVALID_ARGUMENT', message: 'Invalid action' },
      });
      return;
    }
    if (!this.ports.isReady()) {
      console.warn(`Ignoring action ${requestId} before ready`);
      return;
    }
    if (message.method === 'browser.tabs.list' && message.args.length !== 0) {
      this.sendActionResult(requestId, {
        ok: false,
        error: { code: 'INVALID_ARGUMENT', message: 'tabs.list takes no args' },
      });
      return;
    }
    await this.executeAction(
      requestId,
      { tabId: message.tabId, method: message.method, args: message.args },
      generation,
    );
  }
  private async executeAction(
    requestId: string,
    action: { tabId: number; method: string; args: unknown[] },
    generation: number,
  ): Promise<void> {
    const { tabId, method, args } = action;
    if (method === 'browser.tabs.list') {
      const tabs = snapshot(await this.ports.tabs());
      if (!this.ports.isCurrentGeneration(generation)) return;
      this.sendActionResult(requestId, { ok: true, value: tabs });
      return;
    }
    if (
      method !== 'tab.title' &&
      method !== 'tab.url' &&
      method !== 'tab.snapshot' &&
      method !== 'tab.downloads' &&
      method !== 'tab.waitForDownload' &&
      method !== 'tab.downloadMedia' &&
      method !== 'tab.saveDownload' &&
      method !== 'tab.setFiles' &&
      method !== 'tab.clipboard.read' &&
      method !== 'tab.clipboard.readText' &&
      method !== 'tab.clipboard.write' &&
      method !== 'tab.clipboard.writeText' &&
      method !== 'tab.content.export' &&
      method !== 'tab.content.exportGsuite' &&
      method !== 'tab.content.exportYouTubeTranscript' &&
      method !== 'tab.exportFile' &&
      method !== 'tab.assets.list' &&
      method !== 'tab.assets.bundle' &&
      method !== 'tab.webmcp.fetchTools' &&
      method !== 'tab.webmcp.invokeTool' &&
      method !== 'tab.markDeliverable' &&
      method !== 'tab.markHandoff' &&
      method !== 'tab.requestUserTakeover' &&
      method !== 'tab.dev.logs' &&
      method !== 'tab.getJsDialog' &&
      method !== 'tab.dialogAccept' &&
      method !== 'tab.dialogDismiss' &&
      method !== 'browser.nameSession' &&
      method !== 'management.invoke' &&
      method !== 'browser.visibility.get' &&
      method !== 'browser.visibility.set' &&
      method !== 'tab.favicon.status' &&
      method !== 'tab.visual.cursor' &&
      method !== 'tab.execution.start' &&
      method !== 'tab.execution.finish' &&
      method !== 'cdp.send' &&
      method !== 'cdp.events' &&
      method !== 'cdp.cursor' &&
      method !== 'cdp.readEvents' &&
      method !== 'tabs.new' &&
      method !== 'tabs.content' &&
      method !== 'tabs.move' &&
      method !== 'windows.list' &&
      method !== 'history.search' &&
      method !== 'tabs.close' &&
      method !== 'tabs.select' &&
      method !== 'tabs.selected'
    ) {
      this.sendActionResult(requestId, {
        ok: false,
        error: {
          code: 'CAPABILITY_NOT_ALLOWED',
          message: `Method ${method} is not supported in M1`,
        },
      });
      return;
    }
    try {
      if (!this.ports.action) throw new Error('CAPABILITY_NOT_ALLOWED');
      const value = await this.ports.action(tabId, method, args);
      if (!this.ports.isCurrentGeneration(generation)) return;
      this.sendActionResult(requestId, { ok: true, value });
    } catch (error) {
      const code =
        error instanceof Error && /^[A-Z_]{3,64}$/u.test(error.message)
          ? error.message
          : 'ACTION_FAILED';
      console.warn(`Action ${requestId} failed: ${code}`);
      if (!this.ports.isCurrentGeneration(generation)) return;
      this.sendActionResult(requestId, {
        ok: false,
        error: { code, message: 'Action failed' },
      });
    }
  }
  private sendActionResult(requestId: string, result: ActionResult): void {
    const message: Record<string, unknown> = result.ok
      ? {
          type: 'action_result',
          requestId,
          ok: true,
          ...(result.value !== undefined ? { value: result.value } : {}),
        }
      : {
          type: 'action_result',
          requestId,
          ok: false,
          error: result.error,
        };
    for (const frame of frameMessage(
      requestId,
      message,
      EXTENSION_TO_DAEMON_MAX_FRAME_BYTES,
    ))
      this.ports.send(frame);
  }
  private async receiveChunk(
    message: Record<string, unknown>,
    generation: number,
  ): Promise<void> {
    const requestId = message.requestId;
    const index = message.index;
    const total = message.total;
    const payload = message.payload;
    if (
      typeof requestId !== 'string' ||
      requestId.length === 0 ||
      requestId.length > 64 ||
      typeof index !== 'number' ||
      !Number.isSafeInteger(index) ||
      typeof total !== 'number' ||
      !Number.isSafeInteger(total) ||
      index < 0 ||
      total < 1 ||
      index >= total ||
      total > MAX_ACTION_CHUNKS ||
      typeof payload !== 'string'
    ) {
      console.warn('Ignoring malformed action chunk');
      return;
    }
    let assembly = this.incomingActions.get(requestId);
    if (!assembly) {
      assembly = {
        total,
        parts: Array.from({ length: total }, () => undefined),
        received: 0,
        bytes: 0,
      };
      this.incomingActions.set(requestId, assembly);
    }
    if (assembly.total !== total || assembly.parts[index] !== undefined) {
      console.warn('Ignoring inconsistent action chunk');
      this.incomingActions.delete(requestId);
      return;
    }
    assembly.bytes += new TextEncoder().encode(payload).length;
    if (assembly.bytes > MAX_REASSEMBLED_ACTION_BYTES) {
      console.warn('Ignoring oversized action chunks');
      this.incomingActions.delete(requestId);
      return;
    }
    assembly.parts[index] = payload;
    assembly.received++;
    if (assembly.received < total) return;
    this.incomingActions.delete(requestId);
    let parsed: unknown;
    try {
      parsed = JSON.parse(assembly.parts.join(''));
    } catch {
      console.warn('Ignoring unparsable action chunks');
      return;
    }
    const reassembled = record(parsed);
    if (!reassembled || reassembled.v !== 1) {
      console.warn('Ignoring reassembled action with invalid version');
      return;
    }
    if (reassembled.type === 'action') {
      await this.receiveAction(reassembled, generation);
      return;
    }
    if (reassembled.type === 'chunk') {
      await this.receiveChunk(reassembled, generation);
      return;
    }
    console.warn('Ignoring reassembled message of unexpected type');
  }
}
