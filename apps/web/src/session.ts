const storageKey = 'avru.management.key';
export interface SessionHost {
  location: Pick<Location, 'hash' | 'pathname' | 'search'>;
  history: Pick<History, 'replaceState'>;
  sessionStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}
export function managementSession(host: SessionHost) {
  const fragment = new URLSearchParams(host.location.hash.slice(1));
  const incoming = fragment.get('key');
  if (host.location.hash) {
    host.history.replaceState(
      null,
      '',
      host.location.pathname + host.location.search,
    );
  }
  if (incoming !== null) {
    host.sessionStorage.removeItem(storageKey);
    if (/^[a-f0-9]{64}$/.test(incoming))
      host.sessionStorage.setItem(storageKey, incoming);
  }
  const key = host.sessionStorage.getItem(storageKey);
  return {
    key: key && /^[a-f0-9]{64}$/.test(key) ? key : null,
    clear: () => {
      host.sessionStorage.removeItem(storageKey);
    },
  };
}

// A private link reopened in an existing tab can be a same-document navigation.
// Reload only an explicit well-formed capability fragment so startup imports it.
export function reloadManagementLink(hash: string, reload: () => void) {
  if (/^#key=[a-f0-9]{64}$/.test(hash)) reload();
}

// Chromium may cache the initial document URL in MessageSender.url. A real
// reload, not just replaceState, keeps the capability fragment out of IPC.
export function bootstrapManagement(
  host: SessionHost,
  reload: () => void,
  mount: (session: ReturnType<typeof managementSession>) => void,
) {
  const hadFragment = Boolean(host.location.hash);
  const session = managementSession(host);
  if (hadFragment) reload();
  else mount(session);
}
