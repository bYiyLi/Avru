import { expect } from '@playwright/test';

type RemoteTool = (
  name: string,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export async function verifyScreenshot(
  call: RemoteTool,
  browserId: string,
  tabId: number,
): Promise<void> {
  const task = await call('browser_run_script', {
    browserId,
    tabId: String(tabId),
    script: 'return await browser.tab.screenshot({maxEdgePx:320,quality:45});',
  });
  let output: unknown;
  await expect
    .poll(
      async () => {
        const status = await call('browser_get_execution', {
          executionId: task.executionId,
        });
        output = status.result;
        return status.state;
      },
      { timeout: 15_000 },
    )
    .toBe('succeeded');
  const image = output as { mimeType?: string; data?: string };
  expect(image.mimeType).toBe('image/jpeg');
  expect(image.data?.startsWith('/9j/')).toBe(true);
  const bytes = Buffer.from(image.data ?? '', 'base64');
  expect(bytes.subarray(0, 3).toString('hex')).toBe('ffd8ff');
  expect(bytes.length).toBeGreaterThan(100);
  expect(bytes.length).toBeLessThan(48 * 1024);
}
