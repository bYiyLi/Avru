import type { CdpController } from './cdp';
import type { BrowserActionAPI } from './browser-ports';
import { pageString, pdfBase64 } from './cdp-exports';
const MAX_EXPORT_BYTES = 8 * 1024 * 1024;

function invalid(): never {
  throw new Error('INVALID_ARGUMENT');
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}
function safeFilename(value: string, extension: string): string {
  const stem =
    value
      .normalize('NFKC')
      .replace(/[\\/:*?"<>|]/gu, '_')
      .replace(/\p{Cc}/gu, '_')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 100) || 'avru-export';
  return stem.toLowerCase().endsWith('.' + extension)
    ? stem
    : stem + '.' + extension;
}
async function saveData(
  api: BrowserActionAPI,
  data: string,
  mimeType: string,
  filename: string,
): Promise<string> {
  if (!api.downloads) throw new Error('CAPABILITY_NOT_ALLOWED');
  if (data.length > (MAX_EXPORT_BYTES * 4) / 3)
    throw new Error('OUTPUT_TOO_LARGE');
  const id = await api.downloads.download({
    url: `data:${mimeType};base64,${data}`,
    filename,
    saveAs: false,
    conflictAction: 'uniquify',
  });
  const deadline = Date.now() + 120_000;
  while (Date.now() <= deadline) {
    const item = (await api.downloads.search({ id }))[0];
    if (item?.state === 'complete') return item.filename;
    if (item?.state === 'interrupted')
      throw new Error(item.error || 'PAGE_NOT_ACCESSIBLE');
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('TIMEOUT');
}

async function exportFile(
  api: BrowserActionAPI,
  cdp: Pick<CdpController, 'send'>,
  tabId: number,
  args: unknown[],
): Promise<unknown> {
  if (
    args.length !== 1 ||
    !object(args[0]) ||
    !['pdf', 'html', 'markdown'].includes(String(args[0].format))
  )
    return invalid();
  const format = args[0].format as 'pdf' | 'html' | 'markdown';
  const tab = await api.tabs.get(tabId);
  const title = tab.title ?? 'avru-export';
  let data: string;
  let mimeType: string;
  let extension: string;
  if (format === 'pdf') {
    data = await pdfBase64(cdp, tabId);
    mimeType = 'application/pdf';
    extension = 'pdf';
  } else if (format === 'html') {
    const html = await pageString(
      cdp,
      tabId,
      'document.documentElement ? document.documentElement.outerHTML : ""',
    );
    data = encodeBase64(html);
    mimeType = 'text/html';
    extension = 'html';
  } else {
    const markdown = await pageString(
      cdp,
      tabId,
      `(() => {
      const root = document.querySelector('main,article,[role="main"]') || document.body;
      const lines = [];
      const walk = (node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node;
        const tag = el.tagName.toLowerCase();
        const text = (el.innerText || el.textContent || '').trim();
        if (!text) return;
        if (/^h[1-6]$/.test(tag)) lines.push('#'.repeat(Number(tag[1])) + ' ' + text.split('\\n')[0], '');
        else if (tag === 'p') lines.push(text, '');
        else if (tag === 'li') lines.push('- ' + text.split('\\n')[0]);
        else if (tag === 'blockquote') lines.push(...text.split('\\n').map(x => '> ' + x), '');
        else if (tag === 'pre' || tag === 'code') {
          const fence = String.fromCharCode(96).repeat(3);
          lines.push(fence, text, fence, '');
        }
        else if (tag === 'a' && el.href) lines.push('[' + text + '](' + el.href + ')');
        for (const child of el.children) walk(child);
      };
      for (const child of root.children) walk(child);
      return '# ' + document.title + '\\n\\n' + location.href + '\\n\\n' +
        (lines.length ? lines.join('\\n') : root.innerText || '');
    })()`,
    );
    data = encodeBase64(markdown);
    mimeType = 'text/markdown';
    extension = 'md';
  }
  const path = await saveData(
    api,
    data,
    mimeType,
    safeFilename(title, extension),
  );
  return { path };
}

async function exportGsuite(
  api: BrowserActionAPI,
  cdp: Pick<CdpController, 'send'>,
  tabId: number,
  args: unknown[],
): Promise<unknown> {
  if (
    args.length !== 1 ||
    !['pdf', 'md', 'xlsx', 'csv', 'docx', 'pptx'].includes(String(args[0]))
  )
    return invalid();
  const format = args[0] as string;
  const tab = await api.tabs.get(tabId);
  const match = (tab.url ?? '').match(
    /^https:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([\w-]+)/u,
  );
  if (!match) throw new Error('PAGE_NOT_ACCESSIBLE');
  const kind = match[1] ?? '';
  const id = match[2] ?? '';
  if (format === 'md') {
    if (kind !== 'document') throw new Error('CAPABILITY_NOT_ALLOWED');
    // UTF-8 plain text is valid Markdown. Do not mislabel an HTML or ZIP export as .md.
    const endpoint = `https://docs.google.com/document/d/${id}/export?format=txt`;
    const text = await pageString(
      cdp,
      tabId,
      `(async()=>{const r=await fetch(${JSON.stringify(endpoint)},{credentials:'include'});if(!r.ok)throw new Error('PAGE_NOT_ACCESSIBLE');return r.text();})()`,
    );
    const path = await saveData(
      api,
      encodeBase64(text),
      'text/markdown',
      safeFilename(tab.title ?? 'google-export', 'md'),
    );
    return { path };
  }
  const allowed: Record<string, string[]> = {
    document: ['pdf', 'docx'],
    spreadsheets: ['pdf', 'xlsx', 'csv'],
    presentation: ['pdf', 'pptx'],
  };
  if (!allowed[kind]?.includes(format))
    throw new Error('CAPABILITY_NOT_ALLOWED');
  const endpoint = `https://docs.google.com/${kind}/d/${id}/export?format=${format}`;
  if (!api.downloads) throw new Error('CAPABILITY_NOT_ALLOWED');
  const downloadId = await api.downloads.download({
    url: endpoint,
    filename: safeFilename(tab.title ?? 'google-export', format),
    saveAs: false,
    conflictAction: 'uniquify',
  });
  const deadline = Date.now() + 120_000;
  while (Date.now() <= deadline) {
    const item = (await api.downloads.search({ id: downloadId }))[0];
    if (item?.state === 'complete') return { path: item.filename };
    if (item?.state === 'interrupted')
      throw new Error(item.error || 'PAGE_NOT_ACCESSIBLE');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('TIMEOUT');
}

async function exportYouTubeTranscript(
  api: BrowserActionAPI,
  cdp: Pick<CdpController, 'send'>,
  tabId: number,
): Promise<unknown> {
  const tab = await api.tabs.get(tabId);
  const url = new URL(tab.url ?? 'https://invalid.example/');
  if (
    url.protocol !== 'https:' ||
    !['youtube.com', 'www.youtube.com'].includes(url.hostname) ||
    url.pathname !== '/watch' ||
    !url.searchParams.get('v')
  )
    throw new Error('PAGE_NOT_ACCESSIBLE');
  const transcript = await pageString(
    cdp,
    tabId,
    `(async () => {
    const player = globalThis.ytInitialPlayerResponse;
    const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks) || !tracks.length) return '';
    const track = tracks.find(item => item.languageCode === 'en') || tracks[0];
    const response = await fetch(track.baseUrl);
    if (!response.ok) throw new Error('TRANSCRIPT_UNAVAILABLE');
    const xml = await response.text();
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    return Array.from(doc.querySelectorAll('text')).map(node =>
      (node.textContent || '').replace(/\\s+/g, ' ').trim()
    ).filter(Boolean).join('\\n');
  })()`,
  );
  if (!transcript) throw new Error('PAGE_NOT_ACCESSIBLE');
  const path = await saveData(
    api,
    encodeBase64(transcript),
    'text/plain',
    safeFilename(tab.title ?? 'youtube-transcript', 'txt'),
  );
  return { path };
}

export async function dispatchExportCapability(
  ctx: {
    api: BrowserActionAPI;
    cdp: Pick<CdpController, 'send'>;
    tabId: number;
  },
  method: string,
  args: unknown[],
): Promise<unknown> {
  const { api, cdp, tabId } = ctx;
  switch (method) {
    case 'tab.exportFile':
      return exportFile(api, cdp, tabId, args);
    case 'tab.content.export':
      return exportFile(api, cdp, tabId, [{ format: 'markdown' }]);
    case 'tab.content.exportGsuite':
      return exportGsuite(api, cdp, tabId, args);
    case 'tab.content.exportYouTubeTranscript':
      if (args.length !== 0) return invalid();
      return exportYouTubeTranscript(api, cdp, tabId);
    default:
      throw new Error('CAPABILITY_NOT_ALLOWED');
  }
}
