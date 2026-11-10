const AX_SELECT_TEXT_FUNCTION = String.raw`function(input) {
  const el = this, o = input;
  if (!el || el.nodeType !== 1) return { error: 'ELEMENT_NOT_INTERACTABLE' };
  const field = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') &&
    typeof el.value === 'string';
  const source = field ? el.value : (el.textContent || '');
  const matches = [];
  let cursor = 0;
  while (cursor <= source.length) {
    const start = source.indexOf(o.text, cursor);
    if (start < 0) break;
    const end = start + o.text.length;
    const before = !o.prefix || source.slice(Math.max(0, start - o.prefix.length), start) === o.prefix;
    const after = !o.suffix || source.slice(end, end + o.suffix.length) === o.suffix;
    if (before && after) matches.push({ start, end });
    cursor = start + Math.max(1, o.text.length);
  }
  if (matches.length !== 1)
    return { error: matches.length ? 'INVALID_ARGUMENT' : 'ELEMENT_NOT_FOUND' };
  const { start, end } = matches[0];
  const from = o.selectionType === 'cursor_after' ? end : start;
  const to = o.selectionType === 'text' ? end : from;
  if (field) {
    if (typeof el.setSelectionRange !== 'function')
      return { error: 'ELEMENT_NOT_INTERACTABLE' };
    el.focus();
    el.setSelectionRange(from, to);
    return { selected: true };
  }
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let length = 0, node;
  while ((node = walker.nextNode())) {
    const value = node.nodeValue || '';
    nodes.push({ node, start: length, end: length + value.length });
    length += value.length;
  }
  function boundary(offset, preferNext) {
    for (const item of nodes) {
      if (offset < item.end || (!preferNext && offset === item.end))
        return { node: item.node, offset: Math.max(0, offset - item.start) };
    }
    const last = nodes[nodes.length - 1];
    return last ? { node: last.node, offset: (last.node.nodeValue || '').length } : null;
  }
  const a = boundary(from, false), b = boundary(to, true);
  if (!a || !b) return { error: 'ELEMENT_NOT_INTERACTABLE' };
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  const selection = window.getSelection();
  if (!selection) return { error: 'ELEMENT_NOT_INTERACTABLE' };
  selection.removeAllRanges();
  selection.addRange(range);
  return { selected: true };
}`;

