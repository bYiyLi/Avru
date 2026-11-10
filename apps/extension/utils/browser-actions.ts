import type { BrowserActionAPI } from './browser-ports';
import type { CdpController } from './cdp';
import { readTabsContent } from './tabs-content';
import { searchBrowserHistory } from './browser-history';
import {
  browserVisibility,
  dispatchManagementAction,
  nameSession as groupSession,
  setFaviconStatus,
  showVirtualCursor,
} from './management-actions';
import { dispatchClipboardAction } from './clipboard-actions';
import { setInputFiles } from './file-actions';
import { dispatchPageCapability } from './page-capabilities';
import { dispatchObservabilityAction } from './observability-actions';
import { dispatchDownloadAction } from './download-actions';

export async function readBrowserAction(
  api: BrowserActionAPI,
  tabId: number,
  method: string,
): Promise<unknown> {
  if (!Number.isSafeInteger(tabId) || tabId < 0)
    throw new Error('INVALID_TARGET');
  if (method === 'tab.title' || method === 'tab.url') {
    const tab = await api.tabs.get(tabId);
    if (!tab.url || !/^https?:\/\//u.test(tab.url))
      throw new Error('PAGE_NOT_ACCESSIBLE');
    return method === 'tab.title' ? (tab.title ?? '') : tab.url;
  }
  if (method !== 'tab.snapshot') throw new Error('CAPABILITY_NOT_ALLOWED');
  const response = await api.scripting.executeScript({
    target: { tabId },
    func: () => ({
      title: document.title,
      url: location.href,
      text: document.querySelector('body')?.innerText ?? '',
    }),
  });
  const result = response[0]?.result;
  if (!result) throw new Error('PAGE_NOT_ACCESSIBLE');
  return {
    ...result,
    truncated: result.text.length > 16_384,
    text: result.text.slice(0, 16_384),
  };
}

function selectedId(value: unknown): number {
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9]\d*)$/u.test(value) ||
    !Number.isSafeInteger(Number(value))
  )
    throw new Error('INVALID_ARGUMENT');
  return Number(value);
}

function createOptions(args: unknown[]): { url?: string; active?: boolean } {
  if (args.length > 2) throw new Error('INVALID_ARGUMENT');
  const [url, options] = args;
  if (url !== null && url !== undefined && typeof url !== 'string')
    throw new Error('INVALID_ARGUMENT');
  if (
    options !== undefined &&
    (options === null || typeof options !== 'object' || Array.isArray(options))
  )
    throw new Error('INVALID_ARGUMENT');
  const active = (options as { active?: unknown } | undefined)?.active;
  if (active !== undefined && typeof active !== 'boolean')
    throw new Error('INVALID_ARGUMENT');
  return {
    ...(typeof url === 'string' ? { url } : {}),
    ...(typeof active === 'boolean' ? { active } : {}),
  };
}

async function createTab(
  api: BrowserActionAPI,
  args: unknown[],
): Promise<unknown> {
  const options = createOptions(args);
  if (!api.tabs.create) throw new Error('CAPABILITY_NOT_ALLOWED');
  const tab = await api.tabs.create(options);
  if (!Number.isSafeInteger(tab.id)) throw new Error('TARGET_GONE');
  return {
    tabId: String(tab.id),
    ...(tab.title ? { title: tab.title } : {}),
    ...(tab.url ? { url: tab.url } : {}),
  };
}

async function currentTab(
  api: BrowserActionAPI,
  tabId: number,
  args: unknown[],
): Promise<unknown> {
  if (args.length !== 0) throw new Error('INVALID_ARGUMENT');
  if (!api.tabs.query) throw new Error('CAPABILITY_NOT_ALLOWED');
  const current = await api.tabs.get(tabId);
  const selected = await api.tabs.query({
    active: true,
    ...(current.windowId !== undefined ? { windowId: current.windowId } : {}),
  });
  const active = selected[0];
  return active?.id === undefined
    ? null
    : {
        tabId: String(active.id),
        title: active.title ?? '',
        url: active.url ?? '',
      };
}

