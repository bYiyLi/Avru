import type { CdpController } from './cdp';

type CdpPort = Pick<CdpController, 'send'>;
const MAX_EXPORT_BYTES = 8 * 1024 * 1024;

function asValue(result: unknown): unknown {
  if (
    !result ||
    typeof result !== 'object' ||
    (result as { exceptionDetails?: unknown }).exceptionDetails
  )
    throw new Error('PAGE_NOT_ACCESSIBLE');
  return (result as { result?: { value?: unknown } }).result?.value;
}
function bytesFromBase64(value: string): Uint8Array {
  if (
    value.length > 24_000 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  )
    throw new Error('PAGE_NOT_ACCESSIBLE');
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
function asBase64(value: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < value.length; offset += 0x8000)
    binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export async function pageString(
  cdp: CdpPort,
  tabId: number,
  expression: string,
): Promise<string> {
  const name = '__avru_export_' + crypto.randomUUID().replaceAll('-', '');
  const key = JSON.stringify(name);
  const prepare =
    '(async()=>{const value=await (' +
    expression +
    ');' +
    'if(typeof value!=="string")return {error:"PAGE_NOT_ACCESSIBLE"};' +
    'if(value.length>' +
    String(MAX_EXPORT_BYTES) +
    ')return {error:"OUTPUT_TOO_LARGE"};' +
    'globalThis[' +
    key +
    ']=value;return {length:value.length};})()';
  const result = await cdp.send(tabId, 'Runtime.evaluate', {
    expression: prepare,
    returnByValue: true,
    awaitPromise: true,
  });
  const info = asValue(result);
  if (!info || typeof info !== 'object') throw new Error('PAGE_NOT_ACCESSIBLE');
  const description = info as { length?: unknown; error?: unknown };
  if (typeof description.error === 'string') throw new Error(description.error);
  if (
    !Number.isSafeInteger(description.length) ||
    (description.length as number) < 0
  )
    throw new Error('PAGE_NOT_ACCESSIBLE');
  const chunks: string[] = [];
  let cursor = 0;
  const length = description.length as number;
  try {
    while (cursor < length) {
      const expression =
        '(()=>{const text=globalThis[' +
        key +
        '];' +
        'if(typeof text!=="string")return null;' +
        'const start=' +
        String(cursor) +
        ';let end=Math.min(text.length,start+8192);' +
        'if(end<text.length&&end>start){const c=text.charCodeAt(end-1);' +
        'if(c>=55296&&c<=56319)end--;}' +
        'return {text:text.slice(start,end),next:end};})()';
      const part = asValue(
        await cdp.send(tabId, 'Runtime.evaluate', {
          expression,
          returnByValue: true,
        }),
      );
      if (!part || typeof part !== 'object')
        throw new Error('PAGE_NOT_ACCESSIBLE');
      const payload = part as { text?: unknown; next?: unknown };
      if (
        typeof payload.text !== 'string' ||
        !Number.isSafeInteger(payload.next) ||
        (payload.next as number) <= cursor ||
        (payload.next as number) > length
      )
        throw new Error('PAGE_NOT_ACCESSIBLE');
      chunks.push(payload.text);
      cursor = payload.next as number;
    }
    return chunks.join('');
  } finally {
    await cdp
      .send(tabId, 'Runtime.evaluate', {
        expression: 'delete globalThis[' + key + ']',
        returnByValue: true,
      })
      .catch(() => {});
  }
}

export async function pdfBase64(cdp: CdpPort, tabId: number): Promise<string> {
  const response = (await cdp.send(tabId, 'Page.printToPDF', {
    printBackground: true,
    preferCSSPageSize: true,
    transferMode: 'ReturnAsStream',
  })) as { stream?: unknown; data?: unknown };
  if (typeof response.data === 'string') {
    if (response.data.length > (MAX_EXPORT_BYTES * 4) / 3)
      throw new Error('OUTPUT_TOO_LARGE');
    return response.data;
  }
  if (typeof response.stream !== 'string' || !response.stream)
    throw new Error('PAGE_NOT_ACCESSIBLE');
  const stream = response.stream;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (let index = 0; index < 1025; index++) {
      const next = (await cdp.send(tabId, 'IO.read', {
        handle: stream,
        size: 8192,
      })) as { data?: unknown; base64Encoded?: unknown; eof?: unknown };
      if (typeof next.data !== 'string' || next.base64Encoded !== true)
        throw new Error('PAGE_NOT_ACCESSIBLE');
      const chunk = bytesFromBase64(next.data);
      total += chunk.byteLength;
      if (total > MAX_EXPORT_BYTES) throw new Error('OUTPUT_TOO_LARGE');
      chunks.push(chunk);
      if (next.eof === true) {
        const combined = new Uint8Array(total);
        let offset = 0;
        for (const part of chunks) {
          combined.set(part, offset);
          offset += part.byteLength;
        }
        return asBase64(combined);
      }
    }
    throw new Error('OUTPUT_TOO_LARGE');
  } finally {
    await cdp.send(tabId, 'IO.close', { handle: stream }).catch(() => {});
  }
}
