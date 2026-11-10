/** Avru-native coordinate CUA implementation, injected in isolated QuickJS. */
export const CUA_API_SOURCE = String.raw`(() => {
  function installCuaApi(tab) {
  const BUTTONS = { 1: 'left', 2: 'middle', 3: 'right', 4: 'back', 5: 'forward' };
  const CODES = {
    Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, Space: 32,
    ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
    Shift: 16, Control: 17, Alt: 18, Meta: 91,
  };
  const CODE_NAMES = {
    Enter: 'Enter', Tab: 'Tab', Escape: 'Escape', Backspace: 'Backspace',
    Delete: 'Delete', Space: 'Space', ArrowLeft: 'ArrowLeft',
    ArrowUp: 'ArrowUp', ArrowRight: 'ArrowRight', ArrowDown: 'ArrowDown',
    Shift: 'ShiftLeft', Control: 'ControlLeft', Alt: 'AltLeft',
    Meta: 'MetaLeft',
  };
  function invalid(method, message) {
    throw new SdkError('INVALID_ARGUMENT', method + ': ' + message);
  }
  function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
  function point(method, input) {
    if (!input || typeof input !== 'object' || !finite(input.x) || !finite(input.y))
      invalid(method, 'expected finite x/y coordinates');
    return { x: input.x, y: input.y };
  }
  function keys(method, input) {
    if (input === undefined) return [];
    if (!Array.isArray(input) || input.length > 4 ||
        input.some(key => typeof key !== 'string' || !key || key.length > 32))
      invalid(method, 'keys must be up to four named keys');
    return input;
  }
  function modifiers(input) {
    let mask = 0;
    if (input.includes('Alt')) mask |= 1;
    if (input.includes('Control')) mask |= 2;
    if (input.includes('Meta')) mask |= 4;
    if (input.includes('Shift')) mask |= 8;
    return mask;
  }
  function button(method, value) {
    const name = BUTTONS[value === undefined ? 1 : value];
    if (!name) invalid(method, 'mouse button must be 1–5');
    return name;
  }
  function action(changed) {
    return { ok: true, tabId: tab.tabId, generation: tab.generation,
      pageVersion: 0, changed };
  }
  function keyCode(key) {
    const code = CODES[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    if (!code || code > 255) invalid('cua.click', 'unsupported held key');
    return {
      key,
      code: CODE_NAMES[key] || (key.length === 1 ? 'Key' + key.toUpperCase() : key),
      windowsVirtualKeyCode: code,
      nativeVirtualKeyCode: code,
    };
  }
  async function virtualCursor(point, action) {
    try {
      await tab._call('tab.visual.cursor', [{
        x: point.x, y: point.y, action, visible: true
      }]);
    } catch {
      // The visual pointer is best-effort; it must never block the real CDP input.
    }
  }
  async function mouse(options, count) {
    const p = point('cua.click', options);
    const keyList = keys('cua.click', options.keypress);
    const btn = button('cua.click', options.button);
    const mod = modifiers(keyList);
    const duration = options.duration === undefined ? 0 : options.duration;
    if (!finite(duration) || duration < 0 || duration > 30)
      invalid('cua.click', 'duration must be 0..30 seconds');
    const held = keyList.filter(key => !['Alt','Control','Meta','Shift'].includes(key)).map(keyCode);
    await virtualCursor(p, count === 2 ? 'double-click' : 'click');
    try {
      for (const key of held)
        await tab.cdp.send('Input.dispatchKeyEvent', {
          type: 'rawKeyDown', ...key, modifiers: mod,
        });
      await tab.cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', ...p, modifiers: mod
      });
      for (let i = 1; i <= count; i++) {
        await tab.cdp.send('Input.dispatchMouseEvent', {
          type: 'mousePressed', ...p, button: btn, clickCount: i, modifiers: mod
        });
        if (duration > 0)
          await tab.evaluate('(async()=>{await new Promise(r=>setTimeout(r,args.ms));return true;})()', { ms: duration * 1000 });
        await tab.cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased', ...p, button: btn, clickCount: i, modifiers: mod
        });
      }
    } finally {
      for (let i = held.length - 1; i >= 0; i--)
        await tab.cdp.send('Input.dispatchKeyEvent', {
          type: 'keyUp', ...held[i], modifiers: mod,
        });
    }
    return action(true);
  }
  async function keypress(options) {
    if (!options || typeof options !== 'object') invalid('cua.keypress', 'options required');
    const names = keys('cua.keypress', options.keys);
    if (!names.length) invalid('cua.keypress', 'keys cannot be empty');
    const duration = options.duration === undefined ? 0 : options.duration;
    if (!finite(duration) || duration < 0 || duration > 30)
      invalid('cua.keypress', 'duration must be 0–30 seconds');
    const codes = names.map(key => {
      const code = CODES[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
      if (!code || code > 255) invalid('cua.keypress', 'unsupported key');
      return code;
    });
    const modifiersHeld = [];
    let downCount = 0;
    try {
      for (let i = 0; i < names.length; i++) {
        const key = names[i];
        if (['Alt','Control','Meta','Shift'].includes(key))
          modifiersHeld.push(key);
        const mask = modifiers(modifiersHeld);
        const isCharacter = key.length === 1;
        const text = isCharacter && !mask ? key : undefined;
        // Chrome's macOS/headless debugger does not consistently apply
        // OS-level Meta+A shortcuts from synthetic key codes alone. CDP's
        // editing command makes Select All deterministic in focused fields.
        const selectAll = key.toLowerCase() === 'a' && (mask & 6) !== 0;
        await tab.cdp.send('Input.dispatchKeyEvent', {
          type: text ? 'keyDown' : 'rawKeyDown', key,
          code: CODE_NAMES[key] || (isCharacter ? 'Key' + key.toUpperCase() : key),
          windowsVirtualKeyCode: codes[i], nativeVirtualKeyCode: codes[i],
          modifiers: mask,
          ...(selectAll ? { commands: ['SelectAll'] } : {}),
          ...(text ? { text, unmodifiedText: text } : {})
        });
        downCount++;
      }
      if (duration > 0)
        await tab.evaluate(
          '(async () => {await new Promise(resolve => setTimeout(resolve, args.ms));return true;})()',
          { ms: duration * 1000 }
        );
    } finally {
      for (let i = downCount - 1; i >= 0; i--) {
        const key = names[i];
        if (['Alt','Control','Meta','Shift'].includes(key)) {
          const index = modifiersHeld.lastIndexOf(key);
          if (index >= 0) modifiersHeld.splice(index, 1);
        }
        await tab.cdp.send('Input.dispatchKeyEvent', {
          type: 'keyUp', key,
          code: CODE_NAMES[key] || (key.length === 1 ? 'Key' + key.toUpperCase() : key),
          windowsVirtualKeyCode: codes[i], nativeVirtualKeyCode: codes[i],
          modifiers: modifiers(modifiersHeld)
        });
      }
    }
    return action(true);
  }
  async function drag(options) {
    if (!options || typeof options !== 'object' || !Array.isArray(options.path) ||
        options.path.length < 2 || options.path.length > 16)
      invalid('cua.drag', 'path must include 2–16 points');
    const points = options.path.map(item => point('cua.drag', item));
    const keyList = keys('cua.drag', options.keys);
    const mod = modifiers(keyList), start = points[0];
    await virtualCursor(start, 'drag-start');
    await tab.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', ...start, modifiers: mod
    });
    await tab.cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', ...start, button: 'left', clickCount: 1, modifiers: mod
    });
    for (let i = 1; i < points.length; i++) {
      await virtualCursor(points[i], 'drag');
      await tab.cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', ...points[i], button: 'left', buttons: 1, modifiers: mod
      });
    }
    await tab.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', ...points[points.length - 1], button: 'left',
      clickCount: 1, modifiers: mod
    });
    await virtualCursor(points[points.length - 1], 'drag-end');
    return action(true);
  }
  async function mediaUrlAt(options) {
    const node = await tab.cdp.send('DOM.getNodeForLocation', {
      x: options.x,
      y: options.y,
      includeUserAgentShadowDOM: true,
      ignorePointerEventsNone: false,
    });
    if (!node || !Number.isSafeInteger(node.backendNodeId))
      invalid('cua.downloadMedia', 'no media element at the requested point');
    const resolved = await tab.cdp.send('DOM.resolveNode', {
      backendNodeId: node.backendNodeId,
    });
    const objectId = resolved && resolved.object && resolved.object.objectId;
    if (typeof objectId !== 'string')
      invalid('cua.downloadMedia', 'media element is no longer available');
    try {
      const response = await tab.cdp.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: 'function(){const e=this;return e.currentSrc||e.src||e.href||e.poster||null;}',
        returnByValue: true,
      });
      const url = response && response.result && response.result.value;
      if (typeof url !== 'string' || !url)
        invalid('cua.downloadMedia', 'element has no downloadable media URL');
      return url;
    } finally {
      await tab.cdp.send('Runtime.releaseObject', { objectId }).catch(() => {});
    }
  }
  async function downloadMedia(options) {
    const p = point('cua.downloadMedia', options);
    const timeoutMs = options.timeoutMs === undefined ? 120000 : options.timeoutMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000)
      invalid('cua.downloadMedia', 'timeoutMs must be 1..300000');
    const url = await mediaUrlAt(p);
    await tab._call('tab.downloadMedia', [url, { timeoutMs }]);
  }
  const cua = {
    click: options => mouse(options, 1),
    double_click: options => mouse(options, 2),
    move: async options => {
      const p = point('cua.move', options);
      const mod = modifiers(keys('cua.move', options.keys));
      await virtualCursor(p, 'move');
      await tab.cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', ...p, modifiers: mod
      });
      return action(false);
    },
    scroll: async options => {
      const p = point('cua.scroll', options);
      if (!finite(options.scrollX) || !finite(options.scrollY))
        invalid('cua.scroll', 'scrollX/scrollY must be finite');
      const mod = modifiers(keys('cua.scroll', options.keypress));
      await virtualCursor(p, 'scroll');
      await tab.cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel', ...p, deltaX: options.scrollX,
        deltaY: options.scrollY, modifiers: mod
      });
      return action(true);
    },
    keypress,
    drag,
    type: async options => {
      if (!options || typeof options.text !== 'string' || options.text.length > 32768)
        invalid('cua.type', 'text must be 0–32768 characters');
      await tab.cdp.send('Input.insertText', { text: options.text });
      return action(true);
    },
    downloadMedia,
  };
  cua.doubleClick = cua.double_click;
  tab.cua = Object.freeze(cua);
  }
  Object.defineProperty(globalThis, '__avruInstallCuaApi', { value: installCuaApi });
})()`;
