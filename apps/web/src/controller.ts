export interface BrowserProfile {
  id: string;
  name: string;
  connected: boolean;
  connectionId: string | null;
  tabs: { id: number; title: string; url: string }[];
  metadata?: {
    browserName: string;
    browserVersion: string;
    versionSource: 'clientHints' | 'userAgent' | 'unknown';
    extensionVersion: string;
  } | null;
}
export interface Pairing {
  id: string;
  name: string;
  code: string;
  expiresAt: number;
  origin: string;
}
export interface SystemStatus {
  daemonVersion: string;
  expectedExtensionVersion: string;
  mcp: 'notImplemented';
  chatgpt: 'notImplemented';
  frpc: 'notImplemented';
}
export interface ViewState {
  system?: SystemStatus | null;
  browsers: BrowserProfile[];
  pairings: Pairing[];
  message: string;
  authorized: boolean;
  busy: boolean;
}
export interface Session {
  key: string | null;
  clear: () => void;
}
function createApi(
  session: Session,
  request: typeof fetch,
  update: (change: Partial<ViewState>) => void,
) {
  return async function api(path: string, method = 'GET'): Promise<unknown> {
    const response = await request(`/api/${path}`, {
      method,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${session.key ?? ''}`,
        'Content-Type': 'application/json',
      },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
    if (response.status === 401) {
      session.clear();
      update({
        authorized: false,
        browsers: [],
        pairings: [],
        system: null,
        message: '会话已失效，请重新打开守护进程提供的管理链接。',
      });
      throw new Error('会话已失效');
    }
    if (!response.ok) throw new Error('请求失败，请确认守护进程正在运行。');
    return response.status === 204 ? null : response.json();
  };
}
function createModel(session: Session) {
  let state: ViewState = {
    browsers: [],
    pairings: [],
    message: '',
    authorized: !!session.key,
    busy: false,
  };
  const listeners = new Set<() => void>();
  function update(change: Partial<ViewState>) {
    state = { ...state, ...change };
    for (const listener of listeners) listener();
  }
  return {
    get state() {
      return state;
    },
    snapshot: () => state,
    update,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export function createController(
  session: Session,
  request: typeof fetch = fetch,
) {
  const model = createModel(session);
  const { update } = model;
  let running = false;
  let generation = 0;
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const api = createApi(session, request, update);
  async function poll(epoch: number) {
    const started = revision;
    try {
      const result = (await api('browsers')) as { browsers: BrowserProfile[] };
      const pending = (await api('pairings')) as { pairings: Pairing[] };
      const system = (await api('status')) as SystemStatus;
      if (
        running &&
        epoch === generation &&
        model.state.authorized &&
        started === revision
      )
        update({
          system,
          browsers: result.browsers,
          pairings: pending.pairings,
          message: '',
        });
    } catch {
      if (
        running &&
        epoch === generation &&
        model.state.authorized &&
        started === revision
      )
        update({
          browsers: [],
          pairings: [],
          system: null,
          message: '无法连接守护进程，正在重试…',
        });
    }
    if (running && epoch === generation && model.state.authorized)
      timer = setTimeout(() => {
        poll(epoch).catch(session.clear);
      }, 2000);
  }
  async function action(path: string, method: string) {
    if (!model.state.authorized || model.state.busy) return;
    revision++;
    update({ busy: true, message: '' });
    try {
      await api(path, method);
      update({
        browsers: model.state.browsers.filter(
          (browser) => `browsers/${encodeURIComponent(browser.id)}` !== path,
        ),
        pairings: model.state.pairings.filter(
          (pairing) =>
            !path.startsWith(`pairings/${encodeURIComponent(pairing.id)}`),
        ),
      });
    } catch (error) {
      update({ message: error instanceof Error ? error.message : '请求失败' });
    } finally {
      revision++;
      update({ busy: false });
    }
  }
  return {
    snapshot: model.snapshot,
    subscribe: model.subscribe,
    start() {
      if (running || !model.state.authorized) return;
      running = true;
      generation++;
      poll(generation).catch(session.clear);
    },
    stop: () => {
      running = false;
      generation++;
      clearTimeout(timer);
    },
    ...actions(action),
  };
}
export type Controller = ReturnType<typeof createController>;

function actions(action: (path: string, method: string) => Promise<void>) {
  return {
    approve: (id: string) =>
      action(`pairings/${encodeURIComponent(id)}/approve`, 'POST'),
    reject: (id: string) =>
      action(`pairings/${encodeURIComponent(id)}`, 'DELETE'),
    revoke: (id: string) =>
      action(`browsers/${encodeURIComponent(id)}`, 'DELETE'),
  };
}
