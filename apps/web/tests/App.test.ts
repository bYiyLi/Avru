import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { App } from '../src/App.js';
it('renders the honest disconnected scaffold state', () => {
  const html = renderToStaticMarkup(createElement(App));
  expect(html).toContain('浏览器控制工作台');
  expect(html).toContain('尚未连接浏览器');
  expect(html).toContain('尚未实现');
});
