import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon } from './daemon-fixture.js';
import {
  endpoint,
  openObservedTab,
  openProfile,
  pairProfile,
  readProfiles,
} from './browser-fixture.js';

test.use({ locale: 'zh-CN' });

test('two real extension profiles pair, observe, reconnect and revoke', async ({
  page,
}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), 'avru-e2e-'));
  let daemon = await startDaemon(join(directory, 'data'));
  const profiles: Awaited<ReturnType<typeof openProfile>>[] = [];
  try {
    await page.goto(daemon.url);
    await page.getByRole('button', { name: '进入 Avru' }).click();
    await page
      .getByRole('button', { name: '查看系统总览', exact: true })
      .click();
    await expect(page).toHaveURL(`${endpoint}/`);
    const first = await openProfile(join(directory, 'first'));
    profiles.push(first);
    await pairProfile(first.popup, page, 'Profile One');
    const second = await openProfile(join(directory, 'second'));
    profiles.push(second);
    await pairProfile(second.popup, page, 'Profile Two');
    await expect
      .poll(async () => {
        const result = await readProfiles(page, daemon.url);
        return result.browsers.filter(
          (browser) =>
            browser.metadata?.extensionVersion === '0.0.1' &&
            browser.metadata.browserVersion !== 'Unknown',
        ).length;
      })
      .toBe(2);
    await openObservedTab(first.context, 'First observed page');
    await openObservedTab(second.context, 'Second observed page');
    for (const summary of await page.locator('table details summary').all())
      await summary.click();
    await expect(
      page.getByText('First observed page', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Second observed page', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('https://avru.example/observed', { exact: true }),
    ).toHaveCount(2);
    await expect(page.locator('body')).not.toContainText('private=value');
    await page.screenshot({
      path: testInfo.outputPath('overview-connected-zh.png'),
      fullPage: true,
    });
    await first.context.close();
    profiles.shift();
    await expect
      .poll(async () => {
        const result = await readProfiles(page, daemon.url);
        return result.browsers.find((browser) => browser.name === 'Profile One')
          ?.metadata;
      })
      .toBeNull();
    await expect(
      page.getByText('First observed page', { exact: true }),
    ).toHaveCount(0);
    const restored = await openProfile(join(directory, 'first'));
    profiles.push(restored);
    await openObservedTab(restored.context, 'Restored profile page');
    await page
      .getByRole('row')
      .filter({ has: page.getByText('Profile One', { exact: true }) })
      .locator('summary')
      .click();
    await expect(
      page.getByText('Restored profile page', { exact: true }),
    ).toBeVisible();
    await daemon.stop();
    daemon = await startDaemon(join(directory, 'data'));
    await page.goto(daemon.url);
    await page.getByRole('button', { name: '进入 Avru' }).click();
    await page
      .getByRole('button', { name: '查看系统总览', exact: true })
      .click();
    await expect(page.locator('table details summary')).toHaveCount(2, {
      timeout: 20_000,
    });
    for (const summary of await page.locator('table details summary').all())
      await summary.click();
    await expect(
      page.getByText('Restored profile page', { exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByText('Second observed page', { exact: true }),
    ).toBeVisible();
    const firstSection = page.getByRole('row').filter({
      has: page.getByText('Profile One', { exact: true }),
    });
    await firstSection
      .getByRole('button', { name: '撤销此浏览器配对' })
      .click();
    await expect(page.getByText('Profile One', { exact: true })).toHaveCount(0);
    await expect(restored.popup.getByRole('status')).not.toContainText(
      '已连接',
    );
  } finally {
    for (const profile of profiles) await profile.context.close();
    await daemon.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
