import type { BrowserActionAPI } from '../utils/browser-ports';
import { defaultEndpoint } from '../utils/channel';
import { extensionChannel } from '../utils/channel';
import type { ConsentRequest } from '../utils/oauth-consent';
import { ConsentController } from '../utils/oauth-consent';
import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { Connection } from '../utils/connection';
import { browserMetadata } from '../utils/metadata';
import { record } from '../utils/protocol';
import { dispatchBrowserAction } from '../utils/browser-actions';
import { CdpController, type CdpApi } from '../utils/cdp';
import { setFaviconStatus } from '../utils/management-actions';

function storedBadge(value: unknown, tabId: number) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const badge = (value as Record<string, unknown>)[String(tabId)];
  if (!badge || typeof badge !== 'object' || Array.isArray(badge)) return null;
  const row = badge as Record<string, unknown>;
  if (
    (row.status !== 'active' && row.status !== 'done') ||
    typeof row.taskId !== 'string'
  )
    return null;
  return {
    type: 'avru.favicon.status' as const,
    status: row.status,
    taskId: row.taskId,
  };
}

function registerBadgeCleanup(actions: BrowserActionAPI): void {
  browser.tabs.onActivated.addListener(({ tabId }) => {
    void browser.storage.local
      .get('avru.favicon.states')
      .then(async (stored) => {
        const badge = storedBadge(stored['avru.favicon.states'], tabId);
        if (badge?.status === 'done')
          await setFaviconStatus(actions, tabId, [badge.taskId, 'clear']);
      })
      .catch(() => {
        // Cosmetic cleanup must never interrupt browser navigation.
      });
  });
}

function restoreBadgeForPage(
  raw: unknown,
  sender: {
    id?: string | undefined;
    tab?: { id?: number | undefined } | undefined;
  },
  respond: (value: unknown) => void,
): boolean {
  const tabId = sender.tab?.id;
  if (
    sender.id !== browser.runtime.id ||
    tabId === undefined ||
    record(raw)?.type !== 'avru.overlay.ready'
  )
    return false;
  void browser.storage.local
    .get('avru.favicon.states')
    .then((stored) => {
      respond(storedBadge(stored['avru.favicon.states'], tabId));
    })
    .catch(() => {
      respond(null);
    });
  return true;
}

function createConsent(
  decide: (request: ConsentRequest, approved: boolean) => void,
): ConsentController {
  const consent = new ConsentController({
    open: async () => {
      const window = await browser.windows.create({
        url: `chrome-extension://${browser.runtime.id}/consent.html`,
        type: 'popup',
        width: 480,
        height: 600,
        focused: true,
      });
      if (window?.id === undefined)
        throw new Error('Consent window unavailable');
      return window.id;
    },
    close: (id) => browser.windows.remove(id),
    decide,
    now: Date.now,
  });
  browser.windows.onRemoved.addListener((id) => {
    consent.removed(id);
  });
  return consent;
}

export function clipboardActionPort(): NonNullable<
  BrowserActionAPI['clipboard']
> {
  return {
    read: async () => {
      if (typeof navigator.clipboard.read !== 'function')
        throw new Error('CAPABILITY_NOT_ALLOWED');
      const items = await navigator.clipboard.read();
      let remaining = 65_536;
      const result = [];
      for (const item of items.slice(0, 8)) {
        const entries = [];
        for (const mimeType of item.types.slice(0, 8)) {
          if (remaining <= 0) break;
          const blob = await item.getType(mimeType);
          if (blob.size > remaining) throw new Error('OUTPUT_TOO_LARGE');
          const clipped = new Uint8Array(await blob.arrayBuffer());
          remaining -= clipped.length;
          const base64 = btoa(
            Array.from(clipped, (value) => String.fromCharCode(value)).join(''),
          );
          entries.push({
            mimeType,
            ...(mimeType.startsWith('text/')
              ? { text: new TextDecoder().decode(clipped) }
              : { base64 }),
          });
        }
        result.push({ entries, presentationStyle: 'unspecified' });
      }
      return result;
    },
    readText: () => navigator.clipboard.readText(),
    write: async (items) => {
      if (typeof navigator.clipboard.write !== 'function')
        throw new Error('CAPABILITY_NOT_ALLOWED');
      const clipboardItems = items.map((item) => {
        const data: Record<string, Blob> = {};
        for (const entry of item.entries) {
          if (entry.text !== undefined)
            data[entry.mimeType] = new Blob([entry.text], {
              type: entry.mimeType,
            });
          else if (entry.base64 !== undefined) {
            const binary = atob(entry.base64);
            const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
            data[entry.mimeType] = new Blob([bytes], { type: entry.mimeType });
          }
        }
        return new ClipboardItem(data);
      });
      await navigator.clipboard.write(clipboardItems);
    },
    writeText: (text) => navigator.clipboard.writeText(text),
  };
}

