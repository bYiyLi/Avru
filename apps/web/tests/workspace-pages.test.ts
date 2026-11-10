import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ActivityPage, ConnectionsPage } from '../src/WorkspacePages.js';
import type { ViewState } from '../src/controller.js';
import type { ConnectionStatus } from '../../../packages/protocol/connection.d.ts';

const connection: ConnectionStatus = {
  state: 'unconfigured',
  configured: false,
  issuer: null,
  mcpUrl: null,
  programVersion: '0.1.0',
  programAvailable: true,
  verification: { publicEntry: 'notVerified', chatgpt: 'notVerified' },
  events: [],
  retention: { limit: 200, persistent: false },
};

function stateWith(system: Exclude<ViewState['system'], undefined>): ViewState {
  return {
    system,
    browsers: [],
    pairings: [],
    history: null,
    connection: null,
    authorized: true,
    busy: false,
    message: '',
  };
}

it('renders activity with and without a known daemon state and opens full logs', () => {
  const onOpenLogs = vi.fn();
  for (const state of [
    stateWith(null),
    stateWith({
      daemonVersion: '0.1.0',
      expectedExtensionVersion: '0.0.1',
      mcp: 'notImplemented',
      chatgpt: 'notImplemented',
      frpc: 'notImplemented',
    }),
  ]) {
    const view = ActivityPage({ state, locale: 'en', onOpenLogs });
    const html = renderToStaticMarkup(createElement(() => view));
    expect(html).toContain('Call history');
    expect(html).toContain('View all');
  }
  onOpenLogs();
  expect(onOpenLogs).toHaveBeenCalledOnce();
});

it('distinguishes unknown, unimplemented and configured connection channels', () => {
  const unknown = renderToStaticMarkup(
    createElement(ConnectionsPage, {
      state: stateWith(null),
      locale: 'en',
    }),
  );
  expect(unknown).toContain('Unknown');

  const unavailable = renderToStaticMarkup(
    createElement(ConnectionsPage, {
      state: stateWith({
        daemonVersion: '0.1.0',
        expectedExtensionVersion: '0.0.1',
        mcp: 'notImplemented',
        chatgpt: 'notImplemented',
        frpc: 'notImplemented',
      }),
      locale: 'en',
    }),
  );
  expect(unavailable).toContain('not implemented');

  const managed = renderToStaticMarkup(
    createElement(ConnectionsPage, {
      state: {
        ...stateWith({
          daemonVersion: '0.1.0',
          expectedExtensionVersion: '0.0.1',
          mcp: 'oauthReadOnly',
          chatgpt: 'notImplemented',
          frpc: 'managed',
        }),
        connection,
      },
      locale: 'en',
    }),
  );
  expect(managed).toContain('Read-only service configured');
  expect(managed).toContain('Remote connection');
});
