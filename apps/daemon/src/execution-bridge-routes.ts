import { SDK_CAPABILITIES } from '../../../packages/runner/dist/sdk.js';
import { sdkDocs } from './oauth/sdk-docs.js';
import type { ClaimRegistry } from './claims.js';
import type { Connections } from './connections.js';
import type {
  BrowserTab,
  Entry,
  ExecutionObservation,
} from './execution-types.js';
import {
  codedError,
  normalizeTabId,
  unknownAfterDispatch,
} from './execution-types.js';

export const TAB_ACTION_METHODS = new Set([
  'tab.title',
  'tab.snapshot',
  'cdp.send',
  'cdp.events',
  'cdp.cursor',
  'cdp.readEvents',
  'tab.observe.write',
  'management.invoke',
  'browser.visibility.get',
  'browser.visibility.set',
  'tab.favicon.status',
  'tab.visual.cursor',
  'tab.dev.logs',
  'tab.getJsDialog',
  'tab.dialogAccept',
  'tab.dialogDismiss',
  'tab.downloads',
  'tab.saveDownload',
  'tab.setFiles',
  'tab.waitForDownload',
  'tab.downloadMedia',
  'tab.clipboard.read',
  'tab.clipboard.readText',
  'tab.clipboard.write',
  'tab.clipboard.writeText',
  'tab.content.export',
  'tab.content.exportGsuite',
  'tab.content.exportYouTubeTranscript',
  'tab.exportFile',
  'tab.assets.list',
  'tab.assets.bundle',
  'tab.webmcp.fetchTools',
  'tab.webmcp.invokeTool',
  'tab.markDeliverable',
  'tab.markHandoff',
  'tab.requestUserTakeover',
  'tabs.close',
  'browser.nameSession',
]);

export const READ_ONLY_TAB_ACTIONS = new Set([
  'tab.title',
  'tab.snapshot',
  'cdp.events',
  'cdp.cursor',
  'cdp.readEvents',
  'tab.observe.write',
  'tab.dev.logs',
  'tab.getJsDialog',
  'tab.clipboard.read',
  'tab.clipboard.readText',
  'tab.assets.list',
  'tab.webmcp.fetchTools',
  'tab.downloads',
  'tab.saveDownload',
  'tab.waitForDownload',
]);

export function parseIdentity(value: unknown): {
  browserId: string;
  tabId: number;
  generation: number;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw codedError('INVALID_ARGUMENT', 'invalid browser tab identity');
  const identity = value as Record<string, unknown>;
  const tabId = normalizeTabId(identity.tabId);
  if (
    typeof identity.browserId !== 'string' ||
    !identity.browserId ||
    tabId === undefined ||
    !Number.isSafeInteger(identity.generation) ||
    (identity.generation as number) < 1
  )
    throw codedError('INVALID_ARGUMENT', 'invalid browser tab identity');
  return {
    browserId: identity.browserId,
    tabId,
    generation: identity.generation as number,
  };
}

/** Bridge arguments must arrive as a JSON array (the runner's sdk.ts sends one). */
export function parseBridgeArgs(json: string): unknown[] {
  let args: unknown;
  try {
    args = JSON.parse(json);
  } catch {
    throw codedError(
      'INVALID_ARGUMENT',
      'bridge arguments must be a JSON array',
    );
  }
  if (!Array.isArray(args))
    throw codedError(
      'INVALID_ARGUMENT',
      'bridge arguments must be a JSON array',
    );
  return args;
}

export function noArgs(args: unknown[], method: string): void {
  if (args.length !== 0)
    throw codedError('INVALID_ARGUMENT', `${method} takes no arguments`);
}

export function oneStringArg(
  args: unknown[],
  method: string,
  label: string,
): string {
  if (args.length !== 1 || typeof args[0] !== 'string' || !args[0])
    throw codedError('INVALID_ARGUMENT', `${method} requires ${label}`);
  return args[0];
}

export function actionAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

export function validateMoveOptions(args: unknown[]): void {
  if (
    args.length !== 2 ||
    !args[1] ||
    typeof args[1] !== 'object' ||
    Array.isArray(args[1])
  )
    throw codedError('INVALID_ARGUMENT', 'invalid tabs.move options');
  const options = args[1] as { index?: unknown; windowId?: unknown };
  if (
    !Number.isSafeInteger(options.index) ||
    (options.index as number) < -1 ||
    (options.windowId !== undefined &&
      (!Number.isSafeInteger(options.windowId) ||
        (options.windowId as number) < 0))
  )
    throw codedError('INVALID_ARGUMENT', 'invalid tabs.move destination');
}