async function modifyTab(
  api: BrowserActionAPI,
  method: 'tabs.close' | 'tabs.select',
  args: unknown[],
): Promise<unknown> {
  if (args.length !== 1) throw new Error('INVALID_ARGUMENT');
  const id = selectedId(args[0]);
  if (method === 'tabs.close') {
    if (!api.tabs.remove) throw new Error('CAPABILITY_NOT_ALLOWED');
    await api.tabs.remove(id);
  } else {
    if (!api.tabs.update) throw new Error('CAPABILITY_NOT_ALLOWED');
    await api.tabs.update(id, { active: true });
  }
  return { ok: true, tabId: String(id), changed: true };
}

async function listWindows(
  api: BrowserActionAPI,
  args: unknown[],
): Promise<unknown> {
  if (args.length !== 0) throw new Error('INVALID_ARGUMENT');
  if (!api.windows?.getAll) throw new Error('CAPABILITY_NOT_ALLOWED');
  const windows = await api.windows.getAll({ populate: false });
  return windows
    .filter(
      (window) => window.incognito !== true && Number.isSafeInteger(window.id),
    )
    .slice(0, 100)
    .map((window) => ({
      id: String(window.id),
      focused: window.focused === true,
      ...(window.type ? { type: window.type } : {}),
      ...(window.state ? { state: window.state } : {}),
    }));
}

async function moveTab(
  api: BrowserActionAPI,
  args: unknown[],
): Promise<unknown> {
  if (
    args.length !== 2 ||
    !args[1] ||
    typeof args[1] !== 'object' ||
    Array.isArray(args[1])
  )
    throw new Error('INVALID_ARGUMENT');
  const id = selectedId(args[0]);
  const opts = args[1] as { index?: unknown; windowId?: unknown };
  if (
    !Number.isSafeInteger(opts.index) ||
    (opts.index as number) < -1 ||
    (opts.windowId !== undefined &&
      (!Number.isSafeInteger(opts.windowId) || (opts.windowId as number) < 0))
  )
    throw new Error('INVALID_ARGUMENT');
  if (!api.tabs.move) throw new Error('CAPABILITY_NOT_ALLOWED');
  const moved = await api.tabs.move(id, {
    index: opts.index as number,
    ...(opts.windowId === undefined
      ? {}
      : { windowId: opts.windowId as number }),
  });
  return {
    ok: true,
    tabId: String(moved.id ?? id),
    changed: true,
    ...(Number.isSafeInteger(moved.windowId)
      ? { windowId: String(moved.windowId) }
      : {}),
    ...(Number.isSafeInteger(moved.index) ? { index: moved.index } : {}),
  };
}

function manageTabs(
  api: BrowserActionAPI,
  tabId: number,
  method: string,
  args: unknown[],
): Promise<unknown> {
  switch (method) {
    case 'tabs.move':
      return moveTab(api, args);
    case 'tabs.content':
      return readTabsContent(api, args);
    case 'tabs.new':
      return createTab(api, args);
    case 'tabs.selected':
      return currentTab(api, tabId, args);
    case 'tabs.close':
    case 'tabs.select':
      return modifyTab(api, method, args);
    default:
      return Promise.reject(new Error('CAPABILITY_NOT_ALLOWED'));
  }
}

function sendCdp(
  cdp: Pick<CdpController, 'send'>,
  tabId: number,
  args: unknown[],
): Promise<unknown> {
  const command = args[0];
  const params = args[1];
  if (
    typeof command !== 'string' ||
    (params !== undefined &&
      (params === null || typeof params !== 'object' || Array.isArray(params)))
  )
    throw new Error('INVALID_ARGUMENT');
  return cdp.send(
    tabId,
    command,
    params as Record<string, unknown> | undefined,
  );
}
function visualExecution(
  api: BrowserActionAPI,
  cdp: Pick<CdpController, 'send' | 'cursor' | 'events'> &
    Partial<Pick<CdpController, 'resume' | 'detach'>>,
  input: {
    tabId: number;
    method: 'tab.execution.start' | 'tab.execution.finish';
    args: unknown[];
  },
): Promise<unknown> {
  const { tabId, method, args } = input;
  if (method === 'tab.execution.start') {
    if (
      args.length !== 2 ||
      typeof args[0] !== 'string' ||
      !args[0] ||
      typeof args[1] !== 'string' ||
      !args[1].trim() ||
      args[1].length > 128
    )
      throw new Error('INVALID_ARGUMENT');
    if (!cdp.resume) throw new Error('CAPABILITY_NOT_ALLOWED');
    cdp.resume(tabId);
    // The page may have a blocking JS dialog; presentation must not block
    // the action channel that will handle that same dialog.
    void Promise.all([
      setFaviconStatus(api, tabId, [args[0], 'active']),
      groupSession(api, tabId, [args[1], args[0]]),
    ]).catch(() => {});
    return Promise.resolve({ ok: true });
  }
  if (
    args.length !== 2 ||
    typeof args[0] !== 'string' ||
    !args[0] ||
    !['succeeded', 'failed', 'cancelled', 'unknown'].includes(String(args[1]))
  )
    throw new Error('INVALID_ARGUMENT');
  void Promise.all([
    setFaviconStatus(api, tabId, [
      args[0],
      args[1] === 'succeeded' ? 'done' : 'clear',
    ]),
    showVirtualCursor(api, tabId, [
      { x: 0, y: 0, visible: false, action: 'end' },
    ]),
  ]).catch(() => {});
  return Promise.resolve({ ok: true });
}

