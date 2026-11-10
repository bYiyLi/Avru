import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten';
import type { RunTarget } from './protocol.js';
import { PAGE_API_SOURCE } from './page-api.js';
import { PAGE_LOCATORS_SOURCE } from './page-locators.js';
import { BROWSER_API_SOURCE } from './browser-api.js';
import { CUA_API_SOURCE } from './cua-api.js';
import { DOM_API_SOURCE } from './dom-api.js';
import { AX_API_SOURCE } from './ax-api.js';
import { OBSERVABILITY_API_SOURCE } from './observability-api.js';
import { SCREENSHOT_API_SOURCE } from './screenshot-api.js';
import { PLAYWRIGHT_EXTRAS_SOURCE } from './playwright-extras.js';

/**
 * Avru browser SDK shell (M1–M3 incremental implementation). Injects the
 * `browser` global into each isolated QuickJS task. The SDK now exposes
 * read/write page methods, browser tab lifecycle and full CDP pass-through.
 * It is not yet the complete 148-member reference API.
 *
 * Bridge method contract — the daemon owns task authorization, target
 * routing, connection generation and the exact supported SDK method set.
 * Each host operation uses `__hostCall` with `args` as a
 * JSON array; the return value is always JSON-serializable. A bridge
 * failure arrives as bridge_result ok:false and is rethrown in the script
 * as an SdkError whose `code` is the daemon's error code (see the error
 * table in browser-sdk.md); the script must branch on `error.code`, never
 * on the message text.
 *
 * | bridge method       | args                  | returns                       | notes                        |
 * | ------------------- | --------------------- | ----------------------------- | ---------------------------- |
 * | tabs.list           | []                    | BrowserTab[]                  | read-only tab metadata only  |
 * | tabs.get            | [tabId: string]       | BrowserTab                    | one tab's metadata           |
 * | tab.title           | []                    | string                        | title of the claimed target  |
 * | capabilities.list   | []                    | CapabilityInfo[]              | static minimal set (below)   |
 * | capabilities.get    | [name: string]        | CapabilityInfo                | one capability by name       |
 *
 * BrowserTab: { browserId, tabId, generation, title?, url?, active,
 * claimed }. CapabilityInfo: { name, title, description, supported,
 * reason? }. Argument validation happens inside the script BEFORE any
 * bridge call: a bad argument throws SdkError INVALID_ARGUMENT and nothing
 * is sent to the extension. `browser.tab` metadata (browserId/tabId/
 * generation) comes from run_task.target; the title/url snapshot is NOT
 * exposed as properties because `tab.title` is the title() method.
 */
export type SdkTarget = RunTarget;

export { SDK_CAPABILITIES } from './sdk-capabilities.js';
export type { CapabilityInfo } from './sdk-capabilities.js';

