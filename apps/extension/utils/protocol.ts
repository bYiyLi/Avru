export interface Credentials {
  endpoint: string;
  profileId: string;
  name: string;
  browserId: string;
  token: string;
}
export interface PairInput {
  endpoint: string;
  name: string;
}
export interface Tab {
  id?: number | undefined;
  title?: string | undefined;
  url?: string | undefined;
  incognito?: boolean | undefined;
}
export interface SnapshotTab {
  id: number;
  title: string;
  url: string;
}
export function socketUrl(endpoint: string): string {
  if (!/^http:\/\/127\.0\.0\.1(?::[0-9]{1,5})?\/?$/.test(endpoint))
    throw new Error('仅支持本机 IPv4 地址');
  const url = new URL(endpoint);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('仅支持 http://127.0.0.1:端口');
  return `ws://${url.host}/extension`;
}
export function validatePair(input: PairInput): PairInput {
  socketUrl(input.endpoint);
  const name = input.name.trim();
  if (!name || name.length > 80) throw new Error('请输入不超过 80 字的名称');
  return { ...input, name };
}
export function snapshot(tabs: Tab[]): SnapshotTab[] {
  const result: SnapshotTab[] = [];
  for (const tab of tabs) {
    if (tab.incognito || tab.id === undefined || !tab.url) continue;
    try {
      const url = new URL(tab.url);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        continue;
      url.search = '';
      url.hash = '';
      if (url.href.length <= 2048)
        result.push({
          id: tab.id,
          title: (tab.title ?? '').slice(0, 256),
          url: url.href,
        });
    } catch {
      continue;
    }
    if (result.length === 500) break;
  }
  return result;
}
export function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
export function credentials(value: unknown): Credentials | undefined {
  const data = record(value);
  if (
    !data ||
    !['endpoint', 'profileId', 'name', 'browserId', 'token'].every(
      (key) => typeof data[key] === 'string' && data[key].length > 0,
    )
  )
    return undefined;
  try {
    socketUrl(data.endpoint as string);
  } catch {
    return undefined;
  }
  return data as unknown as Credentials;
}
