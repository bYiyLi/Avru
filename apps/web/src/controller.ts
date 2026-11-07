import type { CallHistory } from './call-types.js';
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
  mcp: 'notImplemented' | 'oauthReadOnly';
  chatgpt: 'notImplemented';
  frpc: 'notImplemented';
}
export interface ViewState {
  history?: CallHistory | null;
  system?: SystemStatus | null;
  browsers: BrowserProfile[];
  pairings: Pairing[];
  message: '' | 'session.expired' | 'request.failed' | 'connection.retrying';
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
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
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
        history: null,
        message: 'session.expired',
      });
      throw new Error('session.expired');
    }
    if (!response.ok) throw new Error('request.failed');
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
      const history = (await api('calls')) as CallHistory;
      if (
        running &&
        epoch === generation &&
        model.state.authorized &&
        started === revision
      )
        update({
          system,
          history,
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
          history: null,
          message: 'connection.retrying',
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
    } catch {
      update({ message: actionError(model.snapshot()) });
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

function actionError(state: ViewState): ViewState['message'] {
  return state.authorized ? 'request.failed' : 'session.expired';
}
