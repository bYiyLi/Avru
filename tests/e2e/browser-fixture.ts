import { chromium, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { resolve } from 'node:path';

export const endpoint = 'http://127.0.0.1:43822';
export async function openProfile(directory: string) {
  const extension = resolve('apps/extension/.output/chrome-mv3');
  const context = await chromium.launchPersistentContext(directory, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  return { context, popup };
}
export async function pairProfile(popup: Page, management: Page, name: string) {
  await popup.locator('[name="endpoint"]').fill(endpoint);
  await popup.locator('[name="name"]').fill(name);
  await popup.getByRole('button', { name: '配对', exact: true }).click();
  const request = management
    .getByRole('region', { name: '配对请求' })
    .filter({ hasText: `${name} 请求配对` });
  await expect(request).toBeVisible();
  const code = await request.locator('code').innerText();
  await expect(popup.getByRole('status')).toContainText(code);
  await request.getByRole('button', { name: '核对一致，批准配对' }).click();
  await expect(
    management.getByRole('heading', { name, exact: true }),
  ).toBeVisible();
}
export async function openObservedTab(context: BrowserContext, title: string) {
  const tab = await context.newPage();
  await tab.route('https://avru.example/**', async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: `<title>${title}</title>`,
    });
  });
  await tab.goto('https://avru.example/observed?private=value#secret');
  return tab;
}
