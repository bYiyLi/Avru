import type { CdpController } from './cdp';
import type { BrowserActionAPI } from './browser-ports';

type UploadFile = { name: string; data: string; mimeType?: string };

function invalid(): never {
  throw new Error('INVALID_ARGUMENT');
}

function bytes(value: string): number {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  )
    return invalid();
  return (
    Math.floor((value.length * 3) / 4) -
    (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0)
  );
}

function validateFiles(value: unknown): UploadFile[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8)
    return invalid();
  let total = 0;
  const files = value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      return invalid();
    const file = item as Record<string, unknown>;
    if (
      typeof file.name !== 'string' ||
      !file.name ||
      file.name.length > 255 ||
      /[\\/\0]/u.test(file.name) ||
      file.name === '.' ||
      file.name === '..' ||
      typeof file.data !== 'string' ||
      (file.mimeType !== undefined &&
        (typeof file.mimeType !== 'string' || file.mimeType.length > 128))
    )
      return invalid();
    total += bytes(file.data);
    return {
      name: file.name,
      data: file.data,
      ...(typeof file.mimeType === 'string' ? { mimeType: file.mimeType } : {}),
    };
  });
  if (total > 65_536) throw new Error('OUTPUT_TOO_LARGE');
  return files;
}

async function waitForDownload(
  api: BrowserActionAPI,
  id: number,
  timeoutMs: number,
): Promise<string> {
  if (!api.downloads) throw new Error('CAPABILITY_NOT_ALLOWED');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const item = (await api.downloads.search({ id }))[0];
    if (item?.state === 'complete') return item.filename;
    if (item?.state === 'interrupted')
      throw new Error(item.error || 'PAGE_NOT_ACCESSIBLE');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('TIMEOUT');
}

async function backendNodeId(
  cdp: Pick<CdpController, 'send'>,
  tabId: number,
  target: unknown,
): Promise<number> {
  if (target && typeof target === 'object' && !Array.isArray(target)) {
    const value = target as Record<string, unknown>;
    if (
      Number.isSafeInteger(value.backendNodeId) &&
      (value.backendNodeId as number) > 0
    )
      return value.backendNodeId as number;
  }
  if (typeof target !== 'string' || !target.startsWith('e:')) return invalid();
  await cdp.send(tabId, 'DOM.enable', {});
  const resolved = (await cdp.send(tabId, 'Runtime.evaluate', {
    expression: `(() => { const s=globalThis.__avru_sdk_refs_v1; const i=s&&s.refs.get(${JSON.stringify(target)}); return i&&i.element&&i.element.isConnected?i.element:null; })()`,
    returnByValue: false,
  })) as { result?: { objectId?: string } };
  const objectId = resolved.result?.objectId;
  if (typeof objectId !== 'string') throw new Error('STALE_REF');
  try {
    const requested = (await cdp.send(tabId, 'DOM.requestNode', {
      objectId,
    })) as {
      nodeId?: number;
    };
    if (!Number.isSafeInteger(requested.nodeId)) throw new Error('STALE_REF');
    const described = (await cdp.send(tabId, 'DOM.describeNode', {
      nodeId: requested.nodeId,
    })) as {
      node?: {
        backendNodeId?: number;
        nodeName?: string;
        attributes?: string[];
      };
    };
    const node = described.node;
    if (!node || !Number.isSafeInteger(node.backendNodeId))
      throw new Error('STALE_REF');
    if (
      node.nodeName !== 'INPUT' ||
      !node.attributes?.some(
        (item, index, values) =>
          item === 'type' && values[index + 1] === 'file',
      )
    )
      throw new Error('ELEMENT_NOT_INTERACTABLE');
    return node.backendNodeId as number;
  } finally {
    await cdp
      .send(tabId, 'Runtime.releaseObject', { objectId })
      .catch(() => {});
  }
}

export async function setInputFiles(
  api: BrowserActionAPI,
  cdp: Pick<CdpController, 'send'>,
  tabId: number,
  args: unknown[],
): Promise<unknown> {
  if (args.length < 2 || args.length > 3) return invalid();
  const pathValues =
    Array.isArray(args[1]) &&
    args[1].every((value) => typeof value === 'string')
      ? args[1]
      : undefined;
  if (
    pathValues &&
    (pathValues.length < 1 ||
      pathValues.length > 8 ||
      pathValues.some(
        (path) =>
          !path ||
          path.length > 4096 ||
          path.includes('\0') ||
          !(path.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(path)),
      ))
  )
    return invalid();
  const files = pathValues ? undefined : validateFiles(args[1]);
  const options = args[2] === undefined ? {} : args[2];
  if (!options || typeof options !== 'object' || Array.isArray(options))
    return invalid();
  const timeoutMs = (options as Record<string, unknown>).timeoutMs ?? 30_000;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    (timeoutMs as number) < 1 ||
    (timeoutMs as number) > 120_000
  )
    return invalid();
  const backendId = await backendNodeId(cdp, tabId, args[0]);
  if (pathValues) {
    await cdp.send(tabId, 'DOM.setFileInputFiles', {
      files: pathValues,
      backendNodeId: backendId,
    });
    return { ok: true, changed: true, fileCount: pathValues.length };
  }
  if (!files) return invalid();
  const downloads = api.downloads;
  if (!downloads?.download || !downloads.removeFile)
    throw new Error('CAPABILITY_NOT_ALLOWED');
  const removeFile = downloads.removeFile.bind(downloads);
  const downloaded: { id: number; path: string }[] = [];
  try {
    for (const file of files) {
      const id = await downloads.download({
        url: `data:${file.mimeType ?? 'application/octet-stream'};base64,${file.data}`,
        filename: `avru-upload-${crypto.randomUUID()}-${file.name}`,
        saveAs: false,
        conflictAction: 'uniquify',
      });
      const path = await waitForDownload(api, id, timeoutMs as number);
      downloaded.push({ id, path });
    }
    await cdp.send(tabId, 'DOM.setFileInputFiles', {
      files: downloaded.map((item) => item.path),
      backendNodeId: backendId,
    });
    return { ok: true, changed: true, fileCount: downloaded.length };
  } finally {
    await Promise.all(
      downloaded.map((item) => removeFile(item.id).catch(() => {})),
    );
  }
}