const SDK_SOURCE = String.raw`(() => {
  class SdkError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'SdkError';
      this.code = code;
    }
  }
  Object.defineProperty(globalThis, 'SdkError', { value: SdkError, writable: false, configurable: false });
  function isNonEmptyString(value) { return typeof value === 'string' && value.length > 0; }
  function invalidArgument(method, detail) {
    throw new SdkError('INVALID_ARGUMENT', method + ': ' + detail);
  }
  async function call(method, args) {
    let raw;
    try {
      raw = await globalThis.__hostCall(method, JSON.stringify(args));
    } catch (error) {
      const code = error && typeof error.code === 'string' && error.code ? error.code : 'BRIDGE_REJECTED';
      throw new SdkError(code, (error && error.message) || 'bridge rejected');
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new SdkError('BRIDGE_REJECTED', 'bridge returned a non-JSON value');
    }
  }
  function callForTab(tab, method, args) {
    if (tab.__primary) return call(method, args);
    return call('tab.action', [tab.browserId, tab.tabId, tab.generation, method, args]);
  }
  function validateTabInfo(info, method) {
    if (!info || typeof info !== 'object' ||
        typeof info.browserId !== 'string' || !info.browserId ||
        !isNonEmptyString(String(info.tabId)) ||
        !Number.isSafeInteger(info.generation) || info.generation < 1)
      throw new SdkError('INVALID_TARGET', method + ': browser tab is unavailable');
  }
  function parseUserTab(input) {
    if (input && typeof input === 'object' &&
        typeof input.browserId === 'string' &&
        (typeof input.tabId === 'string' || typeof input.tabId === 'number') &&
        Number.isSafeInteger(Number(input.generation))) {
      const result = { browserId: input.browserId, tabId: String(input.tabId), generation: Number(input.generation) };
      if (!result.browserId || !/^(0|[1-9][0-9]*)$/.test(result.tabId) || result.generation < 1)
        invalidArgument('browser.user', 'invalid provider tab identity');
      return result;
    }
    const token = typeof input === 'string' ? input :
      input && typeof input === 'object' ? (input.providerTabId || input.id) : undefined;
    if (typeof token !== 'string') invalidArgument('browser.user', 'expected a providerTabId or BrowserUserTabInfo');
    const parts = token.split(':');
    if (parts.length !== 3 || !parts[0] || !/^(0|[1-9][0-9]*)$/.test(parts[1]) ||
        !/^[1-9][0-9]*$/.test(parts[2]))
      invalidArgument('browser.user', 'invalid provider tab identity');
    return { browserId: parts[0], tabId: parts[1], generation: Number(parts[2]) };
  }
  const TAB_CAPABILITIES = Object.freeze([
    { id: 'cdp', description: 'Unrestricted Chrome DevTools Protocol commands and buffered events.' },
    { id: 'pageAssets', description: 'Inventory and bundle assets observed in the current page.' },
    { id: 'webmcp', description: 'Discover document-bound WebMCP tools.' },
  ]);
  function managementNamespace(namespace, methods) {
    const result = {};
    for (const method of methods)
      result[method] = (...args) => call('management.invoke', [namespace, method, args]);
    return Object.freeze(result);
  }
  function makeTabCapability(id, tab) {
    const documentation = async () => call('documentation.get', [id]);
    if (id === 'cdp') return Object.freeze({
      documentation,
      send: (method, params, options) => tab.cdp.send(method, params, options),
      readEvents: options => tab.cdp.readEvents(options),
    });
    if (id === 'pageAssets') return Object.freeze({
      documentation,
      list: () => tab.assets.list(),
      bundle: options => tab.assets.bundle(options),
    });
    if (id === 'webmcp') return Object.freeze({
      documentation,
      fetchTools: () => tab.webmcp.fetchTools(),
      invokeTool: (name, args) => tab.webmcp.invokeTool(name, args),
    });
    throw new SdkError('CAPABILITY_NOT_ALLOWED', 'Unknown tab capability: ' + id);
  }
  function makeTab(info, primary) {
    const tab = {};
    Object.defineProperties(tab, {
      __primary: { value: primary === true },
      _call: { value: (method, args = []) => callForTab(tab, method, args) },
    });
    if (info.browserId) tab.browserId = info.browserId;
    if (info.tabId !== undefined) {
      tab.tabId = String(info.tabId);
      tab.id = String(info.tabId);
    }
    if (info.generation !== undefined) tab.generation = info.generation;
    tab.cdp = {
      send: async (method, params, options) => {
        if (!isNonEmptyString(method)) invalidArgument('cdp.send', 'method must be a non-empty string');
        if (params !== undefined && (params === null || typeof params !== 'object' || Array.isArray(params)))
          invalidArgument('cdp.send', 'params must be an object');
        if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options)))
          invalidArgument('cdp.send', 'options must be an object');
        const args = [method, params ?? {}];
        if (options !== undefined) args.push(options);
        return tab._call('cdp.send', args);
      },
      events: async cursor => {
        if (cursor !== undefined && typeof cursor !== 'string')
          invalidArgument('cdp.events', 'cursor must be a string');
        return tab._call('cdp.events', cursor === undefined ? [] : [cursor]);
      },
      cursor: async () => tab._call('cdp.cursor', []),
      readEvents: async options => {
        if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options)))
          invalidArgument('cdp.readEvents', 'options must be an object');
        return tab._call('cdp.readEvents', [options ?? {}]);
      },
    };
    tab.title = async () => tab._call('tab.title', []);
    async function evaluate(expression, args, options) {
      if (!isNonEmptyString(expression))
        invalidArgument('tab.evaluate', 'expression must be a non-empty string');
      if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options)))
        invalidArgument('tab.evaluate', 'options must be an object');
      const timeoutMs = options && options.timeoutMs;
      if (timeoutMs !== undefined &&
          (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000))
        invalidArgument('tab.evaluate', 'timeoutMs must be 1..30000');
      let serialized;
      try {
        serialized = args === undefined ? undefined : JSON.stringify(args);
      } catch {
        invalidArgument('tab.evaluate', 'args must be JSON serializable');
      }
      if (args !== undefined && serialized === undefined)
        invalidArgument('tab.evaluate', 'args must be JSON serializable');
      const wrapped = serialized === undefined
        ? '(' + expression + ')'
        : '(() => { const args = ' + serialized + '; return (' + expression + '); })()';
      const response = await tab.cdp.send('Runtime.evaluate', {
        expression: wrapped,
        returnByValue: true,
        awaitPromise: true,
        ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
      });
      if (!response || response.exceptionDetails || !response.result ||
          !Object.prototype.hasOwnProperty.call(response.result, 'value'))
        throw new SdkError('PAGE_NOT_ACCESSIBLE', 'page evaluation failed');
      return response.result.value;
    }
    tab.evaluate = evaluate;
    tab.url = async () => {
      const url = await evaluate('location.href');
      if (typeof url !== 'string') throw new SdkError('PAGE_NOT_ACCESSIBLE', 'invalid page URL');
      return url;
    };
    tab.back = async () => tab.goBack();
    tab.goto = async (url, options) => tab.navigate(url, options);
    tab.close = async () => tab._call('tabs.close', [tab.tabId]);
    tab.markDeliverable = async () => tab._call('tab.markDeliverable', []);
    tab.markHandoff = async () => tab._call('tab.markHandoff', []);
    tab.requestUserTakeover = async (reason = 'user_requested') => {
      if (!['authentication', 'captcha', 'user_requested', 'other'].includes(reason))
        invalidArgument('tab.requestUserTakeover', 'invalid reason');
      return tab._call('tab.requestUserTakeover', [reason]);
    };
    tab.requestManualHandoff = async () => tab.requestUserTakeover('user_requested');
    tab.clipboard = Object.freeze({
      read: async () => tab._call('tab.clipboard.read', []),
      readText: async () => tab._call('tab.clipboard.readText', []),
      write: async items => tab._call('tab.clipboard.write', [items]),
      writeText: async text => {
        if (typeof text !== 'string') invalidArgument('tab.clipboard.writeText', 'text must be a string');
        return tab._call('tab.clipboard.writeText', [text]);
      },
    });
    tab.clipboardReadText = async () => tab.clipboard.readText();
    tab.clipboardWriteText = async text => tab.clipboard.writeText(text);
    tab.content = Object.freeze({
      export: async () => {
        const file = await tab._call('tab.content.export', []);
        if (!file || typeof file.path !== 'string')
          throw new SdkError('BRIDGE_REJECTED', 'export did not return a path');
        return file.path;
      },
      exportGsuite: async type => {
        if (!['pdf','md','xlsx','csv','docx','pptx'].includes(type))
          invalidArgument('tab.content.exportGsuite', 'invalid export format');
        const file = await tab._call('tab.content.exportGsuite', [type]);
        if (!file || typeof file.path !== 'string')
          throw new SdkError('BRIDGE_REJECTED', 'export did not return a path');
        return file.path;
      },
      exportYouTubeTranscript: async () => {
        const file = await tab._call('tab.content.exportYouTubeTranscript', []);
        if (!file || typeof file.path !== 'string')
          throw new SdkError('BRIDGE_REJECTED', 'export did not return a path');
        return file.path;
      },
    });
    tab.contentExport = async options => {
      if (!options || typeof options !== 'object' || Array.isArray(options) ||
          !['html', 'markdown', 'text'].includes(options.format))
        invalidArgument('tab.contentExport', 'format must be html, markdown or text');
      const expression = options.format === 'html'
        ? 'document.documentElement ? document.documentElement.outerHTML : ""'
        : options.format === 'text'
          ? 'document.body ? document.body.innerText : ""'
          : '(() => { const root=document.querySelector("main,article,[role=main]")||document.body; const lines=[]; const walk=e=>{if(!e||!e.children)return;for(const n of e.children){const t=n.tagName.toLowerCase();const value=(n.innerText||n.textContent||"").trim();if(!value)continue;if(/^h[1-6]$/.test(t))lines.push("#".repeat(Number(t[1]))+" "+value.split("\\n")[0],"");else if(t==="p")lines.push(value,"");else if(t==="li")lines.push("- "+value.split("\\n")[0]);else if(t==="blockquote")lines.push(...value.split("\\n").map(x=>"> "+x),"");else if(t==="a"&&n.href)lines.push("["+value+"]("+n.href+")");else if(t==="pre"||t==="code"){const fence=String.fromCharCode(96).repeat(3);lines.push(fence+"\\n"+value+"\\n"+fence,"");}walk(n);}};walk(root);return "# "+document.title+"\\n\\n"+location.href+"\\n\\n"+(lines.length?lines.join("\\n"):root?.innerText||"");})()';
      const data = await tab.evaluate(expression);
      if (typeof data !== 'string')
        throw new SdkError('PAGE_NOT_ACCESSIBLE', 'page content is not text');
      const maximum = 30000;
      return { data: data.slice(0, maximum), truncated: data.length > maximum };
    };
    tab.exportFile = async options => tab._call('tab.exportFile', [options]);
    tab.exportGsuite = async type => tab.content.exportGsuite(type);
    tab.exportYouTubeTranscript = async () => tab.content.exportYouTubeTranscript();
    tab.downloads = async () => tab._call('tab.downloads', []);
    tab.saveDownload = async (downloadId, path) => {
      const id = typeof downloadId === 'string' && /^\d+$/u.test(downloadId)
        ? Number(downloadId) : downloadId;
      if (!Number.isSafeInteger(id) || id < 0)
        invalidArgument('tab.saveDownload', 'downloadId must be a non-negative integer or numeric string');
      return tab._call('tab.saveDownload', [id, path ?? null]);
    };
    tab.setFiles = async (ref, files, options) => {
      if ((!isNonEmptyString(ref) && (!ref || typeof ref !== 'object')) ||
          !Array.isArray(files) || files.length < 1 || files.length > 8)
        invalidArgument('tab.setFiles', 'expected an element ref and 1..8 files');
      await tab._call('tab.setFiles', [ref, files, options ?? {}]);
      const page = await tab.snapshot();
      return {
        ok: true,
        tabId: tab.tabId,
        generation: tab.generation,
        pageVersion: page.pageVersion,
        changed: true,
      };
    };
    tab.downloadMedia = async (url, options) => {
      if (!isNonEmptyString(url) || !/^https?:\/\//u.test(url))
        invalidArgument('tab.downloadMedia', 'url must be HTTP(S)');
      return tab._call('tab.downloadMedia', [url, options ?? {}]);
    };
    tab.waitForDownload = async options => {
      const download = await tab._call('tab.waitForDownload', [options ?? {}]);
      if (!download || typeof download.downloadId !== 'string')
        throw new SdkError('BRIDGE_REJECTED', 'download response is invalid');
      return Object.freeze({
        ...download,
        path: async () => {
          const saved = await tab.saveDownload(download.downloadId);
          return saved && typeof saved.path === 'string' ? saved.path : null;
        },
      });
    };
    tab.resetViewport = async () => {
      await tab.cdp.send('Emulation.clearDeviceMetricsOverride', {});
      return { ok: true, tabId: tab.tabId, generation: tab.generation, pageVersion: 0, changed: true };
    };
    tab.assets = Object.freeze({
      list: async () => tab._call('tab.assets.list', []),
      download: async urls => {
        if (!Array.isArray(urls) || urls.length < 1 || urls.length > 20 ||
            urls.some(url => typeof url !== 'string' || !/^https?:\/\//u.test(url)))
          invalidArgument('tab.assets.download', 'urls must contain 1..20 HTTP(S) URLs');
        return tab._call('tab.assets.bundle', [urls]);
      },
      bundle: async options => tab._call('tab.assets.bundle', [options ?? {}]),
    });
    tab.webmcp = Object.freeze({
      listTools: async () => tab._call('tab.webmcp.fetchTools', []),
      fetchTools: async () => tab._call('tab.webmcp.fetchTools', []),
      invokeTool: async (name, args) => tab._call('tab.webmcp.invokeTool', [name, args ?? {}]),
    });
    tab.devLogs = async options => tab._call('tab.dev.logs', [options ?? {}]);
    tab.dev = Object.freeze({ logs: options => tab.devLogs(options) });
    tab.capabilities = Object.freeze({
      list: async () => TAB_CAPABILITIES,
      get: async id => {
        if (!isNonEmptyString(id)) invalidArgument('tab.capabilities.get', 'id must be a non-empty string');
        return makeTabCapability(id, tab);
      },
    });
    return tab;
  }
  function installTabApis(tab) {
    if (tab.__apisInstalled) return tab;
    const installers = [
      globalThis.__avruInstallPageApi,
      globalThis.__avruInstallCuaApi,
      globalThis.__avruInstallDomApi,
      globalThis.__avruInstallAxApi,
      globalThis.__avruInstallObservabilityApi,
      globalThis.__avruInstallScreenshotApi,
      globalThis.__avruInstallPlaywrightExtras,
    ];
    for (const install of installers) {
      if (typeof install !== 'function')
        throw new SdkError('BRIDGE_REJECTED', 'browser SDK module is not installed');
      install(tab);
    }
    tab.dom_cua = tab.dom;
    Object.defineProperty(tab, '__apisInstalled', { value: true });
    for (const key of ['cdp', 'cua', 'dom', 'dom_cua', 'ax', 'playwright', 'clipboard', 'content', 'assets', 'webmcp', 'dev', 'capabilities'])
      if (tab[key] && typeof tab[key] === 'object') Object.freeze(tab[key]);
    return Object.freeze(tab);
  }
  function createTabFacade(info, primary = false) {
    if (!info || typeof info !== 'object' || Array.isArray(info))
      throw new SdkError('INVALID_TARGET', 'browser tab metadata is invalid');
    const rawId = info.tabId === undefined ? info.id : info.tabId;
    const normalized = {
      ...info,
      tabId: String(rawId),
      browserId: info.browserId || primaryTab.browserId,
      generation: info.generation === undefined
        ? primaryTab.generation
        : info.generation,
    };
    validateTabInfo(normalized, 'browser.tabs.get');
    return installTabApis(makeTab(normalized, primary));
  }
  Object.defineProperty(globalThis, '__avruInstallTabApis', { value: installTabApis });
  const primaryTab = makeTab({}, true);
  const browser = globalThis.__avruCreateBrowserApi({
    call, primaryTab, managementNamespace, invalidArgument,
    isNonEmptyString, parseUserTab, createTabFacade, SdkError,
  });
  Object.defineProperty(globalThis, '__avruCreateTabFacade', { value: createTabFacade });
  Object.defineProperty(globalThis, 'browser', { value: browser, writable: false, configurable: false });
})();`;

