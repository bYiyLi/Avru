import type { BrowserActionAPI } from './browser-ports';

const VISIBILITY_KEY = 'avru.visibility.previousStates';
const SESSION_KEY = 'avru.sessions';

function invalid(): never {
  throw new Error('INVALID_ARGUMENT');
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function numericId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    return invalid();
  return value;
}
function stringId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 128)
    return invalid();
  return value;
}
function argsArray(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 8) return invalid();
  return value;
}

function requireCount(args: unknown[], expected: number): void {
  if (args.length !== expected) invalid();
}
function requireObject(value: unknown): Record<string, unknown> {
  if (!object(value)) return invalid();
  return value;
}
function requireTabIds(value: unknown): number[] {
  const ids = Array.isArray(value) ? value : [value];
  if (ids.length < 1 || ids.length > 100) return invalid();
  return ids.map(numericId);
}
async function dispatchWindows(
  api: BrowserActionAPI,
  method: string,
  args: unknown[],
): Promise<unknown> {
  const windows = api.windows;
  if (!windows) throw new Error('CAPABILITY_NOT_ALLOWED');
  switch (method) {
    case 'getAll':
      if (args.length > 1 || (args[0] !== undefined && !object(args[0])))
        return invalid();
      return (await windows.getAll({ populate: false })).filter(
        (window) => !window.incognito,
      );
    case 'create':
      requireCount(args, 1);
      if (!windows.create) throw new Error('CAPABILITY_NOT_ALLOWED');
      return windows.create(requireObject(args[0]));
    case 'update':
      requireCount(args, 2);
      if (!windows.update) throw new Error('CAPABILITY_NOT_ALLOWED');
      return windows.update(numericId(args[0]), requireObject(args[1]));
    default:
      throw new Error('CAPABILITY_NOT_ALLOWED');
  }
}

