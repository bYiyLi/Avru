import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon } from './daemon-fixture.js';

test.use({
  locale: 'en-US',
  colorScheme: 'dark',
  viewport: { width: 390, height: 844 },
});
test('English system-dark console keeps truthful three-page empty states', async ({
  page,
}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), 'avru-console-'));
  const daemon = await startDaemon(directory);
  try {
    await page.goto(daemon.url);
    await expect(page.locator('[lang="en"]')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Your browser/ }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('welcome-dark-en.png'),
      fullPage: true,
    });
    const dark = await page
      .locator('body')
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect
      .poll(() =>
        page
          .locator('body')
          .evaluate((node) => getComputedStyle(node).backgroundColor),
      )
      .not.toBe(dark);
    await page.getByRole('button', { name: 'Enter Avru' }).click();
    await expect(
      page.getByText(/does not yet include an installable extension/),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('install-light-en.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Open system overview' }).click();
    await expect(page.getByText('0.1.0-dev.1', { exact: true })).toBeVisible();
    await expect(page.getByText('No real call records')).toBeVisible();
    await expect(page.getByText(/No paired browsers/)).toBeVisible();
    await expect(
      page.getByRole('button', { name: /theme|language|save/i }),
    ).toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    expect(overflow).toBe(false);
    await page.screenshot({
      path: testInfo.outputPath('overview-light-en.png'),
      fullPage: true,
    });
    await page.reload();
    await expect(
      page.getByRole('heading', { name: /Your browser/ }),
    ).toBeVisible();
  } finally {
    await daemon.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
