import type { BrowserActionAPI } from './browser-ports';
type BrowserDownload = {
  id: number;
  url: string;
  filename: string;
  state: 'in_progress' | 'interrupted' | 'complete';
  tabId?: number | undefined;
  error?: string | undefined;
};

function downloadSummary(item: BrowserDownload) {
  return {
    downloadId: String(item.id),
    url: item.url,
    suggestedFilename: item.filename.split(/[\\/]/u).pop() || 'download',
  };
}

async function waitForDownloadId(
  api: BrowserActionAPI,
  id: number,
  timeoutMs: number,
): Promise<BrowserDownload> {
  if (!api.downloads) throw new Error('CAPABILITY_NOT_ALLOWED');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const item = (await api.downloads.search({ id }))[0];
    if (item?.state === 'complete') return item;
    if (item?.state === 'interrupted')
      throw new Error(item.error || 'PAGE_NOT_ACCESSIBLE');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('TIMEOUT');
}

async function listTabDownloads(
  api: BrowserActionAPI,
  tabId: number,
  args: unknown[],
): Promise<unknown> {
  if (args.length !== 0) throw new Error('INVALID_ARGUMENT');
  if (!api.downloads) throw new Error('CAPABILITY_NOT_ALLOWED');
  const items = await api.downloads.search({ limit: 100 });
  return items
    .filter((item) => item.tabId === tabId)
    .sort((a, b) => b.id - a.id)
    .slice(0, 100)
    .map(downloadSummary);
}

async function waitForTabDownload(
  api: BrowserActionAPI,
  tabId: number,
  args: unknown[],
): Promise<unknown> {
  if (
    args.length > 1 ||
    (args[0] !== undefined &&
      (!args[0] || typeof args[0] !== 'object' || Array.isArray(args[0])))
  )
    throw new Error('INVALID_ARGUMENT');
  if (!api.downloads) throw new Error('CAPABILITY_NOT_ALLOWED');
  const options = (args[0] ?? {}) as { timeoutMs?: unknown };
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    (timeoutMs as number) < 1 ||
    (timeoutMs as number) > 300_000
  )
    throw new Error('INVALID_ARGUMENT');
  const before = new Set(
    (await api.downloads.search({ limit: 100 })).map((item) => item.id),
  );
  const deadline = Date.now() + (timeoutMs as number);
  while (Date.now() <= deadline) {
    const items = await api.downloads.search({ limit: 100 });
    const item = items.find(
      (candidate) => candidate.tabId === tabId && !before.has(candidate.id),
    );
    if (item?.state === 'complete') return downloadSummary(item);
    if (item?.state === 'interrupted')
      throw new Error(item.error || 'PAGE_NOT_ACCESSIBLE');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('TIMEOUT');
}

async function downloadMedia(
  api: BrowserActionAPI,
  args: unknown[],
): Promise<unknown> {
  if (args.length < 1 || args.length > 2 || typeof args[0] !== 'string')
    throw new Error('INVALID_ARGUMENT');
  const url = args[0];
  if (!/^https?:\/\//u.test(url) || url.length > 8192)
    throw new Error('INVALID_ARGUMENT');
  const options = args[1] === undefined ? {} : args[1];
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new Error('INVALID_ARGUMENT');
  const filename = (options as { filename?: unknown }).filename;
  const timeoutMs = (options as { timeoutMs?: unknown }).timeoutMs ?? 120_000;
  if (
    (filename !== undefined &&
      (typeof filename !== 'string' || !filename || filename.length > 255)) ||
    !Number.isSafeInteger(timeoutMs) ||
    (timeoutMs as number) < 1 ||
    (timeoutMs as number) > 300_000
  )
    throw new Error('INVALID_ARGUMENT');
  if (!api.downloads) throw new Error('CAPABILITY_NOT_ALLOWED');
  const id = await api.downloads.download({
    url,
    ...(filename ? { filename } : {}),
    saveAs: false,
    conflictAction: 'uniquify',
  });
  const item = await waitForDownloadId(api, id, timeoutMs as number);
  return { path: item.filename, downloadId: String(id) };
}

async function saveDownload(
  api: BrowserActionAPI,
  args: unknown[],
): Promise<unknown> {
  if (args.length < 1 || args.length > 2) throw new Error('INVALID_ARGUMENT');
  // The QuickJS SDK passes null when the optional destination is omitted.
  const destination = args[1] ?? undefined;
  const id =
    typeof args[0] === 'string' && /^\d+$/u.test(args[0])
      ? Number(args[0])
      : args[0];
  if (
    !Number.isSafeInteger(id) ||
    (id as number) < 0 ||
    (destination !== undefined && typeof destination !== 'string')
  )
    throw new Error('INVALID_ARGUMENT');
  if (!api.downloads) throw new Error('CAPABILITY_NOT_ALLOWED');
  const item = (await api.downloads.search({ id: id as number }))[0];
  if (!item) throw new Error('INVALID_TARGET');
  if (item.state !== 'complete') throw new Error('TIMEOUT');
  if (destination !== undefined && destination !== item.filename)
    throw new Error('CAPABILITY_NOT_ALLOWED');
  return { path: item.filename };
}

/** Download actions are scoped to the current connected browser profile. */
export async function dispatchDownloadAction(
  api: BrowserActionAPI,
  tabId: number,
  method: string,
  args: unknown[],
): Promise<unknown> {
  switch (method) {
    case 'tab.downloads':
      return listTabDownloads(api, tabId, args);
    case 'tab.waitForDownload':
      return waitForTabDownload(api, tabId, args);
    case 'tab.downloadMedia':
      return downloadMedia(api, args);
    case 'tab.saveDownload':
      return saveDownload(api, args);
    default:
      throw new Error('CAPABILITY_NOT_ALLOWED');
  }
}