async function groupTabs(
  api: BrowserActionAPI,
  args: unknown[],
): Promise<unknown> {
  requireCount(args, 1);
  if (!api.tabs.group) throw new Error('CAPABILITY_NOT_ALLOWED');
  const options = requireObject(args[0]);
  const tabIds = requireTabIds(options.tabIds);
  const groupId = options.groupId;
  if (groupId !== undefined) numericId(groupId);
  return api.tabs.group({
    tabIds: tabIds as [number, ...number[]],
    ...(typeof groupId === 'number' ? { groupId } : {}),
  });
}
async function moveTab(
  api: BrowserActionAPI,
  args: unknown[],
): Promise<unknown> {
  requireCount(args, 2);
  if (!api.tabs.move) throw new Error('CAPABILITY_NOT_ALLOWED');
  const opts = requireObject(args[1]);
  const index = opts.index;
  if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < -1)
    invalid();
  if (opts.windowId !== undefined) numericId(opts.windowId);
  return api.tabs.move(numericId(args[0]), {
    index,
    ...(typeof opts.windowId === 'number' ? { windowId: opts.windowId } : {}),
  });
}
async function dispatchTabs(
  api: BrowserActionAPI,
  method: string,
  args: unknown[],
): Promise<unknown> {
  const tabs = api.tabs;
  switch (method) {
    case 'query': {
      requireCount(args, 1);
      if (!tabs.query) throw new Error('CAPABILITY_NOT_ALLOWED');
      return tabs.query(
        requireObject(args[0]) as { active: boolean; windowId?: number },
      );
    }
    case 'get':
      requireCount(args, 1);
      return tabs.get(numericId(args[0]));
    case 'update':
      requireCount(args, 2);
      if (!tabs.update) throw new Error('CAPABILITY_NOT_ALLOWED');
      return tabs.update(
        numericId(args[0]),
        requireObject(args[1]) as { active: boolean },
      );
    case 'group':
      return groupTabs(api, args);
    case 'ungroup':
      requireCount(args, 1);
      if (!tabs.ungroup) throw new Error('CAPABILITY_NOT_ALLOWED');
      return tabs.ungroup(requireTabIds(args[0]));
    case 'move':
      return moveTab(api, args);
    case 'remove':
      requireCount(args, 1);
      if (!tabs.remove) throw new Error('CAPABILITY_NOT_ALLOWED');
      for (const id of requireTabIds(args[0])) await tabs.remove(id);
      return undefined;
    default:
      throw new Error('CAPABILITY_NOT_ALLOWED');
  }
}
async function dispatchTabGroups(
  api: BrowserActionAPI,
  method: string,
  args: unknown[],
): Promise<unknown> {
  const groups = api.tabGroups;
  if (!groups) throw new Error('CAPABILITY_NOT_ALLOWED');
  switch (method) {
    case 'get':
      requireCount(args, 1);
      if (!groups.get) throw new Error('CAPABILITY_NOT_ALLOWED');
      return groups.get(numericId(args[0]));
    case 'query':
      if (args.length > 1) invalid();
      if (!groups.query) throw new Error('CAPABILITY_NOT_ALLOWED');
      return groups.query(args.length ? requireObject(args[0]) : {});
    case 'update':
      requireCount(args, 2);
      return groups.update(numericId(args[0]), requireObject(args[1]));
    case 'move':
      requireCount(args, 2);
      if (!groups.move) throw new Error('CAPABILITY_NOT_ALLOWED');
      return groups.move(numericId(args[0]), requireObject(args[1]));
    default:
      throw new Error('CAPABILITY_NOT_ALLOWED');
  }
}
async function dispatchBookmarks(
  api: BrowserActionAPI,
  method: string,
  args: unknown[],
): Promise<unknown> {
  const bookmarks = api.bookmarks;
  if (!bookmarks) throw new Error('CAPABILITY_NOT_ALLOWED');
  switch (method) {
    case 'search':
      requireCount(args, 1);
      return bookmarks.search(
        typeof args[0] === 'string' ? args[0] : requireObject(args[0]),
      );
    case 'getTree':
      requireCount(args, 0);
      return bookmarks.getTree();
    case 'create':
      requireCount(args, 1);
      return bookmarks.create(requireObject(args[0]));
    case 'update':
      requireCount(args, 2);
      return bookmarks.update(stringId(args[0]), requireObject(args[1]));
    case 'move':
      requireCount(args, 2);
      return bookmarks.move(stringId(args[0]), requireObject(args[1]));
    case 'remove':
      requireCount(args, 1);
      return bookmarks.remove(stringId(args[0]));
    default:
      throw new Error('CAPABILITY_NOT_ALLOWED');
  }
}
/** Delegate scoped management operations to the native Chrome extension API. */
export async function dispatchManagementAction(
  api: BrowserActionAPI,
  args: unknown[],
): Promise<unknown> {
  if (
    args.length !== 3 ||
    typeof args[0] !== 'string' ||
    typeof args[1] !== 'string'
  )
    return invalid();
  const [namespace, method] = args;
  const callArgs = argsArray(args[2]);
  switch (namespace) {
    case 'windows':
      return dispatchWindows(api, method, callArgs);
    case 'tabs':
      return dispatchTabs(api, method, callArgs);
    case 'tabGroups':
      return dispatchTabGroups(api, method, callArgs);
    case 'bookmarks':
      return dispatchBookmarks(api, method, callArgs);
    default:
      throw new Error('CAPABILITY_NOT_ALLOWED');
  }
}

export async function browserVisibility(
  api: BrowserActionAPI,
  method: 'browser.visibility.get' | 'browser.visibility.set',
  args: unknown[],
): Promise<unknown> {
  const port = api.windows;
  if (!port?.update) throw new Error('CAPABILITY_NOT_ALLOWED');
  const update = port.update.bind(port);
  if (method === 'browser.visibility.get') {
    if (args.length !== 0) return invalid();
    const windows = await port.getAll({ populate: false });
    return {
      visible: windows.some((window) => window.state !== 'minimized'),
      windows: windows.map((window) => ({
        id: window.id,
        state: window.state ?? 'normal',
      })),
    };
  }
  if (args.length !== 1 || typeof args[0] !== 'boolean') return invalid();
  const windows = await port.getAll({ populate: false });
  if (!args[0]) {
    const previous = windows
      .filter((window) => Number.isSafeInteger(window.id))
      .map((window) => ({ id: window.id, state: window.state ?? 'normal' }));
    await api.storage?.set({ [VISIBILITY_KEY]: previous });
    await Promise.all(
      previous.map((window) =>
        update(window.id as number, { state: 'minimized' }),
      ),
    );
    return { visible: false, changed: previous.length > 0 };
  }
  const stored = await api.storage?.get(VISIBILITY_KEY);
  const previous = Array.isArray(stored?.[VISIBILITY_KEY])
    ? (stored[VISIBILITY_KEY] as { id: number; state: string }[])
    : [];
  const byId = new Map(previous.map((window) => [window.id, window.state]));
  const minimized = windows.filter(
    (window) => Number.isSafeInteger(window.id) && window.state === 'minimized',
  );
  await Promise.all(
    minimized.map((window) =>
      update(window.id as number, {
        state:
          byId.get(window.id as number) === 'maximized'
            ? 'maximized'
            : 'normal',
      }),
    ),
  );
  await api.storage?.remove(VISIBILITY_KEY);
  return { visible: true, changed: minimized.length > 0 };
}

