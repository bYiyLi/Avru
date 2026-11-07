export interface Tab {
  id: number;
  title: string;
  url: string;
}
export interface BrowserMetadata {
  browserName: string;
  browserVersion: string;
  versionSource: 'clientHints' | 'userAgent' | 'unknown';
  extensionVersion: string;
}
export type Message =
  | { v: 1; type: 'pair'; profileId: string; name: string }
  | { v: 1; type: 'authenticate'; browserId: string; token: string }
  | { v: 1; type: 'tabs'; tabs: Tab[] }
  | { v: 1; type: 'metadata'; metadata: BrowserMetadata }
  | { v: 1; type: 'ping' };

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= maximum
  );
}
function tab(value: unknown): Tab {
  if (
    !record(value) ||
    !Number.isSafeInteger(value.id) ||
    typeof value.id !== 'number' ||
    value.id < 0 ||
    typeof value.title !== 'string' ||
    value.title.length > 256 ||
    !text(value.url, 2048)
  ) {
    throw new Error('Invalid tab');
  }
  const url = new URL(value.url);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Invalid URL');
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return { id: value.id, title: value.title, url: url.href };
}
function tabs(value: unknown): Tab[] {
  if (!Array.isArray(value) || value.length > 500)
    throw new Error('Invalid tabs');
  const items = value.map((item: unknown) => tab(item));
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new Error('Duplicate tab');
  return items;
}
function metadata(value: unknown): BrowserMetadata {
  if (
    !record(value) ||
    !text(value.browserName, 80) ||
    !text(value.browserVersion, 64) ||
    !text(value.extensionVersion, 64) ||
    (value.versionSource !== 'clientHints' &&
      value.versionSource !== 'userAgent' &&
      value.versionSource !== 'unknown')
  )
    throw new Error('Invalid browser metadata');
  return {
    browserName: value.browserName,
    browserVersion: value.browserVersion,
    extensionVersion: value.extensionVersion,
    versionSource: value.versionSource,
  };
}
export function parseMessage(raw: string): Message {
  if (Buffer.byteLength(raw, 'utf8') > 8_388_608)
    throw new Error('Message too large');
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.v !== 1) throw new Error('Invalid version');
  switch (value.type) {
    case 'pair':
      if (!text(value.profileId, 64) || !text(value.name, 80))
        throw new Error('Invalid identity');
      return {
        v: 1,
        type: 'pair',
        profileId: value.profileId,
        name: value.name,
      };
    case 'authenticate':
      if (
        !text(value.browserId, 64) ||
        typeof value.token !== 'string' ||
        !/^[a-f0-9]{64}$/.test(value.token)
      )
        throw new Error('Invalid credential');
      return {
        v: 1,
        type: 'authenticate',
        browserId: value.browserId,
        token: value.token,
      };
    case 'metadata':
      return { v: 1, type: 'metadata', metadata: metadata(value.metadata) };
    case 'tabs':
      return { v: 1, type: 'tabs', tabs: tabs(value.tabs) };
    case 'ping':
      return { v: 1, type: 'ping' };
    default:
      throw new Error('Unsupported message');
  }
}
