/** Task-scoped Page/Frame locator implementation injected into QuickJS. */
export const PAGE_LOCATORS_SOURCE = String.raw`(() => {
  function installPageLocators(ctx) {
    const { tab, nonce, bad, result, snapshot, click, fill, focus, hover, selectOption } = ctx;
  function matcher(value, exact) {
    if (typeof value === 'string') return { value, exact: exact === true };
    if (value instanceof RegExp)
      return { regex: { source: value.source, flags: value.flags }, exact: exact === true };
    bad('playwright', 'text matcher must be a string or RegExp');
  }
  function normalizedMatcher(value, exact) {
    if (value && typeof value === 'object' && !Array.isArray(value) &&
        (typeof value.value === 'string' ||
         (value.regex && typeof value.regex.source === 'string' &&
          typeof value.regex.flags === 'string')) &&
        typeof value.exact === 'boolean')
      return value;
    return matcher(value, exact);
  }
  function queryExpression(actionName) {
    return '(() => {' +
      'const q=args.query;' +
      'const frameSelectors=Array.isArray(q.frameSelectors)?q.frameSelectors:[];' +
      'let root=document;for(const selector of frameSelectors){const frame=root&&root.querySelector(selector);root=frame&&frame.contentDocument;if(!root)return {error:"CAPABILITY_NOT_ALLOWED"};}' +
      'if(frameSelectors.length){const state=globalThis.__avru_sdk_refs_v1;if(state&&root.documentElement){state.frameObservers=state.frameObservers||new WeakSet();if(!state.frameObservers.has(root)){new MutationObserver(()=>{state.revision+=1;}).observe(root.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});state.frameObservers.add(root);}}}' +
      'const rootSelector=(v)=>v.type==="and"?rootSelector(v.left):v.type==="or"?"*":v.type==="descendant"?(v.selector||"*"):(v.selector||"*");' +
      'const matchText=(text,m)=>{if(!m)return true;if(m.regex){try{return new RegExp(m.regex.source,m.regex.flags).test(text)}catch{return false}}return m.exact?text.trim()===m.value:text.includes(m.value)};' +
      'const labelText=(e)=>{const labels=Array.from(e.labels||[]).map(x=>x.innerText||x.textContent||"").join(" ");const ids=(e.getAttribute("aria-labelledby")||"").split(/\\s+/).filter(Boolean).map(id=>root.getElementById(id)?.innerText||"").join(" ");return e.getAttribute("aria-label")||labels||ids||""};' +
      'const roleOf=(e)=>{const r=e.getAttribute("role");if(r)return r;const t=e.tagName.toLowerCase();if(t==="a"&&e.href)return "link";if(t==="button"||((t==="input")&&["button","submit","reset"].includes(e.type)))return "button";if(t==="input"&&e.type==="checkbox")return "checkbox";if(t==="input"&&e.type==="radio")return "radio";if(t==="input"||t==="textarea")return "textbox";if(t==="select")return e.multiple?"listbox":"combobox";if(/^h[1-6]$/.test(t))return "heading";if(t==="img")return "img";return "generic"};' +
      'const matches=(e,v)=>{if(!e||!v)return true;if(v.type==="and")return matches(e,v.left)&&matches(e,v.right);if(v.type==="or")return matches(e,v.left)||matches(e,v.right);if(v.type==="descendant"){if(!e.matches(v.selector||"*"))return false;let p=e.parentElement;while(p){if(matches(p,v.parent))return true;p=p.parentElement}return false}if(!e.matches(v.selector||"*"))return false;const f=v.filters||{};const text=e.getAttribute("aria-label")||e.innerText||e.textContent||"";if(f.hasText&&!matchText(text,f.hasText))return false;if(f.hasNotText&&matchText(text,f.hasNotText))return false;if(f.text&&!matchText(e.innerText||e.textContent||"",f.text))return false;if(f.label&&!matchText(labelText(e),f.label))return false;if(f.placeholder&&!matchText(e.getAttribute("placeholder")||"",f.placeholder))return false;if(f.role&&roleOf(e)!==f.role)return false;if(f.testId&&e.getAttribute("data-testid")!==f.testId)return false;if(f.visible!==undefined&&!!e.getClientRects().length!==f.visible)return false;if(f.has&&!Array.from(e.querySelectorAll(rootSelector(f.has))).some(x=>matches(x,f.has)))return false;if(f.hasNot&&Array.from(e.querySelectorAll(rootSelector(f.hasNot))).some(x=>matches(x,f.hasNot)))return false;return true};' +
      'try{const query=()=>Array.from(root.querySelectorAll(rootSelector(q))).filter(e=>matches(e,q));' +
      (actionName === 'waitFor' ? 'return (async()=>{const deadline=Date.now()+args.timeoutMs;while(Date.now()<=deadline){const nodes=query();const visible=nodes.some(e=>!!e.getClientRects().length);if((args.state==="attached"&&nodes.length>0)||(args.state==="visible"&&visible)||(args.state==="hidden"&&(!nodes.length||!visible))||(args.state==="detached"&&!nodes.length))return true;await new Promise(resolve=>setTimeout(resolve,args.pollingMs));}return false;})()' :
      'const nodes=query();' +
      (actionName === 'count' ? 'return nodes.length;' :
       actionName === 'allText' ? 'return nodes.map(e=>e.textContent);' :
       actionName === 'allEvaluate' ? 'return nodes.map(element=>eval(args.expression));' :
       'const n=args.index<0?nodes.length+args.index:args.index;const element=nodes[n];if(!element)return '+(actionName==='choose'?'null':actionName==='isVisible'||actionName==='isEnabled'?'false':'{error:"ELEMENT_NOT_FOUND"}')+';'+
       (actionName==='choose'?'const s=globalThis.__avru_sdk_refs_v1;const v=Math.floor(s.navigation*1000)+s.revision;const ref="e:"+args.nonce+":"+v+":locator:"+n;s.refs.set(ref,{element,pageVersion:v});return ref;':actionName==='isVisible'?'return !!element.getClientRects().length;':actionName==='isEnabled'?'return !element.disabled;':'return ('+actionName+');')
      ) ) +
      '}catch(error){return {error:"INVALID_ARGUMENT"}}})()';
  }
  function makeLocator(query, index = 0) {
    if (!Number.isSafeInteger(index)) bad('tab.locator', 'invalid index');
    const args = { query, index, nonce };
    function timeoutOf(options, method) {
      if (options === undefined) return 30000;
      if (!options || typeof options !== 'object' || Array.isArray(options))
        bad(method, 'options must be an object');
      const timeoutMs = options.timeoutMs === undefined ? 30000 : options.timeoutMs;
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
        bad(method, 'timeoutMs must be 1..30000');
      return timeoutMs;
    }
    async function wait(state, timeoutMs = 30000) {
      const matched = await tab.evaluate(queryExpression('waitFor'), {
        ...args, state, timeoutMs, pollingMs: 100,
      });
      return !!matched;
    }
    async function choose(timeoutMs = 30000) {
      if (!await wait('visible', timeoutMs))
        throw new SdkError('TIMEOUT', 'locator did not become visible');
      await snapshot();
      const ref = await tab.evaluate(queryExpression('choose'), args);
      if (ref && typeof ref === 'object' && ref.error)
        throw new SdkError(ref.error, ref.error);
      if (typeof ref !== 'string') throw new SdkError('ELEMENT_NOT_FOUND', 'no matching element');
      return ref;
    }
    async function read(expression, extra, timeoutMs = 30000) {
      if (!['count','allText','allEvaluate','isVisible','isEnabled'].includes(expression)) {
        if (!await wait('attached', timeoutMs))
          throw new SdkError('TIMEOUT', 'locator did not become attached');
      }
      const value = await tab.evaluate(queryExpression(expression), {
        ...args, ...(extra || {}),
      }, { timeoutMs });
      return result(value);
    }
    function child(selector, filters = {}) {
      if (typeof selector !== 'string' || !selector)
        bad('locator.locator', 'selector required');
      return makeLocator({ type: 'descendant', parent: query, selector, filters,
        ...(query.frameSelectors ? { frameSelectors: query.frameSelectors } : {}) }, 0);
    }
    function getByRole(role, options) {
      if (typeof role !== 'string' || !/^[a-zA-Z][\w-]*$/u.test(role))
        bad('locator.getByRole', 'invalid role');
      const config = options === undefined ? {} : options;
      if (!config || typeof config !== 'object' || Array.isArray(config))
        bad('locator.getByRole', 'options must be an object');
      const native = role === 'button' ? 'button,input[type="button"],input[type="submit"],[role="button"]' :
        role === 'textbox' ? 'input:not([type="hidden"]),textarea,[role="textbox"]' :
        role === 'link' ? 'a[href],[role="link"]' : '*';
      return child(native, { role, ...(config.name !== undefined ? { hasText: matcher(config.name, config.exact) } : {}) });
    }
    function getByLabel(value, options) {
      const config = options === undefined ? {} : options;
      if (!config || typeof config !== 'object' || Array.isArray(config) ||
          (config.exact !== undefined && typeof config.exact !== 'boolean')) bad('locator.getByLabel', 'invalid options');
      return child('input,textarea,select,[role]', { label: matcher(value, config.exact) });
    }
    function getByPlaceholder(value, options) {
      const config = options === undefined ? {} : options;
      if (!config || typeof config !== 'object' || Array.isArray(config) ||
          (config.exact !== undefined && typeof config.exact !== 'boolean')) bad('locator.getByPlaceholder', 'invalid options');
      return child('input[placeholder],textarea[placeholder]', { placeholder: matcher(value, config.exact) });
    }
    function getByText(value, options) {
      const config = options === undefined ? {} : options;
      if (!config || typeof config !== 'object' || Array.isArray(config) ||
          (config.exact !== undefined && typeof config.exact !== 'boolean')) bad('locator.getByText', 'invalid options');
      return child('*', { text: matcher(value, config.exact) });
    }
    function getByTestId(testId) {
      if (typeof testId !== 'string' || !testId || testId.length > 256)
        bad('locator.getByTestId', 'invalid testId');
      const escaped = testId.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
      return child('[data-testid="' + escaped + '"]');
    }
    const facade = {
      click: async options => click(await choose(timeoutOf(options, 'locator.click')), options),
      fill: async (text, options) => fill(await choose(timeoutOf(options, 'locator.fill')), text),
      focus: async options => focus(await choose(timeoutOf(options, 'locator.focus'))),
      hover: async options => hover(await choose(timeoutOf(options, 'locator.hover'))),
      selectOption: async (values, options) => selectOption(await choose(timeoutOf(options, 'locator.selectOption')), values),
      count: async () => read('count'),
      textContent: async options => read('element.textContent', null, timeoutOf(options, 'locator.textContent')),
      innerText: async options => read('element.innerText||element.textContent||""', null, timeoutOf(options, 'locator.innerText')),
      getAttribute: async (name, options) => {
        if (typeof name !== 'string' || !name) bad('locator.getAttribute', 'invalid name');
        return read('element.getAttribute(args.name)', { name }, timeoutOf(options, 'locator.getAttribute'));
      },
      isVisible: async () => read('isVisible'),
      isEnabled: async () => read('isEnabled'),
      __point: async () => read('(() => { const r=element.getBoundingClientRect();const s=globalThis.__avru_sdk_refs_v1;return {x:r.left+r.width/2,y:r.top+r.height/2,pageVersion:Math.floor(s.navigation*1000)+s.revision}; })()'),
      __evaluate: async (expression, extra, timeoutMs = 30000) => {
        const count = await read('count');
        if (count === 0) throw new SdkError('ELEMENT_NOT_FOUND', 'locator matched no elements');
        if (count !== 1) throw new SdkError('INVALID_ARGUMENT', 'locator.evaluate requires exactly one element');
        return read(expression, extra, timeoutMs);
      },
      __evaluateAll: async (expression, arg, timeoutMs = 30000) => {
        if (typeof expression !== 'string' || !expression)
          bad('locator.evaluateAll', 'expression required');
        return read('allEvaluate', { expression, arg }, timeoutMs);
      },
      __waitFor: async (state, timeoutMs, pollingMs) => {
        if (!['attached','detached','visible','hidden'].includes(state)) bad('locator.waitFor', 'invalid state');
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) bad('locator.waitFor', 'invalid timeoutMs');
        return tab.evaluate(queryExpression('waitFor'), { ...args, state, timeoutMs, pollingMs });
      },
      first: () => makeLocator(query, 0),
      last: () => makeLocator(query, -1),
      nth: n => makeLocator(query, n),
      locator: (selector, options) => child(selector, normalizeFilters(options)),
      getByRole,
      getByLabel,
      getByPlaceholder,
      getByText,
      getByTestId,
      filter: options => makeLocator({ ...query, filters: { ...(query.filters || {}), ...normalizeFilters(options) } }, index),
      and: other => {
        if (!other || !other.__query) bad('locator.and', 'expected a locator');
        return makeLocator({ type: 'and', left: query, right: other.__query,
          ...(query.frameSelectors ? { frameSelectors: query.frameSelectors } : {}) }, index);
      },
      or: other => {
        if (!other || !other.__query) bad('locator.or', 'expected a locator');
        return makeLocator({ type: 'or', left: query, right: other.__query,
          ...(query.frameSelectors ? { frameSelectors: query.frameSelectors } : {}) }, index);
      },
    };
    Object.defineProperty(facade, '__query', { value: query });
    return Object.freeze(facade);
  }
  function normalizeFilters(options) {
    if (options === undefined) return {};
    if (!options || typeof options !== 'object' || Array.isArray(options))
      bad('locator.filter', 'filter options must be an object');
    const filters = { ...options };
    if (options.hasText !== undefined) filters.hasText = normalizedMatcher(options.hasText);
    if (options.hasNotText !== undefined) filters.hasNotText = normalizedMatcher(options.hasNotText);
    if (options.text !== undefined) filters.text = normalizedMatcher(options.text);
    if (options.label !== undefined) filters.label = normalizedMatcher(options.label);
    if (options.placeholder !== undefined) filters.placeholder = normalizedMatcher(options.placeholder);
    if (options.has !== undefined) {
      if (!options.has.__query) bad('locator.filter', 'has must be a locator');
      filters.has = options.has.__query;
    }
    if (options.hasNot !== undefined) {
      if (!options.hasNot.__query) bad('locator.filter', 'hasNot must be a locator');
      filters.hasNot = options.hasNot.__query;
    }
    if (options.visible !== undefined && typeof options.visible !== 'boolean')
      bad('locator.filter', 'visible must be boolean');
    return filters;
  }
  function locator(selector, index = 0, hasText, frameSelectors) {
    if (typeof selector !== 'string' || !selector)
      bad('tab.locator', 'selector must be a non-empty string');
    const filters = hasText === undefined ? {} :
      typeof hasText === 'string' ? { hasText: matcher(hasText) } : normalizeFilters(hasText);
    return makeLocator({
      type: 'css', selector, filters,
      ...(frameSelectors ? { frameSelectors } : {}),
    }, index);
  }
  function getByRole(role, options, frameSelectors) {
    if (typeof role !== 'string' || !/^[a-zA-Z][\w-]*$/.test(role))
      bad('tab.getByRole', 'invalid role');
    const config = options === undefined ? {} : options;
    if (!config || typeof config !== 'object' || Array.isArray(config) ||
        (config.exact !== undefined && typeof config.exact !== 'boolean'))
      bad('tab.getByRole', 'invalid options');
    const filters = { role };
    if (config.name !== undefined) filters.hasText = matcher(config.name, config.exact);
    const native = role === 'button' ? 'button,input[type="button"],input[type="submit"],[role="button"]' :
      role === 'textbox' ? 'input:not([type="hidden"]),textarea,[role="textbox"]' :
      role === 'link' ? 'a[href],[role="link"]' : '*';
    return locator(native, 0, undefined, frameSelectors).filter(filters);
  }
  function getByLabel(value, options, frameSelectors) {
    const config = options === undefined ? {} : options;
    if (!config || typeof config !== 'object' || Array.isArray(config) ||
        (config.exact !== undefined && typeof config.exact !== 'boolean'))
      bad('tab.getByLabel', 'invalid options');
    return locator('input,textarea,select,[role]', 0, undefined, frameSelectors).filter({
      label: matcher(value, config.exact),
    });
  }
  function getByPlaceholder(value, options, frameSelectors) {
    const config = options === undefined ? {} : options;
    if (!config || typeof config !== 'object' || Array.isArray(config) ||
        (config.exact !== undefined && typeof config.exact !== 'boolean'))
      bad('tab.getByPlaceholder', 'invalid options');
    return locator('input[placeholder],textarea[placeholder]', 0, undefined, frameSelectors).filter({
      placeholder: matcher(value, config.exact),
    });
  }
  function getByText(value, options, frameSelectors) {
    const config = options === undefined ? {} : options;
    if (!config || typeof config !== 'object' || Array.isArray(config) ||
        (config.exact !== undefined && typeof config.exact !== 'boolean'))
      bad('tab.getByText', 'invalid options');
    return locator('*', 0, undefined, frameSelectors).filter({ text: matcher(value, config.exact) });
  }
  function getByTestId(testId, frameSelectors) {
    if (typeof testId !== 'string' || !testId || testId.length > 256 || /[\u0000-\u001f]/u.test(testId))
      bad('tab.getByTestId', 'invalid testId');
    const escaped = testId.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
    return locator('[data-testid="' + escaped + '"]', 0, undefined, frameSelectors);
  }
  function frameLocator(selector, parents = []) {
    if (typeof selector !== 'string' || !selector)
      bad('tab.playwright.frameLocator', 'frame selector must be a non-empty string');
    const selectors = parents.concat(selector);
    return Object.freeze({
      frameLocator: child => frameLocator(child, selectors),
      locator: child => locator(child, 0, undefined, selectors),
      getByRole: (role, options) => getByRole(role, options, selectors),
      getByLabel: (value, options) => getByLabel(value, options, selectors),
      getByPlaceholder: (value, options) => getByPlaceholder(value, options, selectors),
      getByTestId: testId => getByTestId(testId, selectors),
      getByText: (value, options) => getByText(value, options, selectors),
    });
  }
    return { locator, getByRole, getByLabel, getByPlaceholder, getByText, getByTestId, frameLocator };
  }
  Object.defineProperty(globalThis, '__avruInstallPageLocators', { value: installPageLocators });
})();`;
