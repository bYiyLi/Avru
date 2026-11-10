import { expect, type Page } from '@playwright/test';
import { endpoint } from './browser-fixture.js';

/** Validate the live MCP→task→CDP audit chain through Avru's local API. */
export async function verifyExecutionAudit(
  page: Page,
  executionId: string,
  browserId: string,
  tabId: number,
) {
  const audit = await page.request.get(`${endpoint}/api/execution-audit`);
  expect(audit.status()).toBe(200);
  const result = (await audit.json()) as {
    entries: {
      executionId: string;
      traceId: string | null;
      requestId: string | null;
      state: string;
      browserId: string | null;
      tabId: number | null;
      steps: { method: string; outcome: string }[];
    }[];
    retention: { days: number; persistent: boolean };
  };
  const entry = result.entries.find(
    (record) => record.executionId === executionId,
  );
  expect(entry).toMatchObject({
    executionId,
    browserId,
    tabId,
    state: 'succeeded',
    steps: [expect.objectContaining({ method: 'cdp.send', outcome: 'ok' })],
  });
  expect(entry?.traceId).toMatch(/^[a-f0-9-]{36}$/u);
  expect(entry?.requestId).toMatch(/^[a-f0-9-]{36}$/u);
  expect(result.retention).toMatchObject({ days: 7, persistent: true });
  const calls = await page.request.get(`${endpoint}/api/calls`);
  expect(calls.status()).toBe(200);
  const history = (await calls.json()) as {
    calls: {
      traceId: string;
      requestId: string;
      tool: string | null;
      status: string;
    }[];
  };
  const linked = history.calls.find((call) => call.traceId === entry?.traceId);
  expect(linked).toMatchObject({
    requestId: entry?.requestId,
    tool: 'browser_run_script',
    status: 'succeeded',
  });
  expect(JSON.stringify(result)).not.toContain(
    'Avru isolated browser execution',
  );
}