/** Avru-native Accessibility SDK: task-local AX indexes, CDP-backed actions. */
export const AX_API_SOURCE = String.raw`(() => {
  function installAxApi(tab) {
  let observed = [];
  function bad(code, detail) { throw new SdkError(code, detail); }
  function index(value) {
    if (!Number.isSafeInteger(value) || value < 0 || !observed[value])
      bad('STALE_REF', 'accessibility index was not observed in this task');
    const node = observed[value];
    if (!Number.isSafeInteger(node.backendDOMNodeId))
      bad('ELEMENT_NOT_INTERACTABLE', 'accessibility node has no DOM target');
    return node.backendDOMNodeId;
  }
  function pair(value) {
    if (!Array.isArray(value) || value.length !== 2 ||
        value.some(n => typeof n !== 'number' || !Number.isFinite(n)))
      bad('INVALID_ARGUMENT', 'coordinate must be [x,y]');
    return { x: value[0], y: value[1] };
  }
  async function snapshot(options) {
    if (options !== undefined && (typeof options !== 'object' || options === null ||
        (options.disableDiffing !== undefined && typeof options.disableDiffing !== 'boolean')))
      bad('INVALID_ARGUMENT', 'invalid accessibility state options');
    await tab.cdp.send('Accessibility.enable', {});
    const tree = await tab.cdp.send('Accessibility.getFullAXTree', {});
    if (!tree || !Array.isArray(tree.nodes))
      bad('PAGE_NOT_ACCESSIBLE', 'browser has no AX tree');
    const available = tree.nodes.filter(n => !n.ignored && n.role &&
      typeof n.role.value === 'string');
    observed = available.slice(0, 100);
    const nodes = observed.map((n, i) => ({
      index: i,
      role: String(n.role.value).slice(0, 70),
      name: n.name && typeof n.name.value === 'string' ?
        n.name.value.slice(0, 160) : undefined,
      value: n.value && typeof n.value.value === 'string' ?
        n.value.value.slice(0, 120) : undefined
    }));
    return { nodes, truncated: available.length > observed.length };
  }
  async function get(mode = 'state', options) {
    if (!['state', 'screenshot', 'both'].includes(mode))
      bad('INVALID_ARGUMENT', 'accessibility mode must be state, screenshot or both');
    const state = mode === 'screenshot' ? undefined : stateText(await snapshot(options));
    const screenshot = mode === 'state' ? undefined : await tab.screenshot();
    if (mode === 'screenshot') return screenshot;
    return mode === 'both' ? { state, screenshot } : state;
  }
  function stateText(tree) {
    return tree.nodes.map(n => '[' + n.index + '] ' + n.role +
      (n.name ? ' ' + n.name : '') +
      (n.value ? ' value=' + n.value : '')).join('\n');
  }
  async function write(mode = 'state', options) {
    if (!['state', 'screenshot', 'both'].includes(mode))
      bad('INVALID_ARGUMENT', 'accessibility mode must be state, screenshot or both');
    const state = mode === 'screenshot' ? undefined : stateText(await snapshot(options));
    const screenshot = mode === 'state' ? undefined : await tab.screenshot();
    const observation = {
      mode,
      ...(state !== undefined ? { state } : {}),
      ...(screenshot !== undefined ? { screenshot } : {}),
    };
    await tab._call('tab.observe.write', [observation]);
  }
  async function selectText(elementIndex, text, options) {
    if (typeof text !== 'string' || !text || text.length > 32768)
      bad('INVALID_ARGUMENT', 'selectText requires 1..32768 characters');
    if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options)))
      bad('INVALID_ARGUMENT', 'selectText options must be an object');
    const prefix = options && options.prefix;
    const suffix = options && options.suffix;
    const selectionType = options && options.selectionType || 'text';
    if ((prefix !== undefined && typeof prefix !== 'string') ||
        (suffix !== undefined && typeof suffix !== 'string') ||
        !['text', 'cursor_before', 'cursor_after'].includes(selectionType))
      bad('INVALID_ARGUMENT', 'invalid selectText options');
    const backendNodeId = index(elementIndex);
    await tab.cdp.send('DOM.enable', {});
    const resolved = await tab.cdp.send('DOM.resolveNode', { backendNodeId });
    const objectId = resolved && resolved.object && resolved.object.objectId;
    if (typeof objectId !== 'string')
      bad('STALE_REF', 'accessibility element could not be resolved');
    let response;
    try {
      response = await tab.cdp.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: ${JSON.stringify(AX_SELECT_TEXT_FUNCTION)},
        arguments: [{ value: { text, prefix, suffix, selectionType } }],
        returnByValue: true,
      });
    } finally {
      await tab.cdp.send('Runtime.releaseObject', { objectId }).catch(() => {});
    }
    const result = response && response.result && response.result.value;
    if (response && response.exceptionDetails)
      bad('PAGE_NOT_ACCESSIBLE', 'accessibility text selection failed');
    if (result && result.error) bad(result.error, 'accessibility text selection failed');
    if (!result || result.selected !== true)
      bad('PAGE_NOT_ACCESSIBLE', 'accessibility text selection returned no result');
    return;
  }
  async function coords(target) {
    if (Array.isArray(target)) return pair(target);
    const backendNodeId = index(target);
    await tab.cdp.send('DOM.enable', {});
    const box = await tab.cdp.send('DOM.getBoxModel', { backendNodeId });
    const quad = box && box.model && (box.model.border || box.model.content);
    if (!Array.isArray(quad) || quad.length !== 8)
      bad('STALE_REF', 'accessibility element has no current box');
    return { x: (quad[0]+quad[2]+quad[4]+quad[6])/4,
      y: (quad[1]+quad[3]+quad[5]+quad[7])/4 };
  }
  async function focus(elementIndex) {
    if (elementIndex === null) return;
    const backendNodeId = index(elementIndex);
    await tab.cdp.send('DOM.focus', { backendNodeId });
  }
  async function click(target, options) {
    if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options)))
      bad('INVALID_ARGUMENT', 'click options must be object');
    const where = await coords(target);
    const count = options && options.clickCount !== undefined ? options.clickCount : 1;
    const duration = options && options.duration !== undefined ? options.duration : 0;
    if (!Number.isSafeInteger(count) || count < 1 || count > 2)
      bad('INVALID_ARGUMENT', 'clickCount must be 1 or 2');
    if (!Number.isFinite(duration) || duration < 0 || duration > 30)
      bad('INVALID_ARGUMENT', 'duration must be 0..30 seconds');
    const button = options && options.mouseButton || 'left';
    const normalized = ({ l: 'left', r: 'right', m: 'middle' })[button] || button;
    const mapped = normalized === 'right' ? 3 : normalized === 'middle' ? 2 : 1;
    if (!['left','right','middle'].includes(normalized))
      bad('INVALID_ARGUMENT', 'invalid mouseButton');
    if (options && options.key !== undefined && typeof options.key !== 'string')
      bad('INVALID_ARGUMENT', 'AX click key must be a string');
    const keyNames = options && options.key ? options.key.split('+').map(k => {
      const name = k.toLowerCase();
      if (name === 'super' || name === 'cmd' || name === 'meta') return 'Meta';
      if (name === 'ctrl' || name === 'control') return 'Control';
      if (name === 'shift') return 'Shift';
      if (name === 'alt' || name === 'option') return 'Alt';
      if (k.length === 1) return k;
      bad('CAPABILITY_NOT_ALLOWED', 'AX click supports modifiers and one character key');
    }) : [];
    let result;
    for (let i = 0; i < count; i++)
      result = await tab.cua.click({ ...where, button: mapped, keypress: keyNames, duration });
    return result;
  }
  async function drag(from, to) {
    return tab.cua.drag({ path: [pair(from), pair(to)] });
  }
  async function paste(elementIndex, text, options) {
    if (typeof text !== 'string') bad('INVALID_ARGUMENT', 'paste text required');
    if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options)))
      bad('INVALID_ARGUMENT', 'paste options must be an object');
    const format = options && options.format || 'text';
    if (!['text', 'md', 'html'].includes(format))
      bad('INVALID_ARGUMENT', 'paste format must be text, md or html');
    await focus(elementIndex);
    const mimeType = format === 'html' ? 'text/html' : format === 'md' ? 'text/markdown' : 'text/plain';
    const entries = [{ mimeType, text }, ...(format === 'text' ? [] : [{ mimeType: 'text/plain', text }])];
    await tab.clipboard.write([{ entries, presentationStyle: 'unspecified' }]);
    const platform = await tab.evaluate('navigator.platform || ""');
    return tab.cua.keypress({ keys: [String(platform).toLowerCase().includes('mac') ? 'Meta' : 'Control', 'v'] });
  }
  async function typeText(elementIndex, text) {
    if (typeof text !== 'string') bad('INVALID_ARGUMENT', 'typeText text required');
    await focus(elementIndex);
    return tab.cua.type({ text });
  }
  async function pressKey(elementIndex, key, options) {
    if (typeof key !== 'string' || !key)
      bad('INVALID_ARGUMENT', 'key must be a string');
    if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options)))
      bad('INVALID_ARGUMENT', 'pressKey options must be an object');
    const duration = options && options.duration !== undefined ? options.duration : 0;
    if (!Number.isFinite(duration) || duration < 0 || duration > 30)
      bad('INVALID_ARGUMENT', 'duration must be 0..30 seconds');
    await focus(elementIndex);
    const keys = key.split('+').map(k => {
      const lower = k.toLowerCase();
      if (lower === 'super' || lower === 'cmd' || lower === 'meta') return 'Meta';
      if (lower === 'ctrl' || lower === 'control') return 'Control';
      if (lower === 'shift') return 'Shift';
      if (lower === 'alt' || lower === 'option') return 'Alt';
      return k;
    });
    return tab.cua.keypress({ keys, duration });
  }
  async function setValue(elementIndex, value) {
    if (typeof value !== 'string') bad('INVALID_ARGUMENT', 'value must be text');
    await focus(elementIndex);
    const selectModifier = await tab.evaluate(
      'navigator.platform.toLowerCase().includes("mac") ? "Meta" : "Control"'
    );
    await tab.cua.keypress({ keys: [selectModifier === 'Meta' ? 'Meta' : 'Control','a'] });
    return tab.cua.type({ text: value });
  }
  async function scroll(target, direction, pages = 1) {
    const normalized = ({ u: 'up', d: 'down', l: 'left', r: 'right' })[direction] || direction;
    if (!['up','down','left','right'].includes(normalized) ||
        !Number.isFinite(pages) || pages <= 0 || pages > 20)
      bad('INVALID_ARGUMENT', 'invalid scroll direction/pages');
    const point = await coords(target);
    const delta = Math.round(500 * pages);
    return tab.cua.scroll({ ...point, scrollX: normalized === 'left' ? -delta :
      normalized === 'right' ? delta : 0,
      scrollY: normalized === 'up' ? -delta : normalized === 'down' ? delta : 0 });
  }
  async function performSecondaryAction(elementIndex, action) {
    if (typeof action !== 'string' || !action || action.length > 64)
      bad('INVALID_ARGUMENT', 'secondary AX action must be a non-empty string');
    if (!Number.isSafeInteger(elementIndex) || elementIndex < 0 || !observed[elementIndex])
      bad('STALE_REF', 'accessibility index was not observed in this task');
    const node = observed[elementIndex];
    const actions = Array.isArray(node.actions)
      ? node.actions.map(item => typeof item === 'string' ? item : item && item.name)
      : [];
    if (!actions.includes(action))
      bad('CAPABILITY_NOT_ALLOWED', 'accessibility action is not exposed by this element');
    await tab.cdp.send('Accessibility.performAction', { nodeId: node.nodeId, action });
    return {
      ok: true, tabId: tab.tabId, generation: tab.generation,
      pageVersion: 0, changed: true,
    };
  }
  tab.ax = Object.freeze({
    snapshot, get, click, drag, paste, pressKey, scroll, setValue, typeText,
    performSecondaryAction, selectText, write,
  });
  }
  Object.defineProperty(globalThis, '__avruInstallAxApi', { value: installAxApi });
})()`;
