import { createElement, isValidElement } from 'react';
import type * as React from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { MaintenancePage } from '../src/WorkspacePages.js';
import { deriveNextSteps } from '../src/Overview.js';
import type { BrowserProfile, ViewState } from '../src/controller.js';
import { createController } from '../src/controller.js';
import type { ConnectionStatus } from '../../../packages/protocol/connection.d.ts';
import { INSTALL_VERSION_ANCHOR, scrollToSection } from '../src/scroll.js';
let page = 'overview';
const setPage = vi.fn();
const openLogs = vi.fn();
const openInstall = vi.fn();
const runDiagnostics = vi.fn().mockResolvedValue({ steps: [] });
beforeEach(() => {
  page = 'overview';
  vi.stubGlobal('location', { hash: '' });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useState: (initial: unknown) => {
    if (typeof initial === 'function') return [page, setPage];
    return [initial, setPage];
  },
  useEffect: (effect: () => () => void) => {
    effect()();
  },
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => ViewState) =>
    snapshot(),
}));
function clickButtons(node: ReactNode): void {
  if (Array.isArray(node)) {
    node.forEach(clickButtons);
    return;
  }
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node))
    return;
  if (typeof node.type === 'function') {
    clickButtons((node.type as (props: unknown) => ReactNode)(node.props));
    return;
  }
  node.props.onClick?.();
  clickButtons(node.props.children);
}
const system = {
  daemonVersion: '0.1.0-dev.1',
  expectedExtensionVersion: '0.0.1',
  mcp: 'notImplemented',
  chatgpt: 'notImplemented',
  frpc: 'notImplemented',
} as const;
const metadata = {
  browserName: 'Chrome',
  browserVersion: '150.0.1',
  versionSource: 'clientHints',
  extensionVersion: '0.0.1',
} as const;
const connectedProfile: BrowserProfile = {
  id: 'a',
  name: 'Chrome',
  connected: true,
  connectionId: 'c',
  tabs: [],
  metadata,
};
const disconnectedProfile: BrowserProfile = {
  id: 'b',
  name: 'Offline',
  connected: false,
  connectionId: null,
  tabs: [],
};
const unconfigured: ConnectionStatus = {
  state: 'unconfigured',
  configured: false,
  issuer: null,
  mcpUrl: null,
  programVersion: '0.1.0',
  programAvailable: true,
  verification: { publicEntry: 'notVerified', chatgpt: 'notVerified' },
  events: [],
  retention: { limit: 200, persistent: true },
};
function stateWith(overrides: Partial<ViewState>): ViewState {
  return {
    system,
    authorized: true,
    busy: false,
    message: '',
    pairings: [],
    browsers: [],
    ...overrides,
  };
}
it('derives next steps from known state only, in impact order', () => {
  expect(deriveNextSteps(stateWith({ system: null }))).toEqual([]);
  expect(deriveNextSteps(stateWith({})).map((step) => step.id)).toEqual([
    'browser',
    'mcp',
  ]);
  expect(
    deriveNextSteps(
      stateWith({
        browsers: [connectedProfile],
        system: { ...system, mcp: 'oauthReadOnly' },
      }),
    ),
  ).toEqual([]);
  expect(
    deriveNextSteps(
      stateWith({
        browsers: [
          {
            ...connectedProfile,
            metadata: { ...metadata, extensionVersion: '0.0.2' },
          },
        ],
        system: { ...system, mcp: 'oauthReadOnly' },
      }),
    ).map((step) => step.id),
  ).toEqual(['version']);
  expect(
    deriveNextSteps(
      stateWith({
        browsers: [
          {
            ...connectedProfile,
            metadata: { ...metadata, extensionVersion: '0.0.2' },
          },
        ],
        system: { ...system, mcp: 'oauthReadOnly', frpc: 'managed' },
        connection: unconfigured,
      }),
    ).map((step) => step.id),
  ).toEqual(['version', 'remote']);
  expect(
    deriveNextSteps(
      stateWith({
        browsers: [connectedProfile],
        system: { ...system, mcp: 'oauthReadOnly', frpc: 'managed' },
        connection: { ...unconfigured, configured: true },
      }),
    ),
  ).toEqual([]);
  expect(
    deriveNextSteps(
      stateWith({
        browsers: [connectedProfile],
        system: { ...system, mcp: 'oauthReadOnly', frpc: 'managed' },
        connection: null,
      }),
    ),
  ).toEqual([]);
  expect(
    deriveNextSteps(
      stateWith({
        browsers: [disconnectedProfile],
        system: { ...system, mcp: 'oauthReadOnly' },
      }),
    ).map((step) => step.id),
  ).toEqual(['browser']);
});
it('renders an explicit unknown or empty state instead of guessing', () => {
  for (const locale of ['zh', 'en'] as const) {
    const unknown = renderToStaticMarkup(
      createElement(MaintenancePage, {
        state: stateWith({ system: null }),
        locale,
        onOpenInstall: openInstall,
        onOpenConnection: openLogs,
        runDiagnostics,
      }),
    );
    expect(unknown).toContain(
      locale === 'zh' ? '状态未确认' : 'Status not confirmed',
    );
    expect(unknown).not.toContain(
      locale === 'zh' ? '尚未连接浏览器' : 'No paired browsers',
    );
    const empty = renderToStaticMarkup(
      createElement(MaintenancePage, {
        state: stateWith({
          browsers: [connectedProfile],
          system: { ...system, mcp: 'oauthReadOnly' },
        }),
        locale,
        onOpenInstall: openInstall,
        onOpenConnection: openLogs,
        runDiagnostics,
      }),
    );
    expect(empty).toContain(
      locale === 'zh' ? '暂无待办事项' : 'Nothing to do right now',
    );
  }
});
it('renders each step with its versions and keeps impact order', () => {
  const mismatched: BrowserProfile = {
    ...connectedProfile,
    metadata: { ...metadata, extensionVersion: '0.0.2' },
  };
  for (const locale of ['zh', 'en'] as const) {
    const html = renderToStaticMarkup(
      createElement(MaintenancePage, {
        state: stateWith({
          browsers: [mismatched],
          system: { ...system, frpc: 'managed' },
          connection: unconfigured,
        }),
        locale,
        onOpenInstall: openInstall,
        onOpenConnection: openLogs,
        runDiagnostics,
      }),
    );
    expect(html).toContain('0.0.2');
    expect(html).toContain('0.0.1');
    expect(html).toContain(
      locale === 'zh' ? '一键诊断' : 'One-click diagnosis',
    );
    expect(
      html.indexOf(locale === 'zh' ? '扩展版本不一致' : 'version mismatch'),
    ).toBeLessThan(
      html.indexOf(locale === 'zh' ? 'MCP 未启用' : 'not enabled'),
    );
    expect(
      html.indexOf(locale === 'zh' ? 'MCP 未启用' : 'not enabled'),
    ).toBeLessThan(
      html.indexOf(locale === 'zh' ? '远程连接未配置' : 'not configured'),
    );
  }
});
it('routes browser and version steps to the guide, and MCP steps in place', () => {
  const browserOnly = renderToStaticMarkup(
    createElement(MaintenancePage, {
      state: stateWith({}),
      locale: 'zh',
      onOpenInstall: openInstall,
      onOpenConnection: openLogs,
      runDiagnostics,
    }),
  );
  expect(browserOnly).toContain('打开安装手册');
  const view = createElement(MaintenancePage, {
    state: stateWith({}),
    locale: 'zh',
    onOpenInstall: openInstall,
    onOpenConnection: openLogs,
    runDiagnostics,
  });
  clickButtons(view);
  expect(openInstall).toHaveBeenCalledWith();
  const mismatched: BrowserProfile = {
    ...connectedProfile,
    metadata: { ...metadata, extensionVersion: '0.0.2' },
  };
  const versionView = createElement(MaintenancePage, {
    state: stateWith({
      browsers: [mismatched],
      system: { ...system, mcp: 'oauthReadOnly' },
    }),
    locale: 'zh',
    onOpenInstall: openInstall,
    onOpenConnection: openLogs,
    runDiagnostics,
  });
  clickButtons(versionView);
  expect(openInstall).toHaveBeenCalledWith(INSTALL_VERSION_ANCHOR);
});
it('opens the guide from the management page through the app', () => {
  const controller = createController({ key: null, clear: vi.fn() });
  const mismatched: BrowserProfile = {
    ...connectedProfile,
    metadata: { ...metadata, extensionVersion: '0.0.2' },
  };
  const wired = {
    ...controller,
    snapshot: () =>
      stateWith({
        browsers: [mismatched],
        system: { ...system, mcp: 'oauthReadOnly' },
      }),
  };
  page = 'overview';
  const first = App({ controller: wired, preferredLanguage: 'zh' });
  expect(renderToStaticMarkup(first)).toContain('扩展版本不一致');
  clickButtons(first);
  expect(setPage).toHaveBeenCalledWith(INSTALL_VERSION_ANCHOR);
  expect(setPage).toHaveBeenCalledWith('install');
});
it('scrolls only when a document and a target exist', () => {
  expect(scrollToSection('connection')).toBe(false);
  const scrollIntoView = vi.fn();
  vi.stubGlobal('document', {
    getElementById: (id: string) =>
      id === 'connection' ? { scrollIntoView } : null,
  });
  expect(scrollToSection('missing')).toBe(false);
  expect(scrollToSection('connection')).toBe(true);
  expect(scrollIntoView).toHaveBeenCalledOnce();
});
