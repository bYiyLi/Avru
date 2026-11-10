/** Single canonical advertised Avru SDK capability set. */
export interface CapabilityInfo {
  name: string;
  title: string;
  description: string;
  supported: boolean;
  reason?: string;
}

/**
 * Static minimal capability set for M1. The daemon returns this set from
 * capabilities.list/get; it is kept here as the single canonical list so
 * the runner tests and the daemon implementation agree.
 */
export const SDK_CAPABILITIES: readonly CapabilityInfo[] = Object.freeze([
  Object.freeze({
    name: 'tabs.list',
    title: 'List tabs',
    description: 'List metadata of the connected browser tabs (read-only).',
    supported: true,
  }),
  Object.freeze({
    name: 'tabs.content',
    title: 'Read URLs in background',
    description:
      'Read bounded text, HTML, or DOM snapshots in temporary background tabs.',
    supported: true,
  }),
  Object.freeze({
    name: 'browser.history',
    title: 'Search browser history',
    description:
      'Search bounded browsing history of the connected browser profile.',
    supported: true,
  }),
  Object.freeze({
    name: 'windows.list',
    title: 'List browser windows',
    description: 'List regular windows in the connected browser profile.',
    supported: true,
  }),
  Object.freeze({
    name: 'tabs.move',
    title: 'Move a browser tab',
    description:
      'Reorder a tab or move it to another window in its connected browser profile.',
    supported: true,
  }),
  Object.freeze({
    name: 'tabs.get',
    title: 'Get a tab',
    description: 'Get metadata of one tab by tabId (read-only).',
    supported: true,
  }),
  Object.freeze({
    name: 'tabs.new',
    title: 'Create browser tab',
    description: 'Create a tab through the connected browser extension.',
    supported: true,
  }),
  Object.freeze({
    name: 'tabs.close',
    title: 'Close browser tab',
    description: 'Close a tab without per-operation user confirmation.',
    supported: true,
  }),
  Object.freeze({
    name: 'tabs.select',
    title: 'Select browser tab',
    description: 'Activate a selected tab in the connected browser.',
    supported: true,
  }),
  Object.freeze({
    name: 'tabs.selected',
    title: 'Current active tab',
    description: 'Return the active tab in the current browser window.',
    supported: true,
  }),
  Object.freeze({
    name: 'tab.title',
    title: 'Target tab title',
    description: 'Title of the claimed target tab.',
    supported: true,
  }),
  Object.freeze({
    name: 'tab.url',
    title: 'Target tab URL',
    description:
      'Read the current target URL through the CDP execution context.',
    supported: true,
  }),
  Object.freeze({
    name: 'tab.snapshot',
    title: 'Read target page text',
    description:
      'Capture a bounded title, URL and visible text snapshot (M2 text slice).',
    supported: true,
  }),
  Object.freeze({
    name: 'tab.screenshot',
    title: 'Capture bounded JPEG screenshot',
    description:
      'Capture a viewport, region, or full-page JPEG using CDP within the inline runner result limit.',
    supported: true,
  }),
  Object.freeze({
    name: 'tab.evaluate',
    title: 'Evaluate page expression',
    description:
      'Evaluate a serializable expression in the target page via CDP.',
    supported: true,
  }),
  Object.freeze({
    name: 'tab.click',
    title: 'Click a snapshot element',
    description: 'Use real CDP mouse events on a fresh snapshot reference.',
    supported: true,
  }),
  Object.freeze({
    name: 'tab.fill',
    title: 'Fill an element',
    description: 'Fill an editable element and notify form listeners.',
    supported: true,
  }),
  Object.freeze({
    name: 'tab.focus',
    title: 'Focus an element',
    description: 'Focus an element by fresh snapshot reference.',
    supported: true,
  }),
  Object.freeze({
    name: 'tab.press',
    title: 'Press a keyboard key',
    description: 'Send a real CDP keyboard keyDown/keyUp.',
    supported: true,
  }),
  Object.freeze({
    name: 'tab.hover',
    title: 'Hover a snapshot element',
    description: 'Move the CDP pointer to a fresh task-scoped element.',
    supported: true,
  }),
  Object.freeze({
    name: 'tab.selectOption',
    title: 'Select an HTML option',
    description: 'Select a value, label or index and emit input/change events.',
    supported: true,
  }),
  Object.freeze({
    name: 'tab.setViewport',
    title: 'Set browser viewport',
    description:
      'Use CDP Emulation to override the target viewport dimensions.',
    supported: true,
  }),
  Object.freeze({
    name: 'tab.scroll',
    title: 'Scroll a page',
    description: 'Scroll with the browser CDP mouseWheel event.',
    supported: true,
  }),
  Object.freeze({
    name: 'tab.navigate',
    title: 'Navigate a tab',
    description: 'Navigate an HTTP(S) page with the CDP Page domain.',
    supported: true,
  }),
  Object.freeze({
    name: 'tab.reload',
    title: 'Reload a page',
    description: 'Reload the current page with CDP.',
    supported: true,
  }),
  Object.freeze({
    name: 'tab.goBack',
    title: 'Go back',
    description: 'Navigate to the previous CDP history entry.',
    supported: true,
  }),
  Object.freeze({
    name: 'tab.forward',
    title: 'Go forward',
    description: 'Navigate to the next CDP history entry.',
    supported: true,
  }),
  Object.freeze({
    name: 'tab.locator',
    title: 'Locate page elements',
    description: 'Query and interact with CSS-selected page elements.',
    supported: true,
  }),
  Object.freeze({
    name: 'tab.playwright',
    title: 'Playwright-like browser API',
    description:
      'Use Avru native locator, role selector, and page wait wrappers.',
    supported: true,
  }),
  ...[
    'getByPlaceholder',
    'getByText',
    'locator.dblclick',
    'locator.press',
    'locator.type',
    'locator.pressSequentially',
    'locator.all',
    'locator.allTextContents',
  ].map((name) =>
    Object.freeze({
      name: `tab.playwright.${name}`,
      title: `Playwright-style ${name}`,
      description: 'Native Avru locator wrapper backed by CDP.',
      supported: true,
    }),
  ),
  Object.freeze({
    name: 'tab.waitFor',
    title: 'Wait for a page condition',
    description: 'Wait for a selector, text, or URL condition.',
    supported: true,
  }),
  ...[
    'click',
    'double_click',
    'downloadMedia',
    'drag',
    'keypress',
    'move',
    'scroll',
    'type',
  ].map((name) =>
    Object.freeze({
      name: `tab.cua.${name}`,
      title: `Viewport CUA ${name}`,
      description: 'Avru-native viewport browser control via CDP Input events.',
      supported: true,
    }),
  ),
  Object.freeze({
    name: 'tab.cua.doubleClick',
    title: 'Viewport CUA double-click',
    description: 'Avru camelCase alias for CUA double_click.',
    supported: true,
  }),
  ...[
    'getVisibleTree',
    'click',
    'doubleClick',
    'fill',
    'keypress',
    'scroll',
    'type',
    'downloadMedia',
  ].map((name) =>
    Object.freeze({
      name: `tab.dom.${name}`,
      title: `DOM CUA ${name}`,
      description: 'Operate on a task-scoped visible DOM element reference.',
      supported: true,
    }),
  ),
  ...[
    'snapshot',
    'get',
    'click',
    'drag',
    'paste',
    'pressKey',
    'scroll',
    'setValue',
    'typeText',
    'performSecondaryAction',
    'selectText',
    'write',
  ].map((name) =>
    Object.freeze({
      name: `tab.ax.${name}`,
      title: `Accessibility ${name}`,
      description:
        'Avru-native CDP Accessibility and DOM-backed browser control.',
      supported: true,
    }),
  ),
  ...['devLogs', 'getJsDialog', 'dialogAccept', 'dialogDismiss'].map((name) =>
    Object.freeze({
      name: `tab.${name}`,
      title: `Browser ${name}`,
      description:
        'Avru-native Chrome DevTools Protocol browser observation and control.',
      supported: true,
    }),
  ),
  Object.freeze({
    name: 'cdp.send',
    title: 'Send CDP command',
    description:
      'Call any supported Chrome DevTools Protocol method in the target tab.',
    supported: true,
  }),
  Object.freeze({
    name: 'cdp.events',
    title: 'Read CDP events',
    description:
      'Read buffered CDP events using a cursor, with no domain filter.',
    supported: true,
  }),
  Object.freeze({
    name: 'cdp.cursor',
    title: 'CDP event cursor',
    description:
      'Capture the current CDP event cursor before triggering an action.',
    supported: true,
  }),
  Object.freeze({
    name: 'capabilities.list',
    title: 'List capabilities',
    description: 'List the SDK capabilities available to this task.',
    supported: true,
  }),
  Object.freeze({
    name: 'capabilities.get',
    title: 'Get a capability',
    description: 'Describe one SDK capability by name.',
    supported: true,
  }),
]);
