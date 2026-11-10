import { randomUUID } from 'node:crypto';
import { frameMessage } from '../../../packages/protocol/action-framing.js';
import { parseMessage } from './messages.js';
import type {
  ActionError,
  ActionResultMessage,
  ChunkMessage,
} from './messages.js';

/**
 * Daemon side of the daemon ↔ extension action channel (phase 08 M1, T8).
 *
 * Wire format (WS v1 style, see docs/design/browser-sdk.md "daemon ↔ extension
 * 动作消息"): every message carries `v: 1` and `type`. `action.method` matches an
 * SDK method name one-to-one and `args` is a JSON array. Results correlate by
 * `requestId`. A logical message larger than the per-direction frame limit is
 * split into `chunk` frames and reassembled by the receiver; a lost chunk or a
 * timeout fails the whole action with `TIMEOUT` and never replays it.
 *
 * Frame limits (limits table, M0 decided):
 * - daemon → extension: one frame ≤ 8 KiB, because the extension rejects
 *   inbound frames longer than 8192 characters.
 * - extension → daemon: one frame ≤ 1 MiB (WS single-message limit).
 */

export type ActionOutcome =
  { ok: true; value?: unknown } | { ok: false; error: ActionError };

export interface SendActionInput {
  browserId: string;
  tabId: number;
  generation: number;
  method: string;
  args: unknown[];
  timeoutMs?: number;
}

/** Default per-method timeout (limits table: task-level default method timeout). */
export const ACTION_DEFAULT_TIMEOUT_MS = 30_000;
/** Hard ceiling for a single action timeout (limits table: task timeoutMs max). */
export const ACTION_MAX_TIMEOUT_MS = 300_000;
/** Largest single WS frame the extension accepts. */
export const DAEMON_TO_EXTENSION_MAX_FRAME_BYTES = 8192;
/** WS single-message limit; the extension chunks larger results at this size. */
export const EXTENSION_TO_DAEMON_MAX_FRAME_BYTES = 1_048_576;
/** Largest reassembled action/result JSON the daemon accepts (parse ceiling). */
export const MAX_REASSEMBLED_BYTES = 8_388_608;
/** Largest number of chunks one logical message may split into. */
export const MAX_CHUNKS_PER_MESSAGE = 4096;
export const MAX_ACTION_ARGS = 1024;

export { frameMessage };

export interface ChunkInput {
  requestId: string;
  index: number;
  total: number;
  payload: string;
}

export type AssembleResult =
  | { status: 'waiting' }
  | { status: 'complete'; json: string }
  | { status: 'invalid'; reason: string };

/**
 * Reassembles chunked inbound messages for one requestId. Chunks may arrive
 * out of order; a duplicate index, a changing total, or a reassembled size
 * above `maxBytes` invalidates the whole message (the caller fails the
 * action with `TIMEOUT`, per the design's chunk rule).
 */
export class ChunkAssembler {
  private readonly parts = new Map<number, string>();
  private total: number | undefined;
  private bytes = 0;
  constructor(private readonly maxBytes: number = MAX_REASSEMBLED_BYTES) {}
  get received(): number {
    return this.parts.size;
  }
  feed(chunk: ChunkInput): AssembleResult {
    if (
      !Number.isSafeInteger(chunk.index) ||
      !Number.isSafeInteger(chunk.total) ||
      chunk.index < 0 ||
      chunk.index >= chunk.total ||
      chunk.total < 1 ||
      chunk.total > MAX_CHUNKS_PER_MESSAGE
    )
      return { status: 'invalid', reason: 'Invalid chunk range' };
    if (this.total !== undefined && this.total !== chunk.total)
      return { status: 'invalid', reason: 'Chunk total changed' };
    if (this.parts.has(chunk.index))
      return { status: 'invalid', reason: 'Duplicate chunk' };
    this.bytes += Buffer.byteLength(chunk.payload, 'utf8');
    if (this.bytes > this.maxBytes)
      return { status: 'invalid', reason: 'Reassembled message too large' };
    this.total = chunk.total;
    this.parts.set(chunk.index, chunk.payload);
    if (this.parts.size < chunk.total) return { status: 'waiting' };
    const ordered: string[] = [];
    for (let index = 0; index < chunk.total; index++) {
      const part = this.parts.get(index);
      if (part === undefined)
        return { status: 'invalid', reason: 'Missing chunk' };
      ordered.push(part);
    }
    return { status: 'complete', json: ordered.join('') };
  }
}

/** Returns the validation failure for a sendAction input, if any. */
export function sendActionInputError(
  input: SendActionInput,
): string | undefined {
  if (
    typeof input.browserId !== 'string' ||
    input.browserId.length === 0 ||
    input.browserId.length > 64
  )
    return 'Invalid browserId';
  if (!Number.isSafeInteger(input.tabId) || input.tabId < 0)
    return 'Invalid tabId';
  if (!Number.isSafeInteger(input.generation) || input.generation < 0)
    return 'Invalid generation';
  if (
    typeof input.method !== 'string' ||
    input.method.length === 0 ||
    input.method.length > 128
  )
    return 'Invalid method';
  if (!Array.isArray(input.args) || input.args.length > MAX_ACTION_ARGS)
    return 'Invalid args';
  if (
    input.timeoutMs !== undefined &&
    (!Number.isSafeInteger(input.timeoutMs) ||
      input.timeoutMs < 1 ||
      input.timeoutMs > ACTION_MAX_TIMEOUT_MS)
  )
    return 'Invalid timeoutMs';
  return undefined;
}