export async function nameSession(
  api: BrowserActionAPI,
  tabId: number,
  args: unknown[],
): Promise<unknown> {
  if (
    args.length < 1 ||
    args.length > 2 ||
    typeof args[0] !== 'string' ||
    !args[0].trim() ||
    args[0].length > 128 ||
    (args[1] !== undefined && (typeof args[1] !== 'string' || !args[1]))
  )
    return invalid();
  if (!api.tabs.group || !api.tabGroups?.update)
    throw new Error('CAPABILITY_NOT_ALLOWED');
  const taskId = typeof args[1] === 'string' ? args[1] : 'default';
  const tab = await api.tabs.get(tabId);
  const windowId = tab.windowId;
  const stored = await api.storage?.get(SESSION_KEY);
  const sessions = object(stored?.[SESSION_KEY])
    ? (stored[SESSION_KEY] as Record<string, Record<string, number>>)
    : {};
  const key =
    taskId +
    ':' +
    (Number.isSafeInteger(windowId) ? String(windowId) : 'unknown-window');
  const existingGroupId = sessions[key]?.groupId;
  let groupId: number;
  if (
    typeof existingGroupId === 'number' &&
    Number.isSafeInteger(existingGroupId)
  ) {
    groupId = existingGroupId;
    await api.tabs.group({ tabIds: [tabId], groupId });
  } else {
    groupId = await api.tabs.group({ tabIds: [tabId] });
  }
  await api.tabGroups.update(groupId, {
    title: args[0].trim(),
    color: 'blue',
  });
  sessions[key] = { groupId };
  await api.storage?.set({ [SESSION_KEY]: sessions });
  return { groupId, title: args[0].trim(), color: 'blue' };
}

export async function setFaviconStatus(
  api: BrowserActionAPI,
  tabId: number,
  args: unknown[],
): Promise<unknown> {
  if (
    args.length !== 2 ||
    typeof args[0] !== 'string' ||
    !['active', 'done', 'clear'].includes(String(args[1]))
  )
    return invalid();
  const stored = await api.storage?.get('avru.favicon.states');
  const states = object(stored?.['avru.favicon.states'])
    ? { ...stored['avru.favicon.states'] }
    : {};
  // An earlier task may finish after a newer task has taken this tab.
  // Its late completion must not clear the newer task's active badge.
  const current = states[String(tabId)];
  if (
    args[1] !== 'active' &&
    args[0] !== 'manual' &&
    object(current) &&
    typeof current.taskId === 'string' &&
    current.taskId !== args[0]
  )
    return { ok: true, status: current.status, stale: true };
  const next =
    args[1] === 'clear'
      ? Object.fromEntries(
          Object.entries(states).filter(([id]) => id !== String(tabId)),
        )
      : {
          ...states,
          [String(tabId)]: {
            status: args[1],
            taskId: args[0],
            updatedAt: Date.now(),
          },
        };
  await api.storage?.set({ 'avru.favicon.states': next });
  await api.tabs
    .sendMessage?.(tabId, {
      type: 'avru.favicon.status',
      status: args[1],
      taskId: args[0],
    })
    .catch(() => {});
  return { ok: true, status: args[1] };
}

export async function showVirtualCursor(
  api: BrowserActionAPI,
  tabId: number,
  args: unknown[],
): Promise<unknown> {
  if (
    args.length !== 1 ||
    !object(args[0]) ||
    typeof args[0].x !== 'number' ||
    !Number.isFinite(args[0].x) ||
    typeof args[0].y !== 'number' ||
    !Number.isFinite(args[0].y)
  )
    return invalid();
  // Follow only a visible browser mouse action; screenshots remain in background.
  if (args[0].visible !== false && api.tabs.update)
    await api.tabs.update(tabId, { active: true }).catch(() => {
      // The overlay is best-effort and must not block real CDP operations.
    });
  await api.tabs
    .sendMessage?.(tabId, {
      type: 'avru.cursor',
      x: args[0].x,
      y: args[0].y,
      visible: args[0].visible !== false,
      action: typeof args[0].action === 'string' ? args[0].action : 'move',
    })
    .catch(() => {});
  return { ok: true };
}