export function validateTabAction(
  method: string,
  args: unknown[],
  context: {
    browserId: string;
    executionId: string;
    claims: ClaimRegistry;
  },
): void {
  if (method === 'tabs.content' || method === 'history.search') {
    if (
      args.length !== 1 ||
      !args[0] ||
      typeof args[0] !== 'object' ||
      Array.isArray(args[0])
    )
      throw codedError('INVALID_ARGUMENT', `invalid ${method} options`);
    return;
  }
  if (method === 'tabs.selected' || method === 'windows.list') {
    noArgs(args, method);
    return;
  }
  if (method === 'tabs.new') {
    if (
      args.length !== 2 ||
      (args[0] !== null && typeof args[0] !== 'string') ||
      !args[1] ||
      typeof args[1] !== 'object' ||
      Array.isArray(args[1])
    )
      throw codedError('INVALID_ARGUMENT', 'invalid new tab arguments');
    return;
  }
  if (method === 'tabs.move') {
    validateMoveOptions(args);
  }
  if (
    (method !== 'tabs.move' && args.length !== 1) ||
    typeof args[0] !== 'string' ||
    !/^(0|[1-9][0-9]*)$/u.test(args[0]) ||
    !Number.isSafeInteger(Number(args[0]))
  )
    throw codedError('INVALID_ARGUMENT', 'invalid tab ID');
  const claim = context.claims.get(context.browserId, Number(args[0]));
  if (claim && claim.executionId !== context.executionId)
    throw codedError('TAB_ALREADY_CLAIMED', 'tab is in use');
}

/** Extension-side failure mapped to a design code (tab.title only). */
export const TITLE_FAILURES: Record<string, string> = {
  PAGE_NOT_ACCESSIBLE: 'target page is not accessible',
  CANCELLED: 'task cancelled',
  TIMEOUT: 'tab.title timed out',
  EXTENSION_OFFLINE: 'browser extension is offline',
  QUEUE_FULL: 'too many in-flight actions',
  CAPABILITY_NOT_ALLOWED: 'tab.title is not allowed',
};

export function recordObservation(entry: Entry, args: unknown[]): null {
  if (
    args.length !== 1 ||
    !args[0] ||
    typeof args[0] !== 'object' ||
    Array.isArray(args[0])
  )
    throw codedError('INVALID_ARGUMENT', 'invalid model observation');
  if (entry.observations.length >= 4)
    throw codedError('OUTPUT_TOO_LARGE', 'too many model observations');
  const value = args[0] as Record<string, unknown>;
  if (!['state', 'screenshot', 'both'].includes(String(value.mode)))
    throw codedError('INVALID_ARGUMENT', 'invalid observation mode');
  const mode = value.mode as ExecutionObservation['mode'];
  const state = value.state;
  const screenshot = value.screenshot;
  if (
    state !== undefined &&
    (typeof state !== 'string' || state.length > 12_000)
  )
    throw codedError('OUTPUT_TOO_LARGE', 'observation state exceeds the limit');
  if (
    screenshot !== undefined &&
    (!screenshot ||
      typeof screenshot !== 'object' ||
      typeof (screenshot as Record<string, unknown>).data !== 'string' ||
      ((screenshot as Record<string, unknown>).data as string).length >
        48 * 1024 ||
      (screenshot as Record<string, unknown>).mimeType !== 'image/jpeg')
  )
    throw codedError(
      'OUTPUT_TOO_LARGE',
      'observation screenshot exceeds the limit',
    );
  if (
    (mode !== 'screenshot' && typeof state !== 'string') ||
    (mode !== 'state' && screenshot === undefined)
  )
    throw codedError(
      'INVALID_ARGUMENT',
      'observation is missing required content',
    );
  const observation: ExecutionObservation = {
    mode,
    ...(state !== undefined ? { state } : {}),
    ...(screenshot !== undefined
      ? {
          screenshot: screenshot as NonNullable<
            ExecutionObservation['screenshot']
          >,
        }
      : {}),
  };
  entry.observations.push(observation);
  return null;
}

export interface TabActionRequest {
  target: { browserId: string; tabId: number; generation: number };
  method: string;
  args: unknown[];
  signal: AbortSignal;
  acquireLock: boolean;
}

interface TabActionDependencies {
  connections: Pick<Connections, 'sendAction'>;
  claims: ClaimRegistry;
  liveTab(
    browserId: string,
    tabId: number,
  ): { title: string; url: string; generation: number } | undefined;
}

function ensureActionClaim(
  claims: ClaimRegistry,
  entry: Entry,
  target: TabActionRequest['target'],
  live: { title: string; url: string; generation: number },
): void {
  const existing = claims.get(target.browserId, target.tabId);
  if (existing) {
    if (
      existing.owner !== entry.owner ||
      (existing.executionId !== undefined && existing.executionId !== entry.id)
    )
      throw codedError('TAB_ALREADY_CLAIMED', 'tab is in use');
    if (existing.generation !== target.generation)
      throw codedError('INVALID_TARGET', 'stale browser connection');
    if (existing.executionId === undefined)
      claims.bind(entry.id, entry.owner, target.browserId, target.tabId);
    return;
  }
  claims.claim(entry.owner, {
    browserId: target.browserId,
    tabId: target.tabId,
    generation: target.generation,
    title: live.title,
    url: live.url,
  });
  claims.bind(entry.id, entry.owner, target.browserId, target.tabId);
}