interface PendingAction<Session> {
  browserId: string;
  session: Session;
  assembler: ChunkAssembler;
  timer: ReturnType<typeof setTimeout>;
  resolve: (outcome: ActionOutcome) => void;
}

/**
 * Owns the daemon side of the pending-action registry: framing, timeouts,
 * chunk reassembly and disconnect failures. Connections keeps session
 * lookup, generation checks and the socket send; this class never touches
 * them, so Connections stays under the repo's file-size limit.
 */
export class ActionChannel<Session> {
  private readonly pending = new Map<string, PendingAction<Session>>();
  constructor(
    private readonly send: (
      session: Session,
      value: Record<string, unknown>,
    ) => boolean,
  ) {}
  get size(): number {
    return this.pending.size;
  }
  sendAction(session: Session, input: SendActionInput): Promise<ActionOutcome> {
    const requestId = randomUUID();
    const frames = frameMessage(
      requestId,
      {
        type: 'action',
        requestId,
        tabId: input.tabId,
        generation: input.generation,
        method: input.method,
        args: input.args,
      },
      DAEMON_TO_EXTENSION_MAX_FRAME_BYTES,
    );
    return new Promise<ActionOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.settle(requestId, {
          ok: false,
          error: { code: 'TIMEOUT', message: 'Action timed out' },
        });
      }, input.timeoutMs ?? ACTION_DEFAULT_TIMEOUT_MS);
      timer.unref();
      this.pending.set(requestId, {
        browserId: input.browserId,
        session,
        assembler: new ChunkAssembler(),
        timer,
        resolve,
      });
      for (const frame of frames)
        if (!this.send(session, frame)) {
          this.settle(requestId, {
            ok: false,
            error: {
              code: 'EXTENSION_OFFLINE',
              message: 'Browser extension is offline',
            },
          });
          return;
        }
    });
  }
  failForSession(session: Session): void {
    for (const [requestId, pending] of this.pending)
      if (pending.session === session)
        this.settle(requestId, {
          ok: false,
          error: {
            code: 'EXTENSION_OFFLINE',
            message: 'Browser extension disconnected',
          },
        });
  }
  receiveResult(browserId: string, message: ActionResultMessage): void {
    const pending = this.pending.get(message.requestId);
    if (!pending) {
      console.warn(
        `Ignoring action_result for unknown request ${message.requestId}`,
      );
      return;
    }
    if (pending.browserId !== browserId) {
      console.warn(
        `Ignoring action_result for request ${message.requestId} from another browser`,
      );
      return;
    }
    if (pending.assembler.received > 0) {
      console.warn(
        `Ignoring action_result for request ${message.requestId} after partial chunks`,
      );
      return;
    }
    this.settleWithResult(message.requestId, message);
  }
  receiveChunk(browserId: string, message: ChunkMessage): void {
    const pending = this.pending.get(message.requestId);
    if (!pending) {
      console.warn(`Ignoring chunk for unknown request ${message.requestId}`);
      return;
    }
    if (pending.browserId !== browserId) {
      console.warn(
        `Ignoring chunk for request ${message.requestId} from another browser`,
      );
      return;
    }
    const assembled = pending.assembler.feed(message);
    if (assembled.status === 'waiting') return;
    if (assembled.status === 'invalid') {
      this.failIncompleteChunks(message.requestId, assembled.reason);
      return;
    }
    let result: ReturnType<typeof parseMessage>;
    try {
      result = parseMessage(assembled.json);
    } catch {
      this.failIncompleteChunks(message.requestId, 'unparsable result');
      return;
    }
    if (result.type !== 'action_result') {
      this.failIncompleteChunks(message.requestId, 'unexpected message type');
      return;
    }
    if (result.requestId !== message.requestId) {
      this.failIncompleteChunks(message.requestId, 'requestId mismatch');
      return;
    }
    this.settleWithResult(message.requestId, result);
  }
  private settle(requestId: string, outcome: ActionOutcome): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve(outcome);
  }
  private settleWithResult(
    requestId: string,
    message: ActionResultMessage,
  ): void {
    this.settle(
      requestId,
      message.ok
        ? {
            ok: true,
            ...(message.value !== undefined ? { value: message.value } : {}),
          }
        : { ok: false, error: message.error },
    );
  }
  private failIncompleteChunks(requestId: string, reason: string): void {
    console.warn(`Dropping chunks for request ${requestId}: ${reason}`);
    this.settle(requestId, {
      ok: false,
      error: { code: 'TIMEOUT', message: 'Action result chunks incomplete' },
    });
  }
}