function setString(
  vm: QuickJSContext,
  target: QuickJSHandle,
  key: string,
  value: string,
): void {
  const handle = vm.newString(value);
  vm.setProp(target, key, handle);
  handle.dispose();
}

function setNumber(
  vm: QuickJSContext,
  target: QuickJSHandle,
  key: string,
  value: number,
): void {
  const handle = vm.newNumber(value);
  vm.setProp(target, key, handle);
  handle.dispose();
}

function installApi(vm: QuickJSContext, source: string, stage: string): void {
  const result = vm.evalCode(source);
  if (result.error) {
    result.error.dispose();
    throw new Error(`sdk ${stage} install failed`);
  }
  result.value.dispose();
}

/** Install the `browser` global (and `SdkError`) into a fresh context. */
export function installSdk(vm: QuickJSContext, target?: SdkTarget): void {
  const evaluated = vm.evalCode(BROWSER_API_SOURCE + '\n' + SDK_SOURCE);
  if (evaluated.error) {
    evaluated.error.dispose();
    throw new Error('sdk install failed');
  }
  evaluated.value.dispose();
  const browserHandle = vm.getProp(vm.global, 'browser');
  try {
    if (target !== undefined)
      setString(vm, browserHandle, 'browserId', target.browserId);
    const tabHandle = vm.getProp(browserHandle, 'tab');
    try {
      if (target !== undefined) {
        setString(vm, tabHandle, 'browserId', target.browserId);
        setString(vm, tabHandle, 'tabId', target.tabId);
        setString(vm, tabHandle, 'id', target.tabId);
        setNumber(vm, tabHandle, 'generation', target.generation);
      }
    } finally {
      tabHandle.dispose();
    }
  } finally {
    browserHandle.dispose();
  }
  installApi(vm, PAGE_LOCATORS_SOURCE + '\n' + PAGE_API_SOURCE, 'page API');
  installApi(vm, CUA_API_SOURCE, 'cua API');
  installApi(vm, DOM_API_SOURCE, 'DOM CUA');
  installApi(vm, AX_API_SOURCE, 'AX API');
  installApi(vm, OBSERVABILITY_API_SOURCE, 'observability API');
  installApi(vm, SCREENSHOT_API_SOURCE, 'screenshot API');
  installApi(vm, PLAYWRIGHT_EXTRAS_SOURCE, 'Playwright extras');
  const installed = vm.evalCode(
    'globalThis.__avruInstallTabApis(globalThis.browser.tab);',
  );
  if (installed.error) {
    installed.error.dispose();
    throw new Error('sdk tab API install failed');
  }
  installed.value.dispose();
  const frozen = vm.evalCode(
    'Object.freeze(globalThis.browser.tabs);' +
      'Object.freeze(globalThis.browser.windows);' +
      'Object.freeze(globalThis.browser.capabilities);' +
      'Object.freeze(globalThis.browser.user);' +
      'Object.freeze(globalThis.browser);',
  );
  if (frozen.error) {
    frozen.error.dispose();
    throw new Error('sdk install failed');
  }
  frozen.value.dispose();
}
