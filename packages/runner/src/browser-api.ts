/** Browser-level SDK facade constructed within the isolated QuickJS context. */
export const BROWSER_API_SOURCE = String.raw`(() => {
  function createBrowserApi(ctx) {
    const { call, primaryTab, managementNamespace, invalidArgument,
      isNonEmptyString, parseUserTab, createTabFacade, SdkError } = ctx;
  const browser = {
    browserId: primaryTab.browserId,
    tab: primaryTab,
    tabs: {
      list: async () => call('tabs.list', []),
      get: async tabId => {
        if (!isNonEmptyString(tabId)) invalidArgument('browser.tabs.get', 'tabId must be a non-empty string');
        return call('tabs.get', [tabId]);
      },
      new: async (url, options) => {
        if (url !== undefined && (typeof url !== 'string' || !url))
          invalidArgument('browser.tabs.new', 'url must be a non-empty string');
        if (options !== undefined && (!options || typeof options !== 'object' ||
            Array.isArray(options) || (options.active !== undefined && typeof options.active !== 'boolean')))
          invalidArgument('browser.tabs.new', 'options.active must be boolean');
        return call('tabs.new', [url ?? null, options ?? {}]);
      },
      selected: async () => {
        const selected = await call('tabs.selected', []);
        return selected ?? undefined;
      },
      content: async options => {
        if (!options || typeof options !== 'object' || Array.isArray(options) ||
            !['html', 'text', 'domSnapshot'].includes(options.contentType) ||
            !Array.isArray(options.urls) || options.urls.length < 1 || options.urls.length > 8 ||
            options.urls.some(url => typeof url !== 'string' || url.length > 2048 ||
              !(url.startsWith('https://') || url.startsWith('http://')) ||
              url.includes(' ') || url.includes(String.fromCharCode(10))) ||
            (options.timeoutMs !== undefined &&
              (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 30000)))
          invalidArgument('browser.tabs.content', 'expected 1..8 HTTP(S) URLs and a supported contentType');
        return call('tabs.content', [options]);
      },
      move: async (tabId, options) => {
        if (!isNonEmptyString(tabId) || !/^(0|[1-9][0-9]*)$/.test(tabId) ||
            !options || typeof options !== 'object' || Array.isArray(options) ||
            !Number.isSafeInteger(options.index) || options.index < -1 ||
            (options.windowId !== undefined &&
             (!Number.isSafeInteger(options.windowId) || options.windowId < 0)))
          invalidArgument('browser.tabs.move', 'expected numeric tabId and {index,windowId?}');
        return call('tabs.move', [tabId, options]);
      },
      close: async tabId => {
        if (!isNonEmptyString(tabId) || !/^(0|[1-9][0-9]*)$/.test(tabId))
          invalidArgument('browser.tabs.close', 'tabId must be a numeric string');
        return call('tabs.close', [tabId]);
      },
      select: async tabId => {
        if (!isNonEmptyString(tabId) || !/^(0|[1-9][0-9]*)$/.test(tabId))
          invalidArgument('browser.tabs.select', 'tabId must be a numeric string');
        return call('tabs.select', [tabId]);
      },
      group: managementNamespace('tabs', ['group']).group,
      ungroup: managementNamespace('tabs', ['ungroup']).ungroup,
    },
    windows: {
      list: async () => call('windows.list', []),
      ...managementNamespace('windows', ['create', 'update']),
    },
    tabGroups: managementNamespace('tabGroups', ['query', 'get', 'update', 'move']),
    bookmarks: managementNamespace('bookmarks', ['search', 'getTree', 'create', 'update', 'move', 'remove']),
    visibility: Object.freeze({
      get: async () => call('browser.visibility.get', []),
      set: async visible => {
        if (typeof visible !== 'boolean')
          invalidArgument('browser.visibility.set', 'visible must be boolean');
        return call('browser.visibility.set', [visible]);
      },
    }),
    viewport: Object.freeze({
      set: async options => {
        if (!options || typeof options !== 'object' ||
            !Number.isSafeInteger(options.width) || options.width < 1 ||
            !Number.isSafeInteger(options.height) || options.height < 1)
          invalidArgument('browser.viewport.set', 'width and height must be positive integers');
        return primaryTab.setViewport(options);
      },
      reset: async () => primaryTab.resetViewport(),
    }),
    capabilities: Object.freeze({
      list: async () => call('capabilities.list', []),
      get: async id => {
        if (!isNonEmptyString(id)) invalidArgument('browser.capabilities.get', 'name must be a non-empty string');
        const capability = await call('capabilities.get', [id]);
        if (!capability || typeof capability !== 'object')
          throw new SdkError('BRIDGE_REJECTED', 'capability response is invalid');
        return Object.freeze({
          ...capability,
          documentation: async () => call('documentation.get', [id]),
        });
      },
    }),
    user: Object.freeze({
      openTabs: async () => call('browser.user.openTabs', []),
      getTabContext: async tab => {
        const target = tab === undefined
          ? { browserId: primaryTab.browserId, tabId: primaryTab.tabId, generation: primaryTab.generation }
          : parseUserTab(tab);
        return call('browser.user.getTabContext', [target]);
      },
      claimTab: async tab => createTabFacade(
        await call('browser.user.claimTab', [parseUserTab(tab)]),
      ),
    }),
    documentation: async () => call('documentation.get', ['overview']),
    nameSession: async name => {
      if (typeof name !== 'string' || !name.trim() || name.length > 128)
        invalidArgument('browser.nameSession', 'name must contain 1..128 characters');
      return call('browser.nameSession', [name.trim()]);
    },
    history: async options => {
      if (options === undefined) options = {};
      if (!options || typeof options !== 'object' || Array.isArray(options))
        invalidArgument('browser.history', 'options must be an object');
      const normalizeDate = value => {
        if (value instanceof Date) {
          if (!Number.isFinite(value.getTime())) invalidArgument('browser.history', 'date is invalid');
          return value.toISOString();
        }
        if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
          invalidArgument('browser.history', 'from/to must be valid date strings');
        return value;
      };
      const from = options.from === undefined ? undefined : normalizeDate(options.from);
      const to = options.to === undefined ? undefined : normalizeDate(options.to);
      if (from !== undefined && to !== undefined && Date.parse(to) < Date.parse(from))
        invalidArgument('browser.history', 'to cannot precede from');
      const limit = options.limit ?? 20;
      const queries = options.queries ?? [''];
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20 ||
          !Array.isArray(queries) || queries.length < 1 || queries.length > 4 ||
          queries.some(query => typeof query !== 'string' || query.length > 120))
        invalidArgument('browser.history', 'invalid limit or queries');
      return call('history.search', [{ ...(from !== undefined ? { from } : {}),
        ...(to !== undefined ? { to } : {}), limit, queries }]);
    },
  };
    return browser;
  }
  Object.defineProperty(globalThis, '__avruCreateBrowserApi', { value: createBrowserApi });
})();`;
