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
} from './browser-fixture.js';

test('two real extension profiles pair, observe, reconnect and revoke', async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'avru-e2e-'));
  let daemon = await startDaemon(join(directory, 'data'));
  const profiles: Awaited<ReturnType<typeof openProfile>>[] = [];
  try {
    await page.goto(daemon.url);
    await expect(page).toHaveURL(`${endpoint}/`);
    const first = await openProfile(join(directory, 'first'));
    profiles.push(first);
    await pairProfile(first.popup, page, 'Profile One');
    const second = await openProfile(join(directory, 'second'));
    profiles.push(second);
    await pairProfile(second.popup, page, 'Profile Two');
    await openObservedTab(first.context, 'First observed page');
    await openObservedTab(second.context, 'Second observed page');
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
    await first.context.close();
    profiles.shift();
    await expect(
      page.getByText('First observed page', { exact: true }),
    ).toHaveCount(0);
    const restored = await openProfile(join(directory, 'first'));
    profiles.push(restored);
    await openObservedTab(restored.context, 'Restored profile page');
    await expect(
      page.getByText('Restored profile page', { exact: true }),
    ).toBeVisible();
    await daemon.stop();
    daemon = await startDaemon(join(directory, 'data'));
    await page.goto(daemon.url);
    await expect(
      page.getByText('Restored profile page', { exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByText('Second observed page', { exact: true }),
    ).toBeVisible();
    const firstSection = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Profile One', exact: true }),
    });
    await firstSection
      .getByRole('button', { name: '撤销此浏览器配对' })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Profile One', exact: true }),
    ).toHaveCount(0);
    await expect(restored.popup.getByRole('status')).not.toContainText(
      '已连接',
    );
  } finally {
    for (const profile of profiles) await profile.context.close();
    await daemon.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
