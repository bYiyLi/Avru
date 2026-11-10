import type { BrowserActionAPI } from './browser-ports';

type ClipboardEntry = { mimeType: string; text?: string; base64?: string };
type ClipboardItem = {
  entries: ClipboardEntry[];
  presentationStyle?: 'unspecified' | 'inline' | 'attachment';
};
const MAX_BYTES = 65_536;

function invalid(): never {
  throw new Error('INVALID_ARGUMENT');
}

function base64Bytes(value: string): number {
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

function validateItems(value: unknown): ClipboardItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8)
    return invalid();
  let bytes = 0;
  const items = value.map((rawItem) => {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem))
      return invalid();
    const item = rawItem as Record<string, unknown>;
    if (
      !Array.isArray(item.entries) ||
      item.entries.length < 1 ||
      item.entries.length > 8
    )
      return invalid();
    const entries = item.entries.map((entry: unknown) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry))
        return invalid();
      const candidate = entry as Record<string, unknown>;
      if (
        typeof candidate.mimeType !== 'string' ||
        !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/u.test(
          candidate.mimeType,
        ) ||
        candidate.mimeType.length > 128
      )
        return invalid();
      if (candidate.text !== undefined) {
        if (typeof candidate.text !== 'string') return invalid();
        bytes += new TextEncoder().encode(candidate.text).length;
        return { mimeType: candidate.mimeType, text: candidate.text };
      }
      if (candidate.base64 !== undefined) {
        if (typeof candidate.base64 !== 'string') return invalid();
        bytes += base64Bytes(candidate.base64);
        return { mimeType: candidate.mimeType, base64: candidate.base64 };
      }
      return invalid();
    });
    const presentationStyle = item.presentationStyle;
    if (
      presentationStyle !== undefined &&
      (typeof presentationStyle !== 'string' ||
        !['unspecified', 'inline', 'attachment'].includes(presentationStyle))
    )
      return invalid();
    const style = presentationStyle as ClipboardItem['presentationStyle'];
    return {
      entries,
      ...(style ? { presentationStyle: style } : {}),
    };
  });
  if (bytes > MAX_BYTES) throw new Error('OUTPUT_TOO_LARGE');
  return items;
}

async function clipboardRead(
  port: NonNullable<BrowserActionAPI['clipboard']>,
  method: string,
  args: unknown[],
): Promise<unknown> {
  if (args.length !== 0) return invalid();
  if (method === 'tab.clipboard.readText') {
    if (!port.readText) throw new Error('CAPABILITY_NOT_ALLOWED');
    const value = await port.readText();
    if (new TextEncoder().encode(value).length > MAX_BYTES)
      throw new Error('OUTPUT_TOO_LARGE');
    return value;
  }
  if (!port.read) throw new Error('CAPABILITY_NOT_ALLOWED');
  return validateItems(await port.read());
}
async function clipboardWrite(
  port: NonNullable<BrowserActionAPI['clipboard']>,
  method: string,
  args: unknown[],
): Promise<unknown> {
  if (args.length !== 1) return invalid();
  if (method === 'tab.clipboard.writeText') {
    if (typeof args[0] !== 'string') return invalid();
    if (new TextEncoder().encode(args[0]).length > MAX_BYTES)
      throw new Error('OUTPUT_TOO_LARGE');
    if (!port.writeText) throw new Error('CAPABILITY_NOT_ALLOWED');
    await port.writeText(args[0]);
  } else {
    if (!port.write) throw new Error('CAPABILITY_NOT_ALLOWED');
    await port.write(validateItems(args[0]));
  }
  return { ok: true, changed: true };
}
export async function dispatchClipboardAction(
  api: BrowserActionAPI,
  method: string,
  args: unknown[],
): Promise<unknown> {
  const port = api.clipboard;
  if (!port) throw new Error('CAPABILITY_NOT_ALLOWED');
  try {
    if (method === 'tab.clipboard.read' || method === 'tab.clipboard.readText')
      return await clipboardRead(port, method, args);
    if (
      method === 'tab.clipboard.write' ||
      method === 'tab.clipboard.writeText'
    )
      return await clipboardWrite(port, method, args);
    throw new Error('CAPABILITY_NOT_ALLOWED');
  } catch (error) {
    if (
      error instanceof Error &&
      [
        'CAPABILITY_NOT_ALLOWED',
        'INVALID_ARGUMENT',
        'OUTPUT_TOO_LARGE',
      ].includes(error.message)
    )
      throw error;
    throw new Error('CAPABILITY_NOT_ALLOWED', { cause: error });
  }
}
