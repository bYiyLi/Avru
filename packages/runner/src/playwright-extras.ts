/** Playwright-like convenience methods on top of the Avru-native page/CDP SDK. */
export const PLAYWRIGHT_EXTRAS_SOURCE = String.raw`(() => {
  function installPlaywrightExtras(tab) {
  const base = tab.playwright;
  function invalid(method, reason) {
    throw new SdkError('INVALID_ARGUMENT', method + ': ' + reason);
  }
  function options(method, value) {
    if (value === undefined) return {};
    if (!value || typeof value !== 'object' || Array.isArray(value))
      invalid(method, 'options must be an object');
    if (value.timeoutMs !== undefined &&
        (!Number.isSafeInteger(value.timeoutMs) ||
         value.timeoutMs < 1 || value.timeoutMs > 30000))
      invalid(method, 'timeoutMs must be 1..30000');
    return value;
  }
  function text(method, value) {
    if (typeof value !== 'string' || value.length > 32768)
      invalid(method, 'expected up to 32768 text characters');
    return value;
  }
  function combo(value) {
    text('locator.press', value);
    if (!value) invalid('locator.press', 'key cannot be empty');
    const raw = value.split('+');
    const keys = raw.map(key => {
      const aliases = {
        Ctrl: 'Control', Control: 'Control',
        Command: 'Meta', Cmd: 'Meta', Meta: 'Meta',
        Option: 'Alt', Alt: 'Alt',
        Shift: 'Shift', Return: 'Enter',
        Esc: 'Escape', Space: 'Space'
      };
      return aliases[key] || key;
    });
    if (keys.length > 4 || keys.some(key => !key || key.length > 32))
      invalid('locator.press', 'invalid key combination');
    return keys;
  }
  function actionResult(changed) {
    return { ok: true, tabId: tab.tabId, generation: tab.generation,
      pageVersion: 0, changed };
  }
  function enhance(native) {
    const next = {
      ...native,
      first: () => enhance(native.first()),
      last: () => enhance(native.last()),
      nth: index => enhance(native.nth(index)),
      locator: (selector, locatorOptions) => enhance(native.locator(selector, locatorOptions)),
      filter: filterOptions => enhance(native.filter(filterOptions)),
      and: other => enhance(native.and(other)),
      or: other => enhance(native.or(other)),
      getByRole: (role, opts) => enhance(native.getByRole(role, opts)),
      getByLabel: (value, opts) => enhance(native.getByLabel(value, opts)),
      getByPlaceholder: (value, opts) => enhance(native.getByPlaceholder(value, opts)),
      getByTestId: value => enhance(native.getByTestId(value)),
      getByText: (value, opts) => enhance(native.getByText(value, opts)),
      click: async clickOptions => native.click(options('locator.click', clickOptions)),
      dblclick: async clickOptions => {
        const opts = options('locator.dblclick', clickOptions);
        return native.click({ ...opts, clickCount: 2 });
      },
      fill: async (value, fillOptions) => {
        options('locator.fill', fillOptions);
        return native.fill(text('locator.fill', value), fillOptions);
      },
      press: async (value, pressOptions) => {
        const opts = options('locator.press', pressOptions);
        const modifiers = opts.modifiers === undefined ? [] : opts.modifiers;
        if (!Array.isArray(modifiers) || modifiers.some(key => !['Shift','Control','Alt','Meta'].includes(key)))
          invalid('locator.press', 'invalid modifiers');
        const keys = modifiers.concat(combo(value));
        await native.focus({ timeoutMs: opts.timeoutMs });
        return tab.cua.keypress({ keys });
      },
      type: async (value, typingOptions) => {
        const opts = options('locator.type', typingOptions);
        const typed = text('locator.type', value);
        const delayMs = opts.delayMs === undefined ? 0 : opts.delayMs;
        if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 1000)
          invalid('locator.type', 'delayMs must be 0..1000');
        await native.focus({ timeoutMs: opts.timeoutMs });
        if (delayMs === 0) return tab.cua.type({ text: typed });
        if (typed.length > 30)
          invalid('locator.type', 'delayed typing is limited to 30 characters per task');
        let result = actionResult(false);
        for (const char of typed) {
          result = await tab.cua.type({ text: char });
          if (delayMs > 0)
            await tab.evaluate('(async()=>{await new Promise(r=>setTimeout(r,args.ms));return true;})()', { ms: delayMs });
        }
        return result;
      },
      pressSequentially: async (value, typingOptions) => {
        const opts = options('locator.pressSequentially', typingOptions);
        const typed = text('locator.pressSequentially', value);
        const delayMs = opts.delayMs === undefined ? 0 : opts.delayMs;
        if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 1000)
          invalid('locator.pressSequentially', 'delayMs must be 0..1000');
        if (delayMs > 0 && typed.length > 30)
          invalid('locator.pressSequentially', 'delayed typing is limited to 30 characters per task');
        await native.focus({ timeoutMs: opts.timeoutMs });
        if (delayMs === 0) return tab.cua.type({ text: typed });
        let result = actionResult(false);
        for (const char of typed) {
          result = await tab.cua.type({ text: char });
          if (delayMs > 0)
            await tab.evaluate('(async()=>{await new Promise(r=>setTimeout(r,args.ms));return true;})()', { ms: delayMs });
        }
        return result;
      },
      check: async checkOptions => {
        const opts = options('locator.check', checkOptions);
        const valid = await native.__evaluate('element.matches("input[type=checkbox],input[type=radio],[role=checkbox],[role=switch]")', undefined, opts.timeoutMs);
        if (!valid) throw new SdkError('ELEMENT_NOT_INTERACTABLE', 'locator is not checkable');
        const checked = await native.__evaluate('!!element.checked || element.getAttribute("aria-checked")==="true"', undefined, opts.timeoutMs);
        return checked ? actionResult(false) : native.click(opts);
      },
      uncheck: async checkOptions => {
        const opts = options('locator.uncheck', checkOptions);
        const valid = await native.__evaluate('element.matches("input[type=checkbox],input[type=radio],[role=checkbox],[role=switch]")');
        if (!valid) throw new SdkError('ELEMENT_NOT_INTERACTABLE', 'locator is not checkable');
        const checked = await native.__evaluate('!!element.checked || element.getAttribute("aria-checked")==="true"');
        return checked ? native.click(opts) : actionResult(false);
      },
      setChecked: async (checked, checkOptions) => {
        if (typeof checked !== 'boolean') invalid('locator.setChecked', 'checked must be boolean');
        const opts = options('locator.setChecked', checkOptions);
        const valid = await native.__evaluate('element.matches("input[type=checkbox],input[type=radio],[role=checkbox],[role=switch]")');
        if (!valid) throw new SdkError('ELEMENT_NOT_INTERACTABLE', 'locator is not checkable');
        const current = await native.__evaluate('!!element.checked || element.getAttribute("aria-checked")==="true"');
        return current === checked ? actionResult(false) : native.click(opts);
      },
      selectOption: async (values, selectOptions) => {
        options('locator.selectOption', selectOptions);
        return native.selectOption(values, selectOptions);
      },
      downloadMedia: async downloadOptions => {
        const opts = downloadOptions === undefined ? {} : downloadOptions;
        if (!opts || typeof opts !== 'object' || Array.isArray(opts))
          invalid('locator.downloadMedia', 'options must be an object');
        const timeoutMs = opts.timeoutMs === undefined ? 120000 : opts.timeoutMs;
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000)
          invalid('locator.downloadMedia', 'timeoutMs must be 1..300000');
        const url = await native.__evaluate('element.currentSrc||element.src||element.href||element.poster||null', undefined, timeoutMs);
        if (typeof url !== 'string' || !url)
          throw new SdkError('ELEMENT_NOT_FOUND', 'element has no downloadable media URL');
        const result = await tab.downloadMedia(url, { timeoutMs });
        if (!result || typeof result.path !== 'string')
          throw new SdkError('BRIDGE_REJECTED', 'download did not return a local path');
        return { path: result.path };
      },
      evaluate: async (expression, arg, evaluateOptions) => {
        const opts = options('locator.evaluate', evaluateOptions);
        if (typeof expression !== 'string' || !expression)
          invalid('locator.evaluate', 'expression must be a non-empty string');
        return native.__evaluate(expression, { arg }, opts.timeoutMs);
      },
      evaluateAll: async (expression, arg, evaluateOptions) => {
        const opts = options('locator.evaluateAll', evaluateOptions);
        if (typeof expression !== 'string' || !expression)
          invalid('locator.evaluateAll', 'expression must be a non-empty string');
        return native.__evaluateAll(expression, arg, opts.timeoutMs);
      },
      waitFor: async waitOptions => {
        if (!waitOptions || typeof waitOptions !== 'object' || Array.isArray(waitOptions))
          invalid('locator.waitFor', 'options must be an object');
        const state = waitOptions.state;
        const timeoutMs = waitOptions.timeoutMs === undefined ? 30000 : waitOptions.timeoutMs;
        if (!['attached','detached','visible','hidden'].includes(state) ||
            !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000)
          invalid('locator.waitFor', 'invalid state or timeoutMs');
        const matched = await native.__waitFor(state, timeoutMs, 100);
        if (!matched) throw new SdkError('TIMEOUT', 'locator did not reach the requested state');
      },
      all: async () => {
        const count = await native.count();
        if (!Number.isSafeInteger(count) || count < 0 || count > 24)
          throw new SdkError('OUTPUT_TOO_LARGE', 'all() is bounded to 24 elements');
        return Array.from({ length: count }, (_, i) => enhance(native.nth(i)));
      },
      allTextContents: async textOptions => {
        const opts = options('locator.allTextContents', textOptions);
        const count = await native.count();
        if (!Number.isSafeInteger(count) || count < 0 || count > 24)
          throw new SdkError('OUTPUT_TOO_LARGE', 'allTextContents is bounded to 24 elements');
        const values = [];
        for (let i = 0; i < count; i++)
          values.push((await native.nth(i).textContent({ timeoutMs: opts.timeoutMs })) || '');
        return values;
      },
    };
    Object.defineProperty(next, '__query', { value: native.__query });
    return Object.freeze(next);
  }
  function escaped(value) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      .replace(/\n/g, '\\a ').replace(/\r/g, '\\d ');
  }
  function byPlaceholder(value, config) {
    text('getByPlaceholder', value);
    if (!value) invalid('getByPlaceholder', 'placeholder cannot be empty');
    return enhance(base.getByPlaceholder(value, options('getByPlaceholder', config)));
  }
  function byText(value, config) {
    text('getByText', value);
    if (!value) invalid('getByText', 'text cannot be empty');
    return enhance(base.getByText(value, options('getByText', config)));
  }
  function byLabel(value, config) {
    text('getByLabel', value);
    if (!value) invalid('getByLabel', 'label cannot be empty');
    return enhance(base.getByLabel(value, options('getByLabel', config)));
  }
  function enhanceFrameLocator(frame) {
    return Object.freeze({
      frameLocator: selector => enhanceFrameLocator(frame.frameLocator(selector)),
      locator: selector => enhance(frame.locator(selector)),
      getByRole: (role, opts) => enhance(frame.getByRole(role, opts)),
      getByLabel: (value, opts) => enhance(frame.getByLabel(value, opts)),
      getByPlaceholder: (value, opts) => enhance(frame.getByPlaceholder(value, opts)),
      getByTestId: value => enhance(frame.getByTestId(value)),
      getByText: (value, opts) => enhance(frame.getByText(value, opts)),
    });
  }
  async function waitForURL(url, waitOptions) {
    text('playwright.waitForURL', url);
    const opts = options('playwright.waitForURL', waitOptions);
    const timeoutMs = opts.timeoutMs === undefined ? 30000 : opts.timeoutMs;
    if (timeoutMs < 1) invalid('playwright.waitForURL', 'timeoutMs must be positive');
    const result = await tab.waitFor({ kind: 'url', value: url, timeoutMs });
    if (!result.matched) throw new SdkError('TIMEOUT', 'URL did not match before timeout');
    if (opts.waitUntil && opts.waitUntil !== 'commit')
      await waitForLoadState({ state: opts.waitUntil, timeoutMs });
  }
  async function waitForLoadState(loadOptions) {
    const opts = options('playwright.waitForLoadState', loadOptions);
    const state = opts.state === undefined ? 'load' : opts.state;
    const timeoutMs = opts.timeoutMs === undefined ? 30000 : opts.timeoutMs;
    if (!['load','domcontentloaded','networkidle'].includes(state) ||
        !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
      invalid('playwright.waitForLoadState', 'invalid state or timeoutMs');
    if (state !== 'networkidle') {
      const readyState = state === 'load' ? 'complete' : 'interactive';
      const matched = await tab.evaluate('(async()=>{const end=Date.now()+args.timeoutMs;while(Date.now()<=end){if(document.readyState===args.readyState||(args.readyState==="interactive"&&document.readyState==="complete"))return true;await new Promise(r=>setTimeout(r,50));}return false;})()', { readyState, timeoutMs }, { timeoutMs });
      if (!matched) throw new SdkError('TIMEOUT', 'page did not reach the requested load state');
      return;
    }
    const cursor = await tab.cdp.cursor();
    await tab.cdp.send('Network.enable', {});
    const ready = await tab.evaluate('(async()=>{const end=Date.now()+args.timeoutMs;while(Date.now()<=end){if(document.readyState==="complete")return true;await new Promise(r=>setTimeout(r,100));}return false;})()', { timeoutMs }, { timeoutMs });
    if (!ready) throw new SdkError('TIMEOUT', 'page did not finish loading before network idle');
    let nextCursor = cursor;
    const pending = new Set();
    let idleSince = Date.now();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const batch = await tab.cdp.events(nextCursor);
      nextCursor = batch.nextCursor;
      let activity = false;
      for (const event of batch.events || []) {
        const params = event.params || {};
        if (event.method === 'Network.requestWillBeSent' && params.requestId &&
            !['WebSocket','EventSource'].includes(params.type)) { pending.add(params.requestId); activity = true; }
        if (event.method === 'Network.loadingFinished' || event.method === 'Network.loadingFailed') {
          pending.delete(params.requestId); activity = true;
        }
      }
      if (activity) idleSince = Date.now();
      if (pending.size === 0 && Date.now() - idleSince >= 500) return;
      await tab.evaluate('(async()=>{await new Promise(r=>setTimeout(r,args.ms));return true;})()', { ms: 2200 });
    }
    throw new SdkError('TIMEOUT', 'network did not become idle before timeout');
  }
  async function expectNavigation(action, navigationOptions) {
    if (typeof action !== 'function') invalid('playwright.expectNavigation', 'action must be a function');
    const opts = options('playwright.expectNavigation', navigationOptions);
    const timeoutMs = opts.timeoutMs === undefined ? 30000 : opts.timeoutMs;
    if (timeoutMs < 1) invalid('playwright.expectNavigation', 'timeoutMs must be positive');
    await tab.cdp.send('Page.enable', {});
    const cursor = await tab.cdp.cursor();
    const before = await tab.url();
    const result = await action();
    const waited = await tab.waitFor({ kind: 'navigation', value: before, timeoutMs, cursor });
    if (!waited.matched) throw new SdkError('TIMEOUT', 'navigation did not occur before timeout');
    if (opts.url !== undefined) {
      const currentUrl = await tab.url();
      if (!currentUrl.includes(opts.url))
        throw new SdkError('TIMEOUT', 'navigation reached a different URL');
    }
    if (opts.waitUntil && opts.waitUntil !== 'commit')
      await waitForLoadState({ state: opts.waitUntil, timeoutMs });
    return result;
  }
  async function waitForEvent(event, eventOptions) {
    const opts = options('playwright.waitForEvent', eventOptions);
    const timeoutMs = opts.timeoutMs === undefined ? 30000 : opts.timeoutMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000)
      invalid('playwright.waitForEvent', 'timeoutMs must be 1..300000');
    if (event === 'download') return tab.waitForDownload({ timeoutMs });
    if (event !== 'filechooser') invalid('playwright.waitForEvent', 'event must be download or filechooser');
    await tab.cdp.send('Page.enable', {});
    const cursor = await tab.cdp.cursor();
    await tab.cdp.send('Page.setInterceptFileChooserDialog', { enabled: true });
    const deadline = Date.now() + timeoutMs;
    let nextCursor = cursor;
    try {
      while (Date.now() <= deadline) {
        const batch = await tab.cdp.events(nextCursor);
        nextCursor = batch.nextCursor;
        const opened = (batch.events || []).find(item => item.method === 'Page.fileChooserOpened');
        if (opened) {
          const params = opened.params || {};
          const backendNodeId = params.backendNodeId;
          if (!Number.isSafeInteger(backendNodeId))
            throw new SdkError('PAGE_NOT_ACCESSIBLE', 'file chooser has no DOM node');
          const multiple = params.mode === 'selectMultiple';
          return Object.freeze({
            isMultiple: () => multiple,
            setFiles: async (files, fileOptions) => {
              const fileOpts = options('filechooser.setFiles', fileOptions);
              const values = Array.isArray(files) ? files : [files];
              if (!values.length || values.length > 8 || values.some(file =>
                !file || typeof file !== 'object' || Array.isArray(file) ||
                typeof file.name !== 'string' || typeof file.data !== 'string' ||
                (file.mimeType !== undefined && typeof file.mimeType !== 'string')))
                invalid('filechooser.setFiles', 'files must contain 1..8 base64 file objects');
              if (!multiple && values.length > 1)
                invalid('filechooser.setFiles', 'this file chooser accepts one file');
              return tab.setFiles({ backendNodeId }, values, { timeoutMs: fileOpts.timeoutMs || timeoutMs });
            },
          });
        }
        await tab.evaluate('(async()=>{await new Promise(r=>setTimeout(r,args.ms));return true;})()', { ms: 2200 });
      }
      throw new SdkError('TIMEOUT', 'file chooser did not open before timeout');
    } finally {
      await tab.cdp.send('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
    }
  }
  async function elementInfo(infoOptions) {
    if (!infoOptions || typeof infoOptions !== 'object' || Array.isArray(infoOptions) ||
        typeof infoOptions.x !== 'number' || !Number.isFinite(infoOptions.x) ||
        typeof infoOptions.y !== 'number' || !Number.isFinite(infoOptions.y) ||
        (infoOptions.includeNonInteractable !== undefined && typeof infoOptions.includeNonInteractable !== 'boolean'))
      invalid('playwright.elementInfo', 'x and y must be finite coordinates');
    await tab.cdp.send('DOM.enable', {});
    const hit = await tab.cdp.send('DOM.getNodeForLocation', {
      x: infoOptions.x, y: infoOptions.y,
      includeUserAgentShadowDOM: true, ignorePointerEventsNone: false,
    });
    if (!hit || !Number.isSafeInteger(hit.backendNodeId)) return [];
    const resolved = await tab.cdp.send('DOM.resolveNode', { backendNodeId: hit.backendNodeId });
    const objectId = resolved && resolved.object && resolved.object.objectId;
    if (typeof objectId !== 'string') return [];
    try {
      const response = await tab.cdp.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: 'function(includeAll){const e=this;if(!e||e.nodeType!==1)return null;const tag=e.tagName.toLowerCase();const interactive=e.matches("a[href],button,input,textarea,select,[role],[contenteditable=true]");if(!includeAll&&!interactive)return null;const r=e.getBoundingClientRect();const text=(e.innerText||e.textContent||"").trim().replace(/\s+/g," ").slice(0,160);const id=e.id||"";const testId=e.getAttribute("data-testid");const classes=Array.from(e.classList||[]).slice(0,3);const primary=id?"#"+CSS.escape(id):testId?"[data-testid=\""+CSS.escape(testId)+"\"]":tag+(classes.length?"."+classes.map(x=>CSS.escape(x)).join("."):"");const candidates=[primary,tag];if(testId)candidates.push("[data-testid=\""+CSS.escape(testId)+"\"]");return {tagName:tag,preview:tag+(id?"#"+id:"")+(text?" "+text:""),ariaName:e.getAttribute("aria-label")||Array.from(e.labels||[]).map(x=>x.innerText||x.textContent||"").join(" ")||e.getAttribute("title")||text||null,visibleText:text||null,role:e.getAttribute("role")||null,testId:testId||null,selector:{primary,candidates},boundingBox:{x:r.x,y:r.y,width:r.width,height:r.height}};}',
        arguments: [{ value: infoOptions.includeNonInteractable === true }],
        returnByValue: true,
      });
      const value = response && response.result && response.result.value;
      if (!value || typeof value !== 'object') return [];
      return [{ ...value, nodeId: hit.backendNodeId }];
    } finally {
      await tab.cdp.send('Runtime.releaseObject', { objectId }).catch(() => {});
    }
  }
  async function elementScreenshot(screenshotOptions) {
    const info = await elementInfo(screenshotOptions);
    if (!info.length || !info[0].boundingBox)
      throw new SdkError('ELEMENT_NOT_FOUND', 'no element at the requested point');
    const box = info[0].boundingBox;
    const marker = '__avru_element_screenshot_overlay';
    await tab.evaluate('(()=>{document.getElementById(args.marker)?.remove();const layer=document.createElement("div");layer.id=args.marker;layer.style.cssText="position:fixed;inset:0;z-index:2147483647;pointer-events:none";const rect=document.createElement("div");rect.style.cssText="position:fixed;box-sizing:border-box;border:3px solid #ff3b30;background:rgba(255,59,48,.08);left:"+args.x+"px;top:"+args.y+"px;width:"+args.width+"px;height:"+args.height+"px";const dot=document.createElement("div");dot.style.cssText="position:fixed;width:12px;height:12px;border-radius:50%;background:#ff3b30;border:2px solid white;left:"+(args.pointX-6)+"px;top:"+(args.pointY-6)+"px";layer.append(rect,dot);document.documentElement.appendChild(layer);return true;})()', {
      marker, x: box.x, y: box.y, width: box.width, height: box.height,
      pointX: screenshotOptions.x, pointY: screenshotOptions.y,
    });
    try { return await tab.screenshot(); }
    finally { await tab.evaluate('document.getElementById(args.marker)?.remove();return true;', { marker }).catch(() => {}); }
  }
  tab.locator = selector => enhance(base.locator(selector));
  tab.playwright = Object.freeze({
    ...base,
    locator: tab.locator,
    getByRole: (role, opts) => enhance(base.getByRole(role, opts)),
    getByLabel: byLabel,
    getByTestId: id => enhance(base.getByTestId(id)),
    getByPlaceholder: byPlaceholder,
    getByText: byText,
    frameLocator: selector => enhanceFrameLocator(base.frameLocator(selector)),
    waitForURL,
    waitForLoadState,
    waitForTimeout: async timeoutMs => {
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 30000)
        invalid('playwright.waitForTimeout', 'timeoutMs must be 0..30000');
      await tab.evaluate('(async()=>{await new Promise(r=>setTimeout(r,args.ms));return true;})()', { ms: timeoutMs });
    },
    expectNavigation,
    waitForEvent,
    waitForDownload: options => waitForEvent('download', options),
    waitForFileChooser: options => waitForEvent('filechooser', options),
    elementInfo,
    elementScreenshot,
  });
  }
  Object.defineProperty(globalThis, '__avruInstallPlaywrightExtras', { value: installPlaywrightExtras });
})()`;