export function browserActionPorts(): BrowserActionAPI {
  return {
    windows: {
      getAll: (options) => browser.windows.getAll(options),
      create: (options) => browser.windows.create(options),
      update: (id, options) => browser.windows.update(id, options),
    },
    history: { search: (options) => browser.history.search(options) },
    tabs: {
      get: (id) => browser.tabs.get(id),
      create: (options) => browser.tabs.create(options),
      remove: (id) => browser.tabs.remove(id),
      move: (id, options) => browser.tabs.move(id, options),
      update: async (id, options) =>
        (await browser.tabs.update(id, options)) ?? {},
      query: (options) => browser.tabs.query(options),
      group: (options) => browser.tabs.group(options),
      ungroup: (tabIds) =>
        browser.tabs.ungroup(tabIds as number | [number, ...number[]]),
      sendMessage: (id, message) => browser.tabs.sendMessage(id, message),
    },
    tabGroups: {
      get: (id) => browser.tabGroups.get(id),
      query: (query) => browser.tabGroups.query(query),
      update: (id, options) => browser.tabGroups.update(id, options),
      move: (id, options) =>
        browser.tabGroups.move(
          id,
          options as unknown as Parameters<typeof browser.tabGroups.move>[1],
        ),
    },
    bookmarks: {
      search: (query) => browser.bookmarks.search(query),
      getTree: () => browser.bookmarks.getTree(),
      create: (details) => browser.bookmarks.create(details),
      update: (id, changes) => browser.bookmarks.update(id, changes),
      move: (id, destination) => browser.bookmarks.move(id, destination),
      remove: (id) => browser.bookmarks.remove(id),
    },
    downloads: {
      download: (options) => browser.downloads.download(options),
      search: (query) => browser.downloads.search(query),
      removeFile: (id) => browser.downloads.removeFile(id),
    },
    clipboard: clipboardActionPort(),
    storage: {
      get: (keys) => browser.storage.local.get(keys),
      set: (items) => browser.storage.local.set(items),
      remove: (keys) => browser.storage.local.remove(keys),
    },
    scripting: {
      executeScript: (details) => browser.scripting.executeScript(details),
    },
  };
}

export default defineBackground(() => {
  const cdp = new CdpController(
    browser.debugger as unknown as CdpApi,
    (tabId) => {
      connection.interrupt(tabId);
    },
  );
  const actions = browserActionPorts();
  browser.action.onClicked.addListener(() => {
    browser.tabs.create({ url: `${defaultEndpoint()}/#overview` }).catch(() => {
      console.warn('Avru management page unavailable');
    });
  });
  const consent = createConsent((request, approved) => {
    connection.decideOAuth(request, approved);
  });
  const connection = new Connection({
    local: true,
    channel: extensionChannel(),
    onOAuthRequest: (request) => consent.show(request),
    onOAuthClose: (id) => {
      consent.close(id);
    },
    resetOAuth: () => {
      consent.reset();
    },
    metadata: () =>
      browserMetadata(navigator, browser.runtime.getManifest().version),
    read: async () =>
      (await browser.storage.local.get('connection')).connection,
    save: async (value) => {
      await browser.storage.local.set({ connection: value });
    },
    clear: async () => {
      await browser.storage.local.remove('connection');
    },
    tabs: () => browser.tabs.query({}),
    action: (tabId, method, args) =>
      dispatchBrowserAction(actions, cdp, { tabId, method, args }),
    socket: (url) => new WebSocket(url),
    uuid: () => crypto.randomUUID(),
    later: (callback, delay) => setTimeout(callback, delay),
    cancel: (timer) => {
      clearTimeout(timer);
    },
  });
  const started = connection.start();
  const handleError = () => {
    console.warn('Avru local connection unavailable');
  };
  const publish = () => {
    connection.publish().catch(handleError);
  };
  browser.tabs.onCreated.addListener(publish);
  browser.tabs.onUpdated.addListener(publish);
  browser.tabs.onRemoved.addListener(publish);
  registerBadgeCleanup(actions);
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'avru-reconnect') connection.reconnect();
  });
  browser.runtime.onMessage.addListener((raw: unknown, sender, respond) => {
    if (restoreBadgeForPage(raw, sender, respond)) return true;
    if (
      sender.id === browser.runtime.id &&
      sender.url === `chrome-extension://${browser.runtime.id}/consent.html`
    ) {
      const message = record(raw);
      consent
        .message(
          raw,
          typeof message?.windowId === 'number' ? message.windowId : undefined,
        )
        .then(respond, () => {
          respond(null);
        });
      return true;
    }
    return false;
  });
  browser.alarms
    .create('avru-reconnect', { periodInMinutes: 1 })
    .catch(handleError);
  started.catch(handleError);
});
