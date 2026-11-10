import { expect, type Page } from '@playwright/test';

type RemoteTool = (
  name: string,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

async function executionResult(call: RemoteTool, executionId: string) {
  let output: unknown;
  await expect
    .poll(
      async () => {
        const result = await call('browser_get_execution', { executionId });
        output = result.result;
        return result.state;
      },
      { timeout: 15_000 },
    )
    .toBe('succeeded');
  return output;
}

async function verifyConsole(
  call: RemoteTool,
  browserId: string,
  tabId: number,
) {
  const task = await call('browser_run_script', {
    browserId,
    tabId: String(tabId),
    script:
      'await browser.tab.cdp.send("Runtime.enable",{});' +
      `await browser.tab.evaluate('(() => { console.warn("AVRU_E2E_CONSOLE"); return true; })()');` +
      'return await browser.tab.devLogs({levels:["warn"],filter:"AVRU_E2E_CONSOLE",limit:5});',
  });
  const events = (await executionResult(call, String(task.executionId))) as {
    level: string;
    message: string;
  }[];
  expect(
    events.some(
      (event) =>
        event.level === 'warn' && event.message.includes('AVRU_E2E_CONSOLE'),
    ),
  ).toBe(true);
}

async function verifyDialog(
  call: RemoteTool,
  tab: Page,
  browserId: string,
  tabId: number,
) {
  const prepared = await call('browser_run_script', {
    browserId,
    tabId: String(tabId),
    script: 'await browser.tab.cdp.send("Page.enable",{});return true;',
  });
  await executionResult(call, String(prepared.executionId));
  const pending = tab.waitForEvent('dialog');
  await tab.evaluate(() => {
    setTimeout(() => window.confirm('AVRU_E2E_DIALOG'), 25);
  });
  const dialog = await pending;
  try {
    const observing = await call('browser_run_script', {
      browserId,
      tabId: String(tabId),
      script: 'return await browser.tab.getJsDialog();',
    });
    expect(await executionResult(call, String(observing.executionId))).toEqual({
      type: 'confirm',
      message: 'AVRU_E2E_DIALOG',
    });
    const handled = await call('browser_run_script', {
      browserId,
      tabId: String(tabId),
      script: 'return await browser.tab.dialogDismiss();',
    });
    expect(
      await executionResult(call, String(handled.executionId)),
    ).toMatchObject({
      ok: true,
    });
  } finally {
    await dialog.dismiss().catch(() => {
      // The Avru SDK already handled it; this is just failure cleanup.
    });
  }
}

export async function verifyObservability(
  call: RemoteTool,
  tab: Page,
  browserId: string,
  tabId: number,
) {
  await verifyConsole(call, browserId, tabId);
  await verifyDialog(call, tab, browserId, tabId);
}