/** Browser method routing is explicit; CDP domain/method names remain unrestricted. */
export async function dispatchBrowserAction(
  api: BrowserActionAPI,
  cdp: Pick<CdpController, 'send' | 'cursor' | 'events'> &
    Partial<Pick<CdpController, 'resume' | 'detach'>>,
  action: { tabId: number; method: string; args?: unknown[] | undefined },
): Promise<unknown> {
  const { tabId, method, args = [] } = action;
  switch (method) {
    case 'tab.execution.start':
    case 'tab.execution.finish':
      return visualExecution(api, cdp, { tabId, method, args });
    case 'management.invoke':
      return dispatchManagementAction(api, args);
    case 'browser.visibility.get':
    case 'browser.visibility.set':
      return browserVisibility(api, method, args);
    case 'tab.favicon.status':
      return setFaviconStatus(api, tabId, args);
    case 'tab.visual.cursor':
      return showVirtualCursor(api, tabId, args);
    case 'cdp.readEvents':
    case 'tab.dev.logs':
    case 'tab.getJsDialog':
    case 'tab.dialogAccept':
    case 'tab.dialogDismiss':
      return dispatchObservabilityAction(cdp, tabId, method, args);
    case 'tab.setFiles':
      return setInputFiles(api, cdp, tabId, args);
    case 'tab.exportFile':
    case 'tab.content.export':
    case 'tab.content.exportGsuite':
    case 'tab.content.exportYouTubeTranscript':
    case 'tab.assets.list':
    case 'tab.assets.bundle':
    case 'tab.webmcp.fetchTools':
    case 'tab.webmcp.invokeTool':
      return dispatchPageCapability({ api, cdp, tabId }, method, args);
    case 'windows.list':
      return listWindows(api, args);
    case 'browser.nameSession':
      return groupSession(api, tabId, args);
    case 'tab.markDeliverable':
    case 'tab.markHandoff':
      if (args.length !== 0) throw new Error('INVALID_ARGUMENT');
      return setFaviconStatus(api, tabId, ['manual', 'done']);
    case 'tab.requestUserTakeover':
      if (
        args.length > 1 ||
        (args[0] !== undefined && typeof args[0] !== 'string')
      )
        throw new Error('INVALID_ARGUMENT');
      return setFaviconStatus(api, tabId, [
        args[0] ?? 'user_requested',
        'done',
      ]);
    case 'tab.downloads':
    case 'tab.waitForDownload':
    case 'tab.downloadMedia':
    case 'tab.saveDownload':
      return dispatchDownloadAction(api, tabId, method, args);
    case 'history.search':
      return searchBrowserHistory(api, args);
    case 'cdp.send':
      return sendCdp(cdp, tabId, args);
    case 'cdp.events': {
      const cursor = args[0];
      if (cursor !== undefined && typeof cursor !== 'string')
        throw new Error('INVALID_ARGUMENT');
      return cdp.events(tabId, cursor);
    }
    case 'cdp.cursor':
      return cdp.cursor(tabId);
    default:
      if (method.startsWith('tab.clipboard.'))
        return dispatchClipboardAction(api, method, args);
      if (method.startsWith('tabs.'))
        return manageTabs(api, tabId, method, args);
      return readBrowserAction(api, tabId, method);
  }
}
