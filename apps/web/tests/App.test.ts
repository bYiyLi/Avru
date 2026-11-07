import { createElement, isValidElement } from 'react';
import type * as React from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { App, Dashboard } from '../src/App.js';
import { createController } from '../src/controller.js';
import type { ViewState } from '../src/controller.js';
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useEffect: (effect: () => () => void) => {
    effect()();
  },
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => ViewState) =>
    snapshot(),
}));
function clickButtons(node: ReactNode) {
  if (Array.isArray(node)) {
    node.forEach(clickButtons);
    return;
  }
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node))
    return;
  node.props.onClick?.();
  clickButtons(node.props.children);
}
it('shows authorization guidance and hooks controller lifecycle', () => {
  const controller = createController({ key: null, clear: vi.fn() });
  const start = vi.spyOn(controller, 'start');
  const stop = vi.spyOn(controller, 'stop');
  const view = App({ controller });
  expect(renderToStaticMarkup(view)).toContain('请重新打开');
  expect(start).toHaveBeenCalled();
  expect(stop).toHaveBeenCalled();
  (view.props as { approve: (id: string) => void }).approve('a');
  (view.props as { reject: (id: string) => void }).reject('a');
  (view.props as { revoke: (id: string) => void }).revoke('a');
});
it('renders pending approval, safe text, online tabs and offline profiles', () => {
  const approve = vi.fn();
  const reject = vi.fn();
  const revoke = vi.fn();
  const state: ViewState = {
    authorized: true,
    busy: false,
    message: '状态消息',
    pairings: [
      {
        id: 'p',
        name: 'Chrome',
        code: '123456',
        origin: 'chrome-extension://test',
        expiresAt: 1000,
      },
    ],
    browsers: [
      {
        id: 'a',
        name: '<script>alert(1)</script>',
        connected: true,
        connectionId: 'c',
        tabs: [{ id: 1, title: 'Tab', url: 'https://example.com' }],
      },
      {
        id: 'b',
        name: 'Offline',
        connected: false,
        connectionId: null,
        tabs: [{ id: 2, title: 'STALE', url: 'https://secret.test' }],
      },
    ],
  };
  const view = Dashboard({ state, approve, reject, revoke });
  const html = renderToStaticMarkup(view);
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('123456');
  expect(html).toContain('https://example.com');
  expect(html).not.toContain('STALE');
  expect(html).not.toContain('<a');
  clickButtons(view);
  expect(approve).toHaveBeenCalledWith('p');
  expect(reject).toHaveBeenCalledWith('p');
  expect(revoke).toHaveBeenCalledTimes(2);
  expect(
    renderToStaticMarkup(
      createElement(Dashboard, {
        state: { ...state, browsers: [], pairings: [], busy: true },
        approve,
        reject,
        revoke,
      }),
    ),
  ).toContain('尚未连接浏览器');
});
