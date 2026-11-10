import type { CdpController } from './cdp';
import type { BrowserActionAPI } from './browser-ports';
import { dispatchExportCapability } from './page-exports';

type CdpPort = Pick<CdpController, 'send'>;

function invalid(): never {
  throw new Error('INVALID_ARGUMENT');
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function pageAssets(cdp: CdpPort, tabId: number): Promise<unknown> {
  const response = (await cdp.send(tabId, 'Runtime.evaluate', {
    expression:
      'performance.getEntriesByType("resource").filter(item=>item.name.startsWith("https://")||item.name.startsWith("http://")).slice(0,200).map(item=>({url:item.name,type:item.initiatorType||"resource",size:item.transferSize||undefined}))',
    returnByValue: true,
  })) as { result?: { value?: unknown } };
  const items = response.result?.value;
  if (!Array.isArray(items)) throw new Error('PAGE_NOT_ACCESSIBLE');
  const seen = new Set<string>();
  return items.filter((item) => {
    if (
      !record(item) ||
      typeof item.url !== 'string' ||
      typeof item.type !== 'string' ||
      seen.has(item.url)
    )
      return false;
    seen.add(item.url);
    return true;
  });
}
function assetUrls(args: unknown[]): string[] {
  if (args.length !== 1) return invalid();
  const raw = args[0];
  const urls: unknown = Array.isArray(raw)
    ? raw
    : record(raw)
      ? raw.urls
      : undefined;
  if (!Array.isArray(urls) || urls.length < 1 || urls.length > 20)
    return invalid();
  if (
    urls.some(
      (url) =>
        typeof url !== 'string' ||
        !(url.startsWith('https://') || url.startsWith('http://')) ||
        url.length > 4096,
    )
  )
    return invalid();
  return urls as string[];
}
async function downloadAsset(
  downloads: NonNullable<BrowserActionAPI['downloads']>,
  url: string,
): Promise<string> {
  const id = await downloads.download({
    url,
    saveAs: false,
    conflictAction: 'uniquify',
  });
  const deadline = Date.now() + 120_000;
  while (Date.now() <= deadline) {
    const item = (await downloads.search({ id }))[0];
    if (item?.state === 'complete') return item.filename;
    if (item?.state === 'interrupted')
      throw new Error(item.error || 'PAGE_NOT_ACCESSIBLE');
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('TIMEOUT');
}
async function bundleAssets(
  api: BrowserActionAPI,
  args: unknown[],
): Promise<unknown> {
  const urls = assetUrls(args);
  const downloads = api.downloads;
  if (!downloads) throw new Error('CAPABILITY_NOT_ALLOWED');
  const files: { url: string; path: string }[] = [];
  for (const url of urls)
    files.push({ url, path: await downloadAsset(downloads, url) });
  return { files };
}
async function discoverWebmcp(cdp: CdpPort, tabId: number): Promise<unknown> {
  const expression =
    '(async()=>{const context=navigator.modelContext||document.modelContext;' +
    'if(!context||typeof context.getTools!=="function")return {unavailable:true};' +
    'const tools=await context.getTools();if(!Array.isArray(tools))return {unavailable:true};' +
    'return tools.slice(0,64).map(t=>({name:String(t.name||"").slice(0,128),' +
    'description:String(t.description||"").slice(0,1024),inputSchema:t.inputSchema||{},' +
    'annotations:t.annotations||{},origin:t.origin||location.origin,' +
    'title:String(t.title||"").slice(0,128)}));})()';
  const response = (await cdp.send(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as { result?: { value?: unknown } };
  const value = response.result?.value;
  if (record(value) && value.unavailable === true)
    throw new Error('CAPABILITY_NOT_ALLOWED');
  if (!Array.isArray(value)) throw new Error('PAGE_NOT_ACCESSIBLE');
  if (JSON.stringify(value).length > 55_000)
    throw new Error('OUTPUT_TOO_LARGE');
  return value;
}
async function invokeWebmcp(
  cdp: CdpPort,
  tabId: number,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const data = JSON.stringify({ name, args });
  if (data.length > 8192) throw new Error('OUTPUT_TOO_LARGE');
  const expression =
    '(async()=>{const input=' +
    data +
    ';' +
    'const context=navigator.modelContext||document.modelContext;' +
    'if(!context||typeof context.getTools!=="function"||typeof context.executeTool!=="function")' +
    'return {error:"CAPABILITY_NOT_ALLOWED"};' +
    'const tools=await context.getTools();' +
    'if(!Array.isArray(tools))return {error:"CAPABILITY_NOT_ALLOWED"};' +
    'const tool=tools.find(t=>t.name===input.name);' +
    'if(!tool)return {error:"ELEMENT_NOT_FOUND"};' +
    'try{return {result:await context.executeTool(tool,input.args)};}' +
    'catch(error){return {error:error&&typeof error.message==="string"?' +
    'error.message:"ACTION_FAILED"};}})()';
  const response = (await cdp.send(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as { result?: { value?: unknown } };
  const value = response.result?.value;
  if (!record(value)) throw new Error('PAGE_NOT_ACCESSIBLE');
  if (typeof value.error === 'string') throw new Error(value.error);
  const result = value.result ?? null;
  if (JSON.stringify(result).length > 55_000)
    throw new Error('OUTPUT_TOO_LARGE');
  return result;
}
async function webmcp(
  cdp: CdpPort,
  tabId: number,
  method: string,
  args: unknown[],
): Promise<unknown> {
  if (method === 'tab.webmcp.fetchTools') {
    if (args.length !== 0) return invalid();
    return discoverWebmcp(cdp, tabId);
  }
  if (
    args.length !== 2 ||
    typeof args[0] !== 'string' ||
    !args[0] ||
    args[0].length > 128 ||
    !record(args[1])
  )
    return invalid();
  return invokeWebmcp(cdp, tabId, args[0], args[1]);
}
export async function dispatchPageCapability(
  ctx: { api: BrowserActionAPI; cdp: CdpPort; tabId: number },
  method: string,
  args: unknown[],
): Promise<unknown> {
  const { api, cdp, tabId } = ctx;
  switch (method) {
    case 'tab.assets.list':
      if (args.length !== 0) return invalid();
      return pageAssets(cdp, tabId);
    case 'tab.assets.bundle':
      return bundleAssets(api, args);
    case 'tab.webmcp.fetchTools':
    case 'tab.webmcp.invokeTool':
      return webmcp(cdp, tabId, method, args);
    default:
      return dispatchExportCapability(ctx, method, args);
  }
}
