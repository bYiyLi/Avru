import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { LogsPage } from '../src/Logs.js';
import type { CallHistory } from '../src/call-types.js';

const history: CallHistory = {
  retention: { limit: 200, persistent: true },
  calls: [],
};

it('places call status, actions, count and paging below the results', () => {
  const html = renderToStaticMarkup(
    createElement(LogsPage, { history, locale: 'zh' }),
  );
  const filters = html.indexOf('class="logs-filters"');
  const table = html.indexOf('class="calls"');
  const footer = html.indexOf('class="logs-table-footer logs-calls-footer"');
  const archive = html.indexOf('class="logs-call-archive"');
  expect(filters).toBeGreaterThan(-1);
  expect(table).toBeGreaterThan(filters);
  expect(footer).toBeGreaterThan(table);
  expect(archive).toBeGreaterThan(footer);
  const bottom = html.slice(footer, archive);
  for (const label of [
    '下载 JSON',
    '复制诊断摘要',
    '共 0 条，显示 0 条',
    '第 1 / 1 页',
  ])
    expect(bottom).toContain(label);
  expect(html.slice(0, filters)).not.toContain('下载 JSON');
});
