import { isValidElement } from 'react';
import type * as React from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  Diagnostics,
  DiagnosticsReport,
  diagnosticConclusion,
} from '../src/Diagnostics.js';
import type { DiagnosticReport } from '../src/controller.js';
const setState = vi.fn();
let mockReport: DiagnosticReport | null = null;
let runningOverride: boolean | null = null;
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useState: (initial: unknown) => {
    let value: unknown = initial;
    if (initial === null && mockReport) value = mockReport;
    if (initial === false && runningOverride !== null) value = runningOverride;
    return [value, setState];
  },
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
beforeEach(() => {
  mockReport = null;
  runningOverride = null;
  setState.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});
const allPassed: DiagnosticReport = {
  steps: [
    { id: 'daemon', status: 'passed' },
    { id: 'session', status: 'passed' },
    { id: 'extension', status: 'passed' },
    { id: 'mcp', status: 'passed' },
  ],
};
const brokenAtExtension: DiagnosticReport = {
  steps: [
    { id: 'daemon', status: 'passed' },
    { id: 'session', status: 'passed' },
    { id: 'extension', status: 'failed' },
    { id: 'mcp', status: 'unknown' },
  ],
};
const partlyUnknown: DiagnosticReport = {
  steps: [
    { id: 'daemon', status: 'failed' },
    { id: 'session', status: 'unknown' },
    { id: 'extension', status: 'unknown' },
    { id: 'mcp', status: 'unknown' },
  ],
};
it('concludes from the first failed step, never from a guess', () => {
  expect(diagnosticConclusion(allPassed, 'zh')).toBe('逐项检查全部通过。');
  expect(diagnosticConclusion(allPassed, 'en')).toBe('Every check passed.');
  expect(diagnosticConclusion(brokenAtExtension, 'zh')).toBe(
    '诊断在“扩展连接与版本”一步中断。',
  );
  expect(diagnosticConclusion(brokenAtExtension, 'en')).toBe(
    'Diagnosis stopped at the “Extension connection and version” step.',
  );
  expect(diagnosticConclusion(partlyUnknown, 'zh')).toBe(
    '诊断在“守护进程可达”一步中断。',
  );
  const unknownOnly: DiagnosticReport = {
    steps: [
      { id: 'daemon', status: 'passed' },
      { id: 'session', status: 'passed' },
      { id: 'extension', status: 'unknown' },
      { id: 'mcp', status: 'passed' },
    ],
  };
  expect(diagnosticConclusion(unknownOnly, 'zh')).toBe(
    '部分步骤未能确认，请稍后重新诊断。',
  );
  expect(diagnosticConclusion(unknownOnly, 'en')).toBe(
    'Some steps could not be confirmed. Run the diagnosis again later.',
  );
});
it('renders each step with passed, failed and unknown labels', () => {
  for (const locale of ['zh', 'en'] as const) {
    const html = renderToStaticMarkup(
      DiagnosticsReport({ report: brokenAtExtension, locale }),
    );
    expect(html).toContain(
      locale === 'zh' ? '扩展连接与版本' : 'Extension connection and version',
    );
    expect(html).toContain(locale === 'zh' ? '通过' : 'Passed');
    expect(html).toContain(locale === 'zh' ? '失败' : 'Failed');
    expect(html).toContain(locale === 'zh' ? '未知' : 'Unknown');
    expect(html).toContain(
      locale === 'zh' ? '诊断在“扩展连接与版本”一步中断。' : 'stopped at',
    );
  }
});
it('shows the entry idle, then running, without inventing results', () => {
  const idle = renderToStaticMarkup(
    Diagnostics({ locale: 'zh', runDiagnostics: vi.fn() }),
  );
  expect(idle).toContain('一键诊断');
  expect(idle).toContain('开始诊断');
  expect(idle).not.toContain('诊断中');
  expect(idle).not.toContain('<ol');
  runningOverride = true;
  const running = renderToStaticMarkup(
    Diagnostics({ locale: 'en', runDiagnostics: vi.fn() }),
  );
  expect(running).toContain('Running diagnosis');
  expect(running).toContain('disabled');
});
it('shows a previous report when one is present', () => {
  mockReport = allPassed;
  const html = renderToStaticMarkup(
    Diagnostics({ locale: 'zh', runDiagnostics: vi.fn() }),
  );
  expect(html).toContain('<ol');
  expect(html).toContain('逐项检查全部通过。');
});
it('runs the checks on demand and keeps the observed report', async () => {
  const runDiagnostics = vi.fn().mockResolvedValue(allPassed);
  clickButtons(Diagnostics({ locale: 'zh', runDiagnostics }));
  expect(runDiagnostics).toHaveBeenCalledOnce();
  expect(setState).toHaveBeenCalledWith(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(setState).toHaveBeenCalledWith(allPassed);
  expect(setState).toHaveBeenCalledWith(false);
});
it('clears the running state when the checks reject', async () => {
  const runDiagnostics = vi.fn().mockRejectedValue(new Error('offline'));
  clickButtons(Diagnostics({ locale: 'zh', runDiagnostics }));
  expect(runDiagnostics).toHaveBeenCalledOnce();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(setState).toHaveBeenCalledWith(false);
  expect(setState).not.toHaveBeenCalledWith(allPassed);
});
