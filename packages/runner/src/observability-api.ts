/** QuickJS observability APIs backed by the browser's existing CDP event stream. */
export const OBSERVABILITY_API_SOURCE = String.raw`(() => {
  function installObservabilityApi(tab) {
  const cdp = tab.cdp;
  const levels = ['debug', 'info', 'log', 'warn', 'warning', 'error'];
  function invalid(detail) {
    throw new SdkError('INVALID_ARGUMENT', detail);
  }
  function result() {
    return {
      ok: true, tabId: tab.tabId, generation: tab.generation,
      pageVersion: 0, changed: true
    };
  }
  function normalizeLevel(value) {
    if (value === 'warning') return 'warn';
    if (value === 'assert') return 'error';
    return levels.includes(value) ? value : 'log';
  }
  function text(value) {
    if (value === null) return 'null';
    if (value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      try { return JSON.stringify(value); } catch { return '[object]'; }
    }
    return String(value);
  }
  function time(raw) {
    const stamp = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0
      ? (raw > 1e11 ? raw : raw * 1000) : Date.now();
    const date = new Date(stamp);
    return (Number.isFinite(date.getTime()) ? date : new Date()).toISOString();
  }
  function consoleLog(event) {
    const p = event.params || {};
    if (event.method === 'Runtime.consoleAPICalled') {
      const args = Array.isArray(p.args) ? p.args : [];
      return {
        level: normalizeLevel(p.type),
        message: args.map(item =>
          text(item && (item.value !== undefined ? item.value :
            item.description !== undefined ? item.description : item.type))).join(' ').slice(0, 1024),
        timestamp: time(p.timestamp),
        ...(p.stackTrace && p.stackTrace.callFrames && p.stackTrace.callFrames[0]
          && p.stackTrace.callFrames[0].url
          ? { url: String(p.stackTrace.callFrames[0].url).slice(0, 512) } : {})
      };
    }
    if (event.method === 'Log.entryAdded' && p.entry) {
      return {
        level: normalizeLevel(p.entry.level),
        message: text(p.entry.text).slice(0, 1024),
        timestamp: time(p.entry.timestamp),
        ...(typeof p.entry.url === 'string' ? { url: p.entry.url.slice(0, 512) } : {})
      };
    }
    return null;
  }
  async function devLogs(options) {
    if (options === undefined) options = {};
    if (options === null || typeof options !== 'object' || Array.isArray(options))
      invalid('devLogs options must be an object');
    // Keep a bounded response below the private IPC 64 KiB message ceiling.
    const limit = options.limit === undefined ? 20 : options.limit;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25)
      invalid('devLogs limit must be an integer 1..25');
    if (options.filter !== undefined && typeof options.filter !== 'string')
      invalid('devLogs filter must be text');
    if (options.levels !== undefined &&
      (!Array.isArray(options.levels) ||
       options.levels.some(level => !levels.includes(level))))
      invalid('devLogs levels must be known console levels');
    if (options.since !== undefined &&
      (typeof options.since !== 'number' || !Number.isFinite(options.since) ||
       options.since < 0))
      invalid('devLogs since must be an epoch timestamp in milliseconds');
    await cdp.send('Runtime.enable', {});
    await cdp.send('Log.enable', {});
    const response = await cdp.events();
    const events = Array.isArray(response.events) ? response.events : [];
    const accepted = options.levels ? options.levels.map(normalizeLevel) : null;
    const found = [];
    for (const event of events) {
      const log = consoleLog(event);
      if (!log) continue;
      if (accepted && !accepted.includes(log.level)) continue;
      if (options.filter && !log.message.includes(options.filter)) continue;
      if (options.since !== undefined &&
          Date.parse(log.timestamp) < options.since) continue;
      found.push(log);
    }
    return found.slice(-limit);
  }
  async function getJsDialog() {
    // A live modal blocks ordinary Page commands. Read the already subscribed
    // event stream only; never send Page.enable while the modal is open.
    const response = await cdp.events();
    const events = Array.isArray(response.events) ? response.events : [];
    let active = null;
    for (const event of events) {
      if (event.method === 'Page.javascriptDialogClosed') active = null;
      if (event.method !== 'Page.javascriptDialogOpening') continue;
      const p = event.params || {};
      if (['alert','confirm','prompt','beforeunload'].includes(p.type))
        active = { type: p.type, message: typeof p.message === 'string' ? p.message : '' };
    }
    return active;
  }
  async function dialogAccept(promptText) {
    if (promptText !== undefined && typeof promptText !== 'string')
      invalid('dialogAccept text must be a string');
    await cdp.send('Page.handleJavaScriptDialog', {
      accept: true, ...(promptText === undefined ? {} : { promptText })
    });
    return result();
  }
  async function dialogDismiss() {
    await cdp.send('Page.handleJavaScriptDialog', { accept: false });
    return result();
  }
  tab.devLogs = devLogs;
  tab.getJsDialog = getJsDialog;
  tab.dialogAccept = dialogAccept;
  tab.dialogDismiss = dialogDismiss;
  }
  Object.defineProperty(globalThis, '__avruInstallObservabilityApi', { value: installObservabilityApi });
})()`;
