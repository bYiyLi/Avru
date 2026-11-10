export const PAGE_API_SOURCE = String.raw`(() => {
  function installPageApi(tab) {
  const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Date.now().toString(36);
  function bad(method, detail) { throw new SdkError('INVALID_ARGUMENT', method + ': ' + detail); }
  function result(error) { if (error && error.error) throw new SdkError(error.error, error.error); return error; }
  function action(changed, pageVersion) {
    return { ok: true, tabId: tab.tabId, generation: tab.generation,
      pageVersion: pageVersion || 0, changed: !!changed };
  }
  async function snapshot(options) {
    if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options)))
      bad('tab.snapshot', 'options must be an object');
    if (options && options.frame !== undefined)
      return snapshotFrame(options.frame, options);
    const maxBytes = options && options.maxBytes !== undefined ? options.maxBytes : 12000;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 60000)
      bad('tab.snapshot', 'maxBytes must be 1024..60000');
    if (options && options.root !== undefined &&
        (typeof options.root !== 'string' || !options.root.startsWith('e:' + nonce + ':')))
      bad('tab.snapshot', 'root must be a current element reference');
    const data = await tab.evaluate("(() => {\n  const KEY = '__avru_sdk_refs_v1';\n  let state = globalThis[KEY];\n  if (!state || state.navigation !== performance.timeOrigin) {\n    state = { navigation: performance.timeOrigin, revision: 0, refs: new Map(), frameObservers: new WeakSet() };\n    Object.defineProperty(globalThis, KEY, { value: state, configurable: true });\n    if (document.documentElement) {\n      new MutationObserver(() => { state.revision += 1; }).observe(document.documentElement, {\n        subtree: true, childList: true, attributes: true, characterData: true\n      });\n    }\n  }\n  const pageVersion = Math.floor(state.navigation * 1000) + state.revision;\n  const prior = args.root ? state.refs.get(args.root) : null;\n  if (args.root && (!prior || prior.pageVersion !== pageVersion || !prior.element.isConnected))\n    return { error: 'STALE_REF' };\n  const rootElement = prior ? prior.element : null;\n  const rootDocument = rootElement ? rootElement.ownerDocument : document;\n  state.refs.clear();\n  const children = [];\n  const selector = 'a[href],button,input,textarea,select,[role],[contenteditable=\\\"true\\\"]';\n  const nodes = rootElement ? Array.from(rootElement.matches(selector) ? [rootElement, ...rootElement.querySelectorAll(selector)] : rootElement.querySelectorAll(selector)) : rootDocument.querySelectorAll(selector);\n  let count = 0;\n  for (const element of nodes) {\n    if (count >= 80) break;\n    const box = element.getBoundingClientRect();\n    if (!box.width || !box.height) continue;\n    const tag = element.tagName.toLowerCase();\n    const role = element.getAttribute('role') ||\n      (tag === 'a' ? 'link' : tag === 'select' ? 'combobox' :\n       tag === 'button' ? 'button' :\n       tag === 'input' ? (element.type === 'checkbox' ? 'checkbox' : 'textbox') :\n       tag === 'textarea' ? 'textbox' : tag);\n    const name = element.getAttribute('aria-label') || element.getAttribute('placeholder') ||\n      element.getAttribute('title') || (element.innerText || '').trim();\n    const ref = 'e:' + args.nonce + ':' + pageVersion + ':' + count;\n    state.refs.set(ref, { element, pageVersion });\n    const node = { ref, role, name: name.slice(0, 120) };\n    if ('disabled' in element) node.disabled = !!element.disabled;\n    if ('checked' in element) node.checked = !!element.checked;\n    if (tag === 'input' && element.type !== 'password' && element.type !== 'hidden') {\n      node.value = String(element.value || '').slice(0, 120);\n    }\n    children.push(node);\n    count += 1;\n  }\n  const text = rootElement ? (rootElement.innerText || rootElement.textContent || '') : (rootDocument.querySelector('body')?.innerText || '');\n  return {\n    url: rootDocument.location.href,\n    title: rootDocument.title,\n    pageVersion,\n    root: { ref: 'document', role: 'document', children },\n    text: text.slice(0, args.maxBytes),\n    truncated: text.length > args.maxBytes || (count >= 80 && nodes.length > count)\n  };\n})()", { nonce, root: options && options.root, maxBytes });
    if (data && data.error) throw new SdkError(data.error, 'snapshot root is no longer available');
    return { ...data, tabId: tab.tabId, generation: tab.generation };
  }
  async function elementPoint(ref, position, timeoutMs = 30000) {
    const point = await tab.evaluate(
      '(async () => { const state=globalThis.__avru_sdk_refs_v1;const version=state?Math.floor(state.navigation*1000)+state.revision:0;' +
      'const item=state&&state.refs.get(args.ref);if(!item||item.pageVersion!==version||!item.element.isConnected)return {error:"STALE_REF"};' +
      'const element=item.element;let lastError="ELEMENT_NOT_INTERACTABLE";const deadline=Date.now()+args.timeoutMs;' +
      'while(Date.now()<=deadline){if(!element.isConnected)return {error:"STALE_REF"};' +
      'let win=element.ownerDocument.defaultView;let blocked=false;' +
      'while(win&&win.frameElement){win.frameElement.scrollIntoView({block:"center",inline:"center"});win=win.parent;}' +
      'if(win&&win.parent!==win&&!win.frameElement)return {error:"CAPABILITY_NOT_ALLOWED"};' +
      'element.scrollIntoView({block:"center",inline:"center"});const box=element.getBoundingClientRect();' +
      'if(box.width>0&&box.height>0&&!element.disabled){const lx=box.left+(args.position?args.position.x:box.width/2);' +
      'const ly=box.top+(args.position?args.position.y:box.height/2);' +
      'if(lx<box.left||lx>box.right||ly<box.top||ly>box.bottom)return {error:"INVALID_ARGUMENT"};' +
      'const localHit=element.ownerDocument.elementFromPoint(lx,ly);' +
      'if(localHit&&(element===localHit||element.contains(localHit)||localHit.contains(element))){' +
      'let x=lx,y=ly,childWindow=element.ownerDocument.defaultView;' +
      'while(childWindow&&childWindow.frameElement){const frame=childWindow.frameElement;const rect=frame.getBoundingClientRect();' +
      'x+=rect.left+frame.clientLeft;y+=rect.top+frame.clientTop;const parentDoc=frame.ownerDocument;' +
      'const parentHit=parentDoc.elementFromPoint(x,y);if(!parentHit||!(frame===parentHit||frame.contains(parentHit)||parentHit.contains(frame))){blocked=true;break;}' +
      'childWindow=parentDoc.defaultView;}' +
      'if(!blocked)return {x,y,pageVersion:version};}else lastError="ELEMENT_OBSCURED";}' +
      'await new Promise(resolve=>setTimeout(resolve,args.pollingMs));}' +
      'return {error:lastError==="ELEMENT_OBSCURED"?"ELEMENT_OBSCURED":"TIMEOUT"};})()',
      { ref, ...(position ? { position } : {}), timeoutMs, pollingMs: 100 },
      { timeoutMs });
    return result(point);
  }
  async function click(ref, options) {
    if (typeof ref !== 'string' || !ref.startsWith('e:' + nonce + ':')) bad('tab.click', 'expected snapshot element ref');
    if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options)))
      bad('tab.click', 'invalid options');
    const position = options && options.position;
    if (position !== undefined &&
        (!position || typeof position !== 'object' || Array.isArray(position) ||
         !Number.isFinite(position.x) || !Number.isFinite(position.y)))
      bad('tab.click', 'position must contain finite x and y');
    const requestedModifiers = options && options.modifiers !== undefined
      ? options.modifiers : [];
    if (!Array.isArray(requestedModifiers) || requestedModifiers.length > 4 ||
        requestedModifiers.some(value => !['Alt','Control','ControlOrMeta','Meta','Shift'].includes(value)))
      bad('tab.click', 'invalid keyboard modifiers');
    if (options && options.force === true)
      throw new SdkError('CAPABILITY_NOT_ALLOWED', 'forced clicks are not supported');
    const timeoutMs = options && options.timeoutMs !== undefined ? options.timeoutMs : 30000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
      bad('tab.click', 'timeoutMs must be 1..30000');
    const modifiers = [];
    for (const value of requestedModifiers) {
      if (value === 'ControlOrMeta') {
        const platform = await tab.evaluate('navigator.platform || ""');
        modifiers.push(String(platform).toLowerCase().includes('mac') ? 'Meta' : 'Control');
      } else modifiers.push(value);
    }
    const modifierMask = (modifiers.includes('Alt') ? 1 : 0) |
      (modifiers.includes('Control') ? 2 : 0) |
      (modifiers.includes('Meta') ? 4 : 0) |
      (modifiers.includes('Shift') ? 8 : 0);
    const point = await elementPoint(ref, position, timeoutMs);
    const button = options && options.button ? options.button : 'left';
    if (!['left', 'right', 'middle'].includes(button)) bad('tab.click', 'invalid mouse button');
    const count = options && options.clickCount !== undefined ? options.clickCount : 1;
    if (!Number.isSafeInteger(count) || count < 1 || count > 2) bad('tab.click', 'invalid clickCount');
    try {
      await tab._call('tab.visual.cursor', [{
        x: point.x, y: point.y, visible: true, action: count === 2 ? 'double-click' : 'click'
      }]);
    } catch {
      // A missing overlay must never prevent a real element click.
    }
    await tab.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: point.x, y: point.y, modifiers: modifierMask,
    });
    await tab.cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: point.x, y: point.y, button, clickCount: count,
      modifiers: modifierMask,
    });
    await tab.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: point.x, y: point.y, button, clickCount: count,
      modifiers: modifierMask,
    });
    // Dispatch completed; the page's actual post-click state is not yet verified.
    return action(false, point.pageVersion);
  }
  async function fill(ref, text) {
    if (typeof ref !== 'string' || !ref.startsWith('e:' + nonce + ':') || typeof text !== 'string')
      bad('tab.fill', 'expected snapshot ref and text');
    const completed = result(await tab.evaluate("(() => {\n  const state = globalThis.__avru_sdk_refs_v1;\n  const pageVersion = state ? Math.floor(state.navigation * 1000) + state.revision : 0;\n  const item = state && state.refs.get(args.ref);\n  if (!item || item.pageVersion !== pageVersion || !item.element.isConnected)\n    return { error: 'STALE_REF' };\n  const element = item.element;\n  if (element.disabled || element.readOnly) return { error: 'ELEMENT_NOT_INTERACTABLE' };\n  const input = element.tagName.toLowerCase();\n  if (!(input === 'input' || input === 'textarea' || element.isContentEditable))\n    return { error: 'ELEMENT_NOT_INTERACTABLE' };\n  const before = element.isContentEditable ? element.textContent : element.value;\n  element.focus();\n  if (element.isContentEditable) element.textContent = args.text;\n  else {\n    const descriptor = Object.getOwnPropertyDescriptor(\n      input === 'textarea' ? element.ownerDocument.defaultView.HTMLTextAreaElement.prototype :\n      element.ownerDocument.defaultView.HTMLInputElement.prototype,\n      'value'\n    );\n    if (descriptor && descriptor.set) descriptor.set.call(element, args.text);\n    else element.value = args.text;\n  }\n  element.dispatchEvent(new InputEvent('input', {\n    bubbles: true, inputType: 'insertReplacementText', data: args.text\n  }));\n  element.dispatchEvent(new Event('change', { bubbles: true }));\n  return { changed: before !== args.text, pageVersion };\n})()", { ref, text }));
    return action(completed.changed, completed.pageVersion);
  }
  async function focus(ref) {
    if (typeof ref !== 'string' || !ref.startsWith('e:' + nonce + ':')) bad('tab.focus', 'invalid ref');
    const completed = result(await tab.evaluate(
      '(() => { const s=globalThis.__avru_sdk_refs_v1; const i=s&&s.refs.get(args.ref);' +
      'if(!i||!i.element.isConnected||i.pageVersion!==Math.floor(s.navigation*1000)+s.revision) return {error:"STALE_REF"};' +
      'i.element.focus();return {pageVersion:i.pageVersion}; })()', { ref }));
    return action(false, completed.pageVersion);
  }
  async function hover(ref, options) {
    if (typeof ref !== 'string' || !ref.startsWith('e:' + nonce + ':'))
      bad('tab.hover', 'expected a current task element ref');
    const timeoutMs = options && options.timeoutMs !== undefined ? options.timeoutMs : 30000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
      bad('tab.hover', 'timeoutMs must be 1..30000');
    const p = await elementPoint(ref, undefined, timeoutMs);
    await tab.cua.move({ x: p.x, y: p.y });
    return action(false, p.pageVersion);
  }
  async function selectOption(ref, values) {
    if (typeof ref !== 'string' || !ref.startsWith('e:' + nonce + ':'))
      bad('tab.selectOption', 'expected a current task element ref');
    const list = Array.isArray(values) ? values : [values];
    if (!list.length || list.length > 20 || list.some(item =>
      typeof item !== 'string' && (!item || typeof item !== 'object' ||
      (typeof item.value !== 'string' && typeof item.label !== 'string' &&
      !(Number.isSafeInteger(item.index) && item.index >= 0)))))
      bad('tab.selectOption', 'expected option values, labels or indexes');
    const selected = result(await tab.evaluate(
      '(() => { const s=globalThis.__avru_sdk_refs_v1;const v=s?Math.floor(s.navigation*1000)+s.revision:0;' +
      'const i=s&&s.refs.get(args.ref);if(!i||!i.element.isConnected||i.pageVersion!==v)return {error:"STALE_REF"};' +
      'const el=i.element;if(el.tagName!=="SELECT"||el.disabled)return {error:"ELEMENT_NOT_INTERACTABLE"};' +
      'if(!el.multiple&&args.values.length>1)return {error:"INVALID_ARGUMENT"};' +
      'const opts=Array.from(el.options),chosen=[];' +
      'for(const v of args.values){const opt=typeof v==="string"?opts.find(o=>o.value===v):' +
      'Number.isSafeInteger(v.index)?opts[v.index]:typeof v.value==="string"?opts.find(o=>o.value===v.value):' +
      'opts.find(o=>o.label===v.label);if(!opt)return {error:"ELEMENT_NOT_FOUND"};' +
      'if(opt.disabled)return {error:"ELEMENT_NOT_INTERACTABLE"};chosen.push(opt);}' +
      'const before=Array.from(el.selectedOptions).map(o=>o.index).join(",");' +
      'const ids=new Set(chosen.map(o=>o.index));' +
      'if(el.multiple)opts.forEach(o=>{o.selected=ids.has(o.index)});else el.selectedIndex=chosen[0].index;' +
      'const view=el.ownerDocument.defaultView;el.dispatchEvent(new view.Event("input",{bubbles:true}));el.dispatchEvent(new view.Event("change",{bubbles:true}));' +
      'return {changed:before!==Array.from(el.selectedOptions).map(o=>o.index).join(","),pageVersion:v};})()',
      { ref, values: list }));
    return action(selected.changed, selected.pageVersion);
  }
  const heldKeys = new Set();
  const keyCodes = {
    Enter: 13, Tab: 9, Backspace: 8, Delete: 46, Escape: 27,
    ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
    Shift: 16, Control: 17, Alt: 18, Meta: 91, Space: 32,
  };
  const keyNames = {
    Shift: 'ShiftLeft', Control: 'ControlLeft', Alt: 'AltLeft',
    Meta: 'MetaLeft', Space: 'Space',
  };
  function keyPayload(key) {
    if (typeof key !== 'string' || !key || key.length > 64)
      bad('tab.keyboard', 'invalid key');
    const code = keyCodes[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    if (!code) bad('tab.keyboard', 'unsupported key');
    const name = keyNames[key] || (key.length === 1
      ? (/^[A-Z]$/u.test(key.toUpperCase()) ? 'Key' + key.toUpperCase() :
        /^[0-9]$/u.test(key) ? 'Digit' + key : '')
      : key);
    return {
      key: key === 'Space' ? ' ' : key,
      code: name,
      windowsVirtualKeyCode: code,
      nativeVirtualKeyCode: code,
    };
  }
  function modifierMask() {
    return (heldKeys.has('Alt') ? 1 : 0) |
      (heldKeys.has('Control') ? 2 : 0) |
      (heldKeys.has('Meta') ? 4 : 0) |
      (heldKeys.has('Shift') ? 8 : 0);
  }
  async function keyboardDown(key) {
    const payload = keyPayload(key);
    if (heldKeys.has(key)) return action(false);
    await tab.cdp.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown', ...payload, modifiers: modifierMask(),
    });
    heldKeys.add(key);
    return action(true);
  }
  async function keyboardUp(key) {
    const payload = keyPayload(key);
    heldKeys.delete(key);
    await tab.cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp', ...payload, modifiers: modifierMask(),
    });
    return action(false);
  }
  async function press(key, options) {
    if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options)))
      bad('tab.press', 'options must be an object');
    const modifiers = options && options.modifiers !== undefined ? options.modifiers : [];
    if (!Array.isArray(modifiers) || modifiers.length > 4 ||
        modifiers.some(value => !['Shift','Control','Alt','Meta'].includes(value)))
      bad('tab.press', 'invalid modifiers');
    const duration = options && options.duration !== undefined ? options.duration : 0;
    if (!Number.isFinite(duration) || duration < 0 || duration > 30)
      bad('tab.press', 'duration must be 0..30 seconds');
    return tab.cua.keypress({ keys: modifiers.concat(key), duration });
  }
  async function scroll(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
        !Number.isFinite(options.x === undefined ? 0 : options.x) ||
        !Number.isFinite(options.y === undefined ? 0 : options.y) ||
        (options.behavior !== undefined && !['auto','smooth'].includes(options.behavior)) ||
        (options.ref !== undefined && (typeof options.ref !== 'string' ||
          !options.ref.startsWith('e:' + nonce + ':'))))
      bad('tab.scroll', 'expected finite deltas, optional current ref and auto/smooth behavior');
    const completed = await tab.evaluate(
      '(() => { const dx=args.x||0,dy=args.y||0,behavior=args.behavior||"auto";' +
      'if(args.ref){const s=globalThis.__avru_sdk_refs_v1;const v=s?Math.floor(s.navigation*1000)+s.revision:0;' +
      'const i=s&&s.refs.get(args.ref);if(!i||!i.element.isConnected||i.pageVersion!==v)return {error:"STALE_REF"};' +
      'i.element.scrollBy({left:dx,top:dy,behavior});return {pageVersion:v};}' +
      'window.scrollBy({left:dx,top:dy,behavior});const s=globalThis.__avru_sdk_refs_v1;' +
      'return {pageVersion:s?Math.floor(s.navigation*1000)+s.revision:0};})()',
      { x: options.x || 0, y: options.y || 0, behavior: options.behavior || 'auto',
        ...(options.ref ? { ref: options.ref } : {}) });
    return action(true, result(completed).pageVersion);
  }
  async function setViewport(size) {
    if (!size || typeof size !== 'object' ||
        !Number.isSafeInteger(size.width) || size.width < 1 || size.width > 4096 ||
        !Number.isSafeInteger(size.height) || size.height < 1 || size.height > 4096)
      bad('tab.setViewport', 'expected a viewport of 1..4096 pixels');
    await tab.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false
    });
    return action(true);
  }
  async function waitForNavigation(options) {
    if (!options || !options.waitUntil) return;
    const timeoutMs = options.timeoutMs === undefined ? 30000 : options.timeoutMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000)
      bad('tab.navigation', 'timeoutMs must be 1..300000');
    if (!['load','domcontentloaded','networkidle'].includes(options.waitUntil))
      bad('tab.navigation', 'invalid waitUntil');
    if (tab.playwright && typeof tab.playwright.waitForLoadState === 'function')
      await tab.playwright.waitForLoadState({ state: options.waitUntil, timeoutMs });
  }
  async function navigate(url, options) {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) bad('tab.navigate', 'expected http(s) URL');
    if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options)))
      bad('tab.navigate', 'options must be an object');
    await tab.cdp.send('Page.enable', {});
    const response = await tab.cdp.send('Page.navigate', { url });
    if (response && response.errorText) throw new SdkError('NAVIGATION_FAILED', 'navigation failed');
    await waitForNavigation(options || {});
    return action(false);
  }
  async function reload(options) {
    if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options)))
      bad('tab.reload', 'options must be an object');
    await tab.cdp.send('Page.reload', { ignoreCache: false });
    await waitForNavigation(options || {});
    return action(false);
  }
  async function history(delta, options) {
    if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options)))
      bad('tab.history', 'options must be an object');
    const state = await tab.cdp.send('Page.getNavigationHistory', {});
    const index = state && state.currentIndex + delta;
    const target = state && state.entries && state.entries[index];
    if (!target || !Number.isSafeInteger(target.id))
      throw new SdkError('NO_HISTORY', 'no history entry in that direction');
    await tab.cdp.send('Page.navigateToHistoryEntry', { entryId: target.id });
    await waitForNavigation(options || {});
    return action(false);
  }
  const { locator, getByRole, getByLabel, getByPlaceholder, getByText, getByTestId, frameLocator } =
    globalThis.__avruInstallPageLocators({ tab, nonce, bad, result, snapshot, click, fill, focus, hover, selectOption });
  const playwright = Object.freeze({
    locator, getByRole, getByLabel, getByPlaceholder, getByText, getByTestId,
    frameLocator,
    domSnapshot: async () => {
      const page = await snapshot();
      const lines = page.root.children.map(node => node.role + ': ' + node.name);
      const frames = await tab.evaluate(
        'Array.from(document.querySelectorAll("iframe")).slice(0,8).map(frame=>{' +
        'const parts=[];let node=frame;while(node&&node!==document.documentElement){' +
        'let part=node.tagName.toLowerCase();if(node.id)part+="#"+CSS.escape(node.id);' +
        'else if(node.parentElement){const siblings=Array.from(node.parentElement.children).filter(x=>x.tagName===node.tagName);' +
        'if(siblings.length>1)part+=":nth-of-type("+(siblings.indexOf(node)+1)+")";}parts.unshift(part);node=node.parentElement;}' +
        'return {selector:parts.join(">"),name:frame.title||frame.name||frame.src||"iframe"};})');
      for (const frame of frames || []) {
        try {
          const child = await snapshotFrame(frame.selector, { maxBytes: 6000 });
          lines.push('[iframe ' + frame.name + ']');
          lines.push(...(child.text || '').split('\n').filter(Boolean));
          for (const node of child.root.children)
            lines.push('  ' + node.role + ': ' + node.name);
        } catch (error) {
          if (!error || !['CAPABILITY_NOT_ALLOWED','PAGE_NOT_ACCESSIBLE'].includes(error.code))
            throw error;
        }
      }
      return lines.join('\n');
    },
    evaluate: tab.evaluate,
    waitForURL: (url, options) => waitFor({kind:'url', value:url, ...(options || {})}),
    waitForTimeout: async timeoutMs => {
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 30000)
        bad('playwright.waitForTimeout', 'invalid timeoutMs');
      return tab.evaluate('(async()=>{await new Promise(r=>setTimeout(r,args.ms));return null;})()', {ms:timeoutMs});
    },
  });
  async function waitFor(options) {
    if (!options || typeof options !== 'object' ||
        !['text', 'url', 'selector', 'navigation', 'state'].includes(options.kind) ||
        typeof options.value !== 'string')
      bad('tab.waitFor', 'invalid condition');
    const timeoutMs = options.timeoutMs === undefined ? 30000 : options.timeoutMs;
    const pollingMs = options.pollingMs === undefined ? 100 : options.pollingMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000 ||
        !Number.isSafeInteger(pollingMs) || pollingMs < 10 || pollingMs > 2000)
      bad('tab.waitFor', 'invalid timeoutMs');
    let matched = false;
    if (options.kind === 'navigation') {
      await tab.cdp.send('Page.enable', {});
      const cursor = options.cursor === undefined
        ? await tab.cdp.cursor() : options.cursor;
      if (typeof cursor !== 'string')
        bad('tab.waitFor', 'navigation cursor must be a CDP cursor');
      const tree = await tab.cdp.send('Page.getFrameTree', {});
      const currentUrl = tree && tree.frameTree && tree.frameTree.frame && tree.frameTree.frame.url;
      matched = typeof currentUrl === 'string' && currentUrl !== options.value;
      const deadline = Date.now() + timeoutMs;
      let nextCursor = cursor;
      while (!matched && Date.now() <= deadline) {
        const batch = await tab.cdp.events(nextCursor);
        nextCursor = batch.nextCursor;
        for (const event of batch.events || []) {
          if (event.method !== 'Page.frameNavigated') continue;
          const frame = event.params && event.params.frame;
          if (frame && !frame.parentId && typeof frame.url === 'string') {
            matched = true;
            break;
          }
        }
        if (matched) break;
        await tab.evaluate('(async()=>{await new Promise(r=>setTimeout(r,args.ms));return true;})()', {
          ms: Math.min(pollingMs, Math.max(1, deadline - Date.now())),
        }).catch(() => {});
      }
    } else {
      matched = !!(await tab.evaluate("(async () => {\n  const deadline = Date.now() + args.timeoutMs;\n  while (Date.now() <= deadline) {\n    const kind = args.kind, value = args.value, state = args.state || 'visible';\n    if (kind === 'text' && (document.body?.innerText || '').includes(value)) return true;\n    if (kind === 'url' && location.href.includes(value)) return true;\n    if (kind === 'state' && (document.readyState === value || (value === 'interactive' && document.readyState === 'complete'))) return true;\n    if (kind === 'selector') {\n      const element = document.querySelector(value);\n      const visible = element && !!element.getClientRects().length;\n      if ((state === 'attached' && element) || (state === 'visible' && visible) ||\n          (state === 'hidden' && (!element || !visible)) ||\n          (state === 'detached' && !element)) return true;\n    }\n    await new Promise(resolve => setTimeout(resolve, args.pollingMs));\n  }\n  return false;\n})()", {
        kind: options.kind, value: options.value, state: options.state,
        timeoutMs, pollingMs,
      }));
    }
    return { matched: !!matched, snapshot: await snapshot() };
  }
  function frameDocumentExpression(body) {
    return '(() => { let doc=document,frame=null;for(const selector of args.frameSelectors){frame=doc.querySelector(selector);if(!frame||!frame.contentDocument)return {error:"CAPABILITY_NOT_ALLOWED"};doc=frame.contentDocument;}'+body+'})()';
  }
  async function snapshotFrame(frameSelectors, options) {
    const selectors = Array.isArray(frameSelectors) ? frameSelectors : [frameSelectors];
    if (!selectors.length || selectors.some(value => typeof value !== 'string' || !value))
      bad('tab.frame.snapshot', 'invalid frame selector');
    const maxBytes = options && options.maxBytes !== undefined ? options.maxBytes : 12000;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 60000)
      bad('tab.frame.snapshot', 'maxBytes must be 1024..60000');
    const body = 'const KEY="__avru_sdk_refs_v1";let state=globalThis[KEY];if(!state||state.navigation!==performance.timeOrigin){state={navigation:performance.timeOrigin,revision:0,refs:new Map(),frameObservers:new WeakSet()};Object.defineProperty(globalThis,KEY,{value:state,configurable:true});if(document.documentElement)new MutationObserver(()=>{state.revision+=1;}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});}state.frameObservers=state.frameObservers||new WeakSet();if(doc.documentElement&&!state.frameObservers.has(doc)){new MutationObserver(()=>{state.revision+=1;}).observe(doc.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});state.frameObservers.add(doc);}state.refs.clear();const pageVersion=Math.floor(state.navigation*1000)+state.revision;const children=[];const nodes=doc.querySelectorAll("a[href],button,input,textarea,select,[role],[contenteditable=\"true\"]");let count=0;for(const element of nodes){if(count>=80)break;const box=element.getBoundingClientRect();if(!box.width||!box.height)continue;const tag=element.tagName.toLowerCase();const role=element.getAttribute("role")||(tag==="a"?"link":tag==="select"?"combobox":tag==="button"?"button":tag==="input"?(element.type==="checkbox"?"checkbox":"textbox"):tag==="textarea"?"textbox":tag);const name=element.getAttribute("aria-label")||element.getAttribute("placeholder")||element.getAttribute("title")||(element.innerText||"").trim();const ref="e:"+args.nonce+":"+pageVersion+":frame:"+count;state.refs.set(ref,{element,pageVersion});const node={ref,role,name:name.slice(0,120)};if("disabled" in element)node.disabled=!!element.disabled;if("checked" in element)node.checked=!!element.checked;if(tag==="input"&&element.type!=="password"&&element.type!=="hidden")node.value=String(element.value||"").slice(0,120);children.push(node);count++;}const text=(doc.body?.innerText||"");return {url:frame.contentWindow.location.href,title:doc.title,pageVersion,root:{ref:"document",role:"document",children},text:text.slice(0,args.maxBytes),truncated:text.length>args.maxBytes||(count>=80&&nodes.length>count)};';
    const data = await tab.evaluate(frameDocumentExpression(body), {
      frameSelectors: selectors, nonce, maxBytes,
    });
    if (data && data.error) throw new SdkError(data.error, 'frame is unavailable or cross-origin');
    return { ...data, tabId: tab.tabId, generation: tab.generation };
  }
  async function waitForFrame(frameSelectors, condition) {
    if (!condition || typeof condition !== 'object' || Array.isArray(condition) ||
        !['text','url','selector'].includes(condition.kind) || typeof condition.value !== 'string')
      bad('tab.frame.waitFor', 'invalid wait condition');
    const timeoutMs = condition.timeoutMs === undefined ? 3000 : condition.timeoutMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
      bad('tab.frame.waitFor', 'timeoutMs must be 1..30000');
    const state = condition.state || 'visible';
    if (!['attached','detached','visible','hidden'].includes(state))
      bad('tab.frame.waitFor', 'invalid selector state');
    const selectors = Array.isArray(frameSelectors) ? frameSelectors : [frameSelectors];
    const body = 'return (async()=>{const end=Date.now()+args.timeoutMs;while(Date.now()<=end){const text=doc.body?.innerText||"";const url=frame.contentWindow.location.href;if((args.kind==="text"&&text.includes(args.value))||(args.kind==="url"&&url.includes(args.value)))return true;if(args.kind==="selector"){const element=doc.querySelector(args.value);const visible=element&&!!element.getClientRects().length;if((args.state==="attached"&&element)||(args.state==="visible"&&visible)||(args.state==="hidden"&&(!element||!visible))||(args.state==="detached"&&!element))return true;}await new Promise(resolve=>setTimeout(resolve,100));}return false;})()';
    const matched = await tab.evaluate(frameDocumentExpression(body), {
      frameSelectors: selectors, kind: condition.kind, value: condition.value,
      state, timeoutMs,
    });
    return { matched: !!matched, snapshot: await snapshotFrame(selectors) };
  }
  function makeFrame(frameSelectors) {
    const selectors = Array.isArray(frameSelectors) ? frameSelectors : [frameSelectors];
    return Object.freeze({
      snapshot: options => snapshotFrame(selectors, options),
      click: (ref, options) => click(ref, options),
      fill: (ref, text) => fill(ref, text),
      locator: selector => locator(selector, 0, undefined, selectors),
      frameLocator: selector => frameLocator(selector, selectors),
      getByLabel: (value, options) => getByLabel(value, options, selectors),
      getByPlaceholder: (value, options) => getByPlaceholder(value, options, selectors),
      getByRole: (role, options) => getByRole(role, options, selectors),
      getByTestId: testId => getByTestId(testId, selectors),
      getByText: (value, options) => getByText(value, options, selectors),
      waitFor: condition => waitForFrame(selectors, condition),
    });
  }
  tab.snapshot = snapshot;
  tab.frame = async frameSelector => {
    if (typeof frameSelector !== 'string' || !frameSelector)
      bad('tab.frame', 'frame selector must be a non-empty string');
    const available = await tab.evaluate(
      '(() => { const frame=document.querySelector(args.selector);return !!(frame&&frame.contentDocument); })()',
      { selector: frameSelector });
    if (!available)
      throw new SdkError('CAPABILITY_NOT_ALLOWED', 'frame is unavailable or cross-origin');
    return makeFrame(frameSelector);
  };
  tab.click = click;
  tab.fill = fill;
  tab.focus = focus;
  tab.hover = hover;
  tab.selectOption = selectOption;
  tab.setViewport = setViewport;
  tab.press = press;
  tab.keyboardDown = keyboardDown;
  tab.keyboardUp = keyboardUp;
  tab.scroll = scroll;
  tab.navigate = navigate;
  tab.reload = reload;
  tab.goBack = async options => history(-1, options);
  tab.forward = async options => history(1, options);
  tab.locator = locator;
  tab.playwright = playwright;
  tab.waitFor = waitFor;
  }
  Object.defineProperty(globalThis, '__avruInstallPageApi', { value: installPageApi });
})();`;
