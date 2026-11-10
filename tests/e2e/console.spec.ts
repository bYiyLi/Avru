import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, testChannel } from './daemon-fixture.js';

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
    await expect(page.locator('html[lang="en"]')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Your browser/ }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('welcome-dark-en.png'),
      fullPage: true,
    });
    const dark = await page
      .locator('html')
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect
      .poll(() =>
        page
          .locator('html')
          .evaluate((node) => getComputedStyle(node).backgroundColor),
      )
      .not.toBe(dark);
    await page.getByRole('button', { name: 'Enter Avru' }).click();
    await expect(page.locator('.overview')).toBeVisible();
    await page.getByRole('button', { name: /Add browser/ }).click();
    await expect(page.locator('.install')).toContainText('chrome://extensions');
    await expect(page.locator('.install')).toContainText('edge://extensions');
    await page.screenshot({
      path: testInfo.outputPath('install-light-en.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'System overview' }).click();
    await expect(page.locator('.console-version')).toContainText(
      testChannel === 'prod' ? '0.1.0' : '0.1.0-dev.1',
    );
    await expect(page.locator('.console-summary')).toBeVisible();
    await expect(page.locator('.console-metrics')).toContainText('0 / 0');
    await page
      .getByRole('button', { name: 'Call history', exact: true })
      .click();
    await expect(page.locator('.logs')).toContainText(
      /No real call records|Call history unavailable/,
    );
    await page.getByRole('button', { name: 'Browsers', exact: true }).click();
    await expect(page.locator('.browsers-page')).toContainText(
      /No browser connections/,
    );
    await expect(
      page.getByRole('button', { name: 'Switch to dark theme' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '中文' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    expect(overflow).toBe(false);
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
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
