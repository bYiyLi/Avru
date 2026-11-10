export interface Tab {
  id: number;
  title: string;
  url: string;
  active: boolean;
}
export interface BrowserMetadata {
  browserName: string;
  browserVersion: string;
  versionSource: 'clientHints' | 'userAgent' | 'unknown';
  extensionVersion: string;
}
export interface ActionError {
  code: string;
  message: string;
}
export interface ActionMessage {
  v: 1;
  type: 'action';
  requestId: string;
  tabId: number;
  generation: number;
  method: string;
  args: unknown[];
}
export type ActionResultMessage =
  | {
      v: 1;
      type: 'action_result';
      requestId: string;
      ok: true;
      value?: unknown;
    }
  | {
      v: 1;
      type: 'action_result';
      requestId: string;
      ok: false;
      error: ActionError;
    };
export interface ChunkMessage {
  v: 1;
  type: 'chunk';
  requestId: string;
  index: number;
  total: number;
  payload: string;
}
export type Message =
  | {
      v: 1;
      type: 'pair' | 'auto-probe' | 'local-connect';
      channel?: string;
      profileId: string;
      name: string;
    }
  | {
      v: 1;
      type: 'authenticate';
      channel?: string;
      browserId: string;
      token: string;
    }
  | { v: 1; type: 'tabs'; tabs: Tab[] }
  | { v: 1; type: 'metadata'; metadata: BrowserMetadata }
  | {
      v: 1;
      type: 'oauth-decision';
      requestId: string;
      nonce: string;
      approved: boolean;
    }
  | { v: 1; type: 'auto-redeem'; ticket: string }
  | { v: 1; type: 'control-interrupted'; tabId: number }
  | ActionMessage
  | ActionResultMessage
  | ChunkMessage
  | { v: 1; type: 'ping' };

function interruptedMessage(value: Record<string, unknown>): Message {
  if (
    !Number.isSafeInteger(value.tabId) ||
    typeof value.tabId !== 'number' ||
    value.tabId < 0
  )
    throw new Error('Invalid interrupted tab');
  return { v: 1, type: 'control-interrupted', tabId: value.tabId };
}

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
  return {
    id: value.id,
    title: value.title,
    url: url.href,
    active: value.active === true,
  };
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
function actionMessage(value: Record<string, unknown>): ActionMessage {
  if (
    !text(value.requestId, 64) ||
    !Number.isSafeInteger(value.tabId) ||
    typeof value.tabId !== 'number' ||
    value.tabId < 0 ||
    !Number.isSafeInteger(value.generation) ||
    typeof value.generation !== 'number' ||
    value.generation < 0 ||
    !text(value.method, 128) ||
    !Array.isArray(value.args) ||
    value.args.length > 1024
  )
    throw new Error('Invalid action');
  return {
    v: 1,
    type: 'action',
    requestId: value.requestId,
    tabId: value.tabId,
    generation: value.generation,
    method: value.method,
    args: value.args,
  };
}
function actionResultMessage(
  value: Record<string, unknown>,
): ActionResultMessage {
  if (!text(value.requestId, 64) || typeof value.ok !== 'boolean')
    throw new Error('Invalid action result');
  if (value.ok)
    return {
      v: 1,
      type: 'action_result',
      requestId: value.requestId,
      ok: true,
      ...(value.value !== undefined ? { value: value.value } : {}),
    };
  if (
    !record(value.error) ||
    !text(value.error.code, 64) ||
    typeof value.error.message !== 'string' ||
    value.error.message.length > 512
  )
    throw new Error('Invalid action result');
  return {
    v: 1,
    type: 'action_result',
    requestId: value.requestId,
    ok: false,
    error: { code: value.error.code, message: value.error.message },
  };
}
function chunkMessage(value: Record<string, unknown>): ChunkMessage {
  if (
    !text(value.requestId, 64) ||
    !Number.isSafeInteger(value.index) ||
    typeof value.index !== 'number' ||
    !Number.isSafeInteger(value.total) ||
    typeof value.total !== 'number' ||
    value.index < 0 ||
    value.total < 1 ||
    value.index >= value.total ||
    value.total > 4096 ||
    typeof value.payload !== 'string' ||
    Buffer.byteLength(value.payload, 'utf8') > 1_048_576
  )
    throw new Error('Invalid chunk');
  return {
    v: 1,
    type: 'chunk',
    requestId: value.requestId,
    index: value.index,
    total: value.total,
    payload: value.payload,
  };
}
export function parseMessage(raw: string): Message {
  if (Buffer.byteLength(raw, 'utf8') > 8_388_608)
    throw new Error('Message too large');
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.v !== 1) throw new Error('Invalid version');
  switch (value.type) {
    case 'auto-probe':
    case 'local-connect':
    case 'pair':
      if (!text(value.profileId, 64) || !text(value.name, 80))
        throw new Error('Invalid identity');
      return {
        v: 1,
        type: value.type,
        ...(typeof value.channel === 'string'
          ? { channel: value.channel }
          : {}),
        profileId: value.profileId,
        name: value.name,
      };
    case 'auto-redeem':
      if (
        typeof value.ticket !== 'string' ||
        !/^[a-f0-9]{64}$/.test(value.ticket)
      )
        throw new Error('Invalid ticket');
      return { v: 1, type: 'auto-redeem', ticket: value.ticket };
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
        ...(typeof value.channel === 'string'
          ? { channel: value.channel }
          : {}),
        browserId: value.browserId,
        token: value.token,
      };
    case 'oauth-decision':
      if (
        !text(value.requestId, 64) ||
        !text(value.nonce, 64) ||
        typeof value.approved !== 'boolean'
      )
        throw new Error('Invalid consent');
      return {
        v: 1,
        type: 'oauth-decision',
        requestId: value.requestId,
        nonce: value.nonce,
        approved: value.approved,
      };
    case 'control-interrupted':
      return interruptedMessage(value);
    case 'action':
      return actionMessage(value);
    case 'action_result':
      return actionResultMessage(value);
    case 'chunk':
      return chunkMessage(value);
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