/** Exact-generation routing and task locking; CDP commands remain unrestricted. */
export async function performTabAction(
  deps: TabActionDependencies,
  request: TabActionRequest & { entry: Entry },
): Promise<unknown> {
  const { entry, target, method, args, signal, acquireLock } = request;
  if (actionAborted(signal)) throw codedError('CANCELLED', 'task cancelled');
  const live = deps.liveTab(target.browserId, target.tabId);
  if (!live || live.generation !== target.generation)
    throw codedError('INVALID_TARGET', 'browser tab is unavailable or stale');
  if (acquireLock) ensureActionClaim(deps.claims, entry, target, live);
  const outcome = await deps.connections.sendAction({
    browserId: target.browserId,
    tabId: target.tabId,
    generation: target.generation,
    method,
    args,
  });
  if (actionAborted(signal)) {
    const uncertain = !READ_ONLY_TAB_ACTIONS.has(method);
    throw codedError(
      uncertain ? 'UNKNOWN_RESULT' : 'CANCELLED',
      uncertain ? 'action may have completed' : 'task cancelled',
    );
  }
  if (!outcome.ok) {
    const uncertain =
      !READ_ONLY_TAB_ACTIONS.has(method) &&
      unknownAfterDispatch(outcome.error.code);
    throw codedError(
      uncertain ? 'UNKNOWN_RESULT' : outcome.error.code,
      uncertain
        ? 'action may have completed; inspect before retrying'
        : outcome.error.message,
    );
  }
  return outcome.value;
}

export function deriveStepContext(
  entry: Entry,
  method: string,
  json: string,
): {
  stepAction: string;
  stepTarget: { browserId: string; tabId: number } | undefined;
} {
  let stepAction = method;
  let stepTarget = entry.target
    ? { browserId: entry.target.browserId, tabId: entry.target.tabId }
    : undefined;
  try {
    const args = parseBridgeArgs(json);
    if (method === 'tab.action') {
      const target = parseIdentity({
        browserId: args[0],
        tabId: args[1],
        generation: args[2],
      });
      stepTarget = { browserId: target.browserId, tabId: target.tabId };
      if (typeof args[3] === 'string') stepAction = args[3];
    } else if (method === 'browser.user.getTabContext') {
      const target = parseIdentity(args[0]);
      stepTarget = { browserId: target.browserId, tabId: target.tabId };
    }
  } catch {
    // The dispatcher validates; malformed calls still have an audit step.
  }
  return { stepAction, stepTarget };
}

/** Read-only SDK discovery and documentation: no browser side effects. */
export function dispatchMetadata(method: string, args: unknown[]): unknown {
  switch (method) {
    case 'documentation.get': {
      const topic = oneStringArg(args, method, 'a documentation topic');
      try {
        return sdkDocs([topic])[0]?.content ?? '';
      } catch {
        throw codedError(
          'TOPIC_NOT_FOUND',
          'SDK documentation topic not found',
        );
      }
    }
    case 'capabilities.list':
      noArgs(args, method);
      return SDK_CAPABILITIES.map((capability) => ({ ...capability }));
    case 'capabilities.get': {
      const name = oneStringArg(args, method, 'a capability name');
      const found = SDK_CAPABILITIES.find(
        (capability) => capability.name === name,
      );
      if (!found)
        throw codedError(
          'CAPABILITY_NOT_ALLOWED',
          `unknown capability: ${name}`,
        );
      return { ...found };
    }
    default:
      throw codedError('CAPABILITY_NOT_ALLOWED', 'unknown SDK metadata method');
  }
}

export const DIRECT_TAB_ACTIONS = new Set([
  'management.invoke',
  'browser.visibility.get',
  'browser.visibility.set',
  'tab.favicon.status',
  'tab.visual.cursor',
  'tab.markDeliverable',
  'tab.markHandoff',
  'tab.requestUserTakeover',
  'cdp.readEvents',
]);

export function openUserTabs(tabs: BrowserTab[]): unknown[] {
  return tabs.map((tab) => {
    const providerTabId = [
      tab.browserId,
      tab.tabId,
      String(tab.generation),
    ].join(':');
    return {
      id: providerTabId,
      providerTabId,
      ...(tab.title ? { title: tab.title } : {}),
      ...(tab.url ? { url: tab.url } : {}),
    };
  });
}
