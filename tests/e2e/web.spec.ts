import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon } from './daemon-fixture.js';
import {
  endpoint,
  openObservedTab,
  openProfile,
  waitForProfile,
  readProfiles,
} from './browser-fixture.js';

test.use({ locale: 'zh-CN' });
test('two real extensions register without pages, restore after restarts and stop when closed', async ({
  page,
}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), 'avru-local-e2e-'));
  let daemon = await startDaemon(join(directory, 'data'));
  const contexts: Awaited<ReturnType<typeof openProfile>>[] = [];
  try {
    await page.goto(endpoint);
    await expect(
      page.getByRole('heading', { name: /你的浏览器/ }),
    ).toBeVisible();
    await page.getByRole('button', { name: '进入 Avru', exact: true }).click();
    await expect(page.locator('.overview')).toBeVisible();
    await expect(page.locator('.install')).toHaveCount(0);
    await page.getByRole('button', { name: /添加浏览器/ }).click();
    await expect(page.locator('.install')).toContainText('chrome://extensions');
    await expect(page.locator('.install')).toContainText('edge://extensions');
    await expect(page.locator('.install')).not.toContainText('未检测到');
    await page.getByRole('button', { name: '系统总览' }).click();
    const first = await openProfile(join(directory, 'first'));
    contexts.push(first);
    const one = await waitForProfile(first, page);
    const second = await openProfile(join(directory, 'second'));
    contexts.push(second);
    const two = await waitForProfile(second, page);
    expect(one.id).not.toBe(two.id);
    await openObservedTab(first.context, 'First observed page');
    await openObservedTab(second.context, 'Second observed page');
    await page.getByRole('button', { name: '浏览器', exact: true }).click();
    const firstRow = page
      .getByRole('row')
      .filter({ has: page.getByText(one.name, { exact: true }) });
    const secondRow = page
      .getByRole('row')
      .filter({ has: page.getByText(two.name, { exact: true }) });
    await firstRow.locator('summary').click();
    await secondRow.locator('summary').click();
    await expect(
      page.getByText('First observed page', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Second observed page', { exact: true }),
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText('private=value');
    await expect(page.locator('body')).not.toContainText('核对码');
    await page.screenshot({
      path: testInfo.outputPath('management-local-auto.png'),
      fullPage: true,
    });
    await first.context.close();
    contexts.shift();
    await expect
      .poll(
        async () =>
          (await readProfiles(page, endpoint)).browsers.find(
            (item) => item.id === one.id,
          )?.connected,
      )
      .toBe(false);
    const restored = await openProfile(join(directory, 'first'));
    contexts.push(restored);
    expect((await waitForProfile(restored, page)).id).toBe(one.id);
    await daemon.stop();
    daemon = await startDaemon(join(directory, 'data'));
    await page.reload();
    await page.getByRole('button', { name: '进入 Avru', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await readProfiles(page, endpoint)).browsers.filter(
            (item) => item.connected,
          ).length,
        { timeout: 25000 },
      )
      .toBe(2);
    expect((await readProfiles(page, endpoint)).browsers).toHaveLength(2);
  } finally {
    for (const profile of contexts) await profile.context.close();
    await daemon.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
