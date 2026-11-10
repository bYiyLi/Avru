import type { CallHistory } from './call-types.js';
import type { ConnectionStatus } from '../../../packages/protocol/connection.d.ts';
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
export interface ExtensionFiles {
  directory: string;
  version: string;
  extensionId: string;
}
export interface SystemStatus {
  extensionFiles?: ExtensionFiles | null;
  daemonVersion: string;
  expectedExtensionVersion: string;
  mcp: 'notImplemented' | 'oauthReadOnly';
  chatgpt: 'notImplemented' | 'notVerified';
  frpc: 'notImplemented' | 'managed';
}
export interface ViewState {
  history?: CallHistory | null;
  connection?: ConnectionStatus | null;
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
function resetView(message: ViewState['message']): Partial<ViewState> {
  return {
    browsers: [],
    pairings: [],
    system: null,
    history: null,
    connection: null,
    message,
  };
}
function createApi(
  session: Session,
  request: typeof fetch,
  update: (change: Partial<ViewState>) => void,
) {
  return async function api(
    path: string,
    method = 'GET',
    body: unknown = {},
  ): Promise<unknown> {
    const response = await request(`/api/${path}`, {
      method,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${session.key ?? ''}`,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 401) {
      session.clear();
      update({
        ...resetView('session.expired'),
        authorized: false,
      });
      throw new Error('session.expired');
    }
    if (!response.ok) throw new Error('request.failed');
    return response.status === 204 ? null : response.json();
  };
}
function createModel() {
  let state: ViewState = {
    browsers: [],
    pairings: [],
    message: '',
    authorized: true,
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
  const model = createModel();
  const { update } = model;
  let running = false;
  let generation = 0;
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const api = createApi(session, request, update);
  async function poll(epoch: number) {
    const started = revision;
    try {
      const result = await readCurrentState(api);
      if (
        running &&
        epoch === generation &&
        model.state.authorized &&
        started === revision
      )
        update({
          ...result,
          message: '',
        });
    } catch {
      if (
        running &&
        epoch === generation &&
        model.state.authorized &&
        started === revision
      )
        update(resetView('connection.retrying'));
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
    ...connectionActions(model, api, () => {
      revision++;
    }),
    ...actions(action),
    runDiagnostics: () => runDiagnostics(api, request),
  };
}
export type Controller = ReturnType<typeof createController>;
export type DiagnosticStepId = 'daemon' | 'session' | 'extension' | 'mcp';
export type DiagnosticStepStatus = 'passed' | 'failed' | 'unknown';
export interface DiagnosticStep {
  id: DiagnosticStepId;
  status: DiagnosticStepStatus;
}
export interface DiagnosticReport {
  steps: DiagnosticStep[];
}
async function runDiagnostics(
  api: ReturnType<typeof createApi>,
  request: typeof fetch,
): Promise<DiagnosticReport> {
  const steps: DiagnosticStep[] = [];
  const daemonOk = await request('/health', { cache: 'no-store' })
    .then((response) => response.ok)
    .catch(() => false);
  steps.push({ id: 'daemon', status: daemonOk ? 'passed' : 'failed' });
  if (!daemonOk) {
    steps.push(
      { id: 'session', status: 'unknown' },
      { id: 'extension', status: 'unknown' },
      { id: 'mcp', status: 'unknown' },
    );
    return { steps };
  }
  let status: SystemStatus | null = null;
  try {
    status = (await api('status')) as SystemStatus;
    steps.push({ id: 'session', status: 'passed' });
  } catch {
    steps.push({ id: 'session', status: 'failed' });
  }
  if (!status) {
    steps.push(
      { id: 'extension', status: 'unknown' },
      { id: 'mcp', status: 'unknown' },
    );
    return { steps };
  }
  try {
    const { browsers } = (await api('browsers')) as {
      browsers: BrowserProfile[];
    };
    steps.push({
      id: 'extension',
      status: extensionStepStatus(browsers, status.expectedExtensionVersion),
    });
  } catch {
    steps.push({ id: 'extension', status: 'failed' });
  }
  steps.push({
    id: 'mcp',
    status: status.mcp === 'oauthReadOnly' ? 'passed' : 'failed',
  });
  return { steps };
}
function extensionStepStatus(
  browsers: BrowserProfile[],
  expected: string,
): DiagnosticStepStatus {
  if (!browsers.some((browser) => browser.connected)) return 'failed';
  const actual = browsers
    .filter((browser) => browser.connected)
    .map((browser) => browser.metadata?.extensionVersion)
    .find((version) => version);
  if (!actual) return 'unknown';
  return actual === expected ? 'passed' : 'failed';
}
function connectionActions(
  model: ReturnType<typeof createModel>,
  api: ReturnType<typeof createApi>,
  bump: () => void,
) {
  const mutate = async (method: 'POST' | 'DELETE', raw?: unknown) => {
    if (!model.state.authorized || model.state.busy)
      throw new Error('request.failed');
    bump();
    model.update({ busy: true });
    try {
      let connection: ConnectionStatus | null = null;
      if (method === 'DELETE') await api('connection', method);
      else
        connection = (await api(
          'connection/import',
          method,
          raw,
        )) as ConnectionStatus;
      model.update({ connection });
    } catch (error) {
      model.update({ connection: null });
      throw new Error('request.failed', { cause: error });
    } finally {
      bump();
      model.update({ busy: false });
    }
  };
  return {
    importConnection: (raw: unknown) => mutate('POST', raw),
    clearConnection: () => mutate('DELETE'),
  };
}

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

async function readCurrentState(api: ReturnType<typeof createApi>) {
  const { browsers } = (await api('browsers')) as {
    browsers: BrowserProfile[];
  };
  const { pairings } = (await api('pairings')) as { pairings: Pairing[] };
  const system = (await api('status')) as SystemStatus;
  const history = (await api('calls')) as CallHistory;
  const connection =
    system.frpc === 'managed'
      ? ((await api('connection')) as ConnectionStatus)
      : null;
  return { browsers, pairings, system, history, connection };
}
