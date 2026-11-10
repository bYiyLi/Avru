/** DomCUA API built on Avru's existing task-scoped element references. */
export const DOM_API_SOURCE = String.raw`(() => {
  function installDomApi(tab) {
  let refs = [];
  function fail(code, message) { throw new SdkError(code, message); }
  function resolve(input) {
    const id = input && typeof input === 'object' ? input.node_id : input;
    if (typeof id === 'string' && id.startsWith('e:')) return id;
    if (Number.isSafeInteger(id) && id >= 0 && typeof refs[id] === 'string')
      return refs[id];
    fail('STALE_REF', 'node ID is not from a live visible DOM observation');
  }
  async function getVisibleTree() {
    const page = await tab.snapshot();
    const nodes = page.root.children || [];
    refs = nodes.map(node => node.ref);
    return {
      nodes: nodes.map((node, index) => ({
        nodeId: index,
        node_id: node.ref,
        role: node.role,
        ...(node.name ? { name: node.name } : {}),
      })),
      truncated: !!page.truncated,
    };
  }
  async function doubleClick(options) {
    const ref = resolve(options);
    return tab.click(ref, { clickCount: 2 });
  }
  async function fill(nodeId, text) {
    return tab.fill(resolve(nodeId), text);
  }
  async function keypress(options) {
    if (!options || !Array.isArray(options.keys))
      fail('INVALID_ARGUMENT', 'keys array is required');
    return tab.cua.keypress({ keys: options.keys });
  }
  async function type(options) {
    if (!options || typeof options.text !== 'string')
      fail('INVALID_ARGUMENT', 'text is required');
    return tab.cua.type(options);
  }
  async function scroll(options) {
    if (!options || typeof options !== 'object' ||
        !Number.isFinite(options.x) || !Number.isFinite(options.y))
      fail('INVALID_ARGUMENT', 'scroll x/y must be finite numbers');
    let x = 200, y = 200;
    if (options.node_id !== undefined) {
      const ref = resolve(options.node_id);
      const point = await tab.evaluate(
        '(() => { const s=globalThis.__avru_sdk_refs_v1;' +
        'const v=s?Math.floor(s.navigation*1000)+s.revision:0;' +
        'const i=s&&s.refs.get(args.ref);' +
        'if(!i||!i.element.isConnected||i.pageVersion!==v)return {error:"STALE_REF"};' +
        'i.element.scrollIntoView({block:"center"});' +
        'const r=i.element.getBoundingClientRect();' +
        'if(!r.width||!r.height)return {error:"ELEMENT_NOT_INTERACTABLE"};' +
        'return {x:r.left+r.width/2,y:r.top+r.height/2};})()',
        { ref }
      );
      if (point && point.error) fail(point.error, point.error);
      x = point.x; y = point.y;
    }
    return tab.cua.scroll({ x, y, scrollX: options.x, scrollY: options.y });
  }
  async function downloadMedia(options) {
    resolve(options);
    if (!options || typeof options !== 'object' ||
        (options.timeoutMs !== undefined &&
         (!Number.isSafeInteger(options.timeoutMs) ||
          options.timeoutMs < 1 || options.timeoutMs > 300000)))
      fail('INVALID_ARGUMENT', 'invalid download options');
    const ref = resolve(options);
    const url = await tab.evaluate(
      '(() => { const s=globalThis.__avru_sdk_refs_v1;' +
      'const i=s&&s.refs.get(args.ref);' +
      'if(!i||!i.element.isConnected)return {error:"STALE_REF"};' +
      'const e=i.element;return e.currentSrc||e.src||e.href||e.poster||null;})()',
      { ref },
    );
    if (url && typeof url === 'object' && url.error)
      fail(url.error, 'media element is no longer available');
    if (typeof url !== 'string' || !url)
      fail('ELEMENT_NOT_FOUND', 'element has no downloadable media URL');
    const timeoutMs = options.timeoutMs === undefined ? 120000 : options.timeoutMs;
    return tab._call('tab.downloadMedia', [url, { timeoutMs }]);
  }
  const dom = {
    getVisibleTree, get_visible_dom: getVisibleTree,
    click: options => tab.click(resolve(options)),
    doubleClick, double_click: doubleClick,
    fill, keypress, scroll, type, downloadMedia,
  };
  tab.dom = Object.freeze(dom);
  }
  Object.defineProperty(globalThis, '__avruInstallDomApi', { value: installDomApi });
})()`;
