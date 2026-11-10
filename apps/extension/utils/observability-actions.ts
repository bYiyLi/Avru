import type { CdpController } from './cdp';

type CdpPort = Pick<CdpController, 'send' | 'events'>;
const levels = ['debug', 'info', 'log', 'warn', 'warning', 'error'];

function invalid(): never {
  throw new Error('INVALID_ARGUMENT');
}
function readOptionalOptions(args: unknown[]): Record<string, unknown> {
  if (args.length > 1) return invalid();
  const value = args[0];
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}
function normalizeLevel(value: unknown): string {
  if (value === 'warning') return 'warn';
  if (value === 'assert') return 'error';
  return typeof value === 'string' && levels.includes(value) ? value : 'log';
}
function display(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[object]';
    }
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  )
    return String(value);
  return '[unknown]';
}
function timestamp(value: unknown): string {
  const time =
    typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? value > 1e11
        ? value
        : value * 1000
      : Date.now();
  return new Date(time).toISOString();
}
function consoleEntry(event: {
  method: string;
  params?: Record<string, unknown>;
}) {
  const params = event.params ?? {};
  if (event.method === 'Runtime.consoleAPICalled') {
    const args = Array.isArray(params.args) ? params.args : [];
    const stack = params.stackTrace as
      { callFrames?: { url?: string }[] } | undefined;
    const url = stack?.callFrames?.[0]?.url;
    return {
      level: normalizeLevel(params.type),
      message: args
        .map((item) => {
          if (!item || typeof item !== 'object') return display(item);
          const value = item as Record<string, unknown>;
          return display(value.value ?? value.description ?? value.type);
        })
        .join(' ')
        .slice(0, 1024),
      timestamp: timestamp(params.timestamp),
      ...(typeof url === 'string' ? { url: url.slice(0, 512) } : {}),
    };
  }
  if (
    event.method === 'Log.entryAdded' &&
    params.entry &&
    typeof params.entry === 'object'
  ) {
    const entry = params.entry as Record<string, unknown>;
    return {
      level: normalizeLevel(entry.level),
      message: display(entry.text).slice(0, 1024),
      timestamp: timestamp(entry.timestamp),
      ...(typeof entry.url === 'string'
        ? { url: entry.url.slice(0, 512) }
        : {}),
    };
  }
  return null;
}

async function readCdpEvents(
  cdp: CdpPort,
  tabId: number,
  args: unknown[],
): Promise<unknown> {
  const options = readOptionalOptions(args) as {
    cursor?: unknown;
    limit?: unknown;
  };
  const limit = options.limit ?? 200;
  if (
    (options.cursor !== undefined &&
      (typeof options.cursor !== 'string' ||
        !/^(0|[1-9]\d*)$/u.test(options.cursor))) ||
    !Number.isSafeInteger(limit) ||
    (limit as number) < 1 ||
    (limit as number) > 200
  )
    return invalid();
  const result = await cdp.events(
    tabId,
    typeof options.cursor === 'string' ? options.cursor : undefined,
  );
  const events = result.events.slice(0, limit as number);
  return {
    events,
    nextCursor:
      events.length > 0
        ? String(events[events.length - 1]?.sequence ?? result.nextCursor)
        : (options.cursor ?? result.nextCursor),
    hasMore: events.length < result.events.length,
  };
}
async function readDevLogs(
  cdp: CdpPort,
  tabId: number,
  args: unknown[],
): Promise<unknown> {
  const options = readOptionalOptions(args) as {
    limit?: unknown;
    filter?: unknown;
    levels?: unknown;
    since?: unknown;
  };
  const limit = options.limit ?? 20;
  if (
    !Number.isSafeInteger(limit) ||
    (limit as number) < 1 ||
    (limit as number) > 25 ||
    (options.filter !== undefined && typeof options.filter !== 'string') ||
    (options.levels !== undefined &&
      (!Array.isArray(options.levels) ||
        options.levels.some((level) => !levels.includes(String(level))))) ||
    (options.since !== undefined &&
      (typeof options.since !== 'number' ||
        !Number.isFinite(options.since) ||
        options.since < 0))
  )
    return invalid();
  await cdp.send(tabId, 'Runtime.enable', {});
  await cdp.send(tabId, 'Log.enable', {});
  const response = await cdp.events(tabId);
  const accepted = Array.isArray(options.levels)
    ? options.levels.map(normalizeLevel)
    : undefined;
  return response.events
    .map(consoleEntry)
    .filter((entry) => {
      if (!entry) return false;
      if (accepted && !accepted.includes(entry.level)) return false;
      if (
        typeof options.filter === 'string' &&
        !entry.message.includes(options.filter)
      )
        return false;
      if (
        typeof options.since === 'number' &&
        Date.parse(entry.timestamp) < options.since
      )
        return false;
      return true;
    })
    .slice(-(limit as number));
}
async function readDialog(
  cdp: CdpPort,
  tabId: number,
  args: unknown[],
): Promise<unknown> {
  if (args.length !== 0) return invalid();
  const response = await cdp.events(tabId);
  let active: { type: string; message: string } | null = null;
  for (const event of response.events) {
    if (event.method === 'Page.javascriptDialogClosed') active = null;
    if (event.method !== 'Page.javascriptDialogOpening') continue;
    const params = event.params ?? {};
    if (
      ['alert', 'confirm', 'prompt', 'beforeunload'].includes(
        String(params.type),
      )
    )
      active = {
        type: String(params.type),
        message: typeof params.message === 'string' ? params.message : '',
      };
  }
  return active;
}
async function acceptDialog(
  cdp: CdpPort,
  tabId: number,
  args: unknown[],
): Promise<unknown> {
  if (args.length > 1 || (args[0] !== undefined && typeof args[0] !== 'string'))
    return invalid();
  await cdp.send(tabId, 'Page.handleJavaScriptDialog', {
    accept: true,
    ...(args[0] === undefined ? {} : { promptText: args[0] }),
  });
  return { ok: true, tabId: String(tabId), changed: true };
}
async function dismissDialog(
  cdp: CdpPort,
  tabId: number,
  args: unknown[],
): Promise<unknown> {
  if (args.length !== 0) return invalid();
  await cdp.send(tabId, 'Page.handleJavaScriptDialog', { accept: false });
  return { ok: true, tabId: String(tabId), changed: true };
}
export async function dispatchObservabilityAction(
  cdp: CdpPort,
  tabId: number,
  method: string,
  args: unknown[],
): Promise<unknown> {
  switch (method) {
    case 'cdp.readEvents':
      return readCdpEvents(cdp, tabId, args);
    case 'tab.dev.logs':
      return readDevLogs(cdp, tabId, args);
    case 'tab.getJsDialog':
      return readDialog(cdp, tabId, args);
    case 'tab.dialogAccept':
      return acceptDialog(cdp, tabId, args);
    case 'tab.dialogDismiss':
      return dismissDialog(cdp, tabId, args);
    default:
      throw new Error('CAPABILITY_NOT_ALLOWED');
  }
}
