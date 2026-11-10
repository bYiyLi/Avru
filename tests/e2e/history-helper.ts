import { expect } from '@playwright/test';

type RemoteTool = (
  name: string,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

/** Exercise a native Chrome history API call over authenticated MCP and QuickJS. */
export async function verifyHistory(
  call: RemoteTool,
  browserId: string,
  tabId: number,
): Promise<void> {
  const submitted = await call('browser_run_script', {
    browserId,
    tabId: String(tabId),
    script: 'return await browser.history({limit:5,queries:[""]});',
  });
  await expect
    .poll(
      async () => {
        const result = await call('browser_get_execution', {
          executionId: submitted.executionId,
        });
        if (result.state === 'failed')
          throw new Error(
            'History integration failed: ' + JSON.stringify(result),
          );
        if (result.state !== 'succeeded') return result.state;
        expect(Array.isArray(result.result)).toBe(true);
        return 'succeeded';
      },
      { timeout: 15_000 },
    )
    .toBe('succeeded');
}
