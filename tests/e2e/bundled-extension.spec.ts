import { expect, test } from '@playwright/test';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { install } from '../../apps/cli/src/install.js';
import { startDaemon, testChannel, testPackage } from './daemon-fixture.js';
import { endpoint, openProfile, waitForProfile } from './browser-fixture.js';

test.use({ locale: 'en-US' });
test('packaged extension loads from stable directory with no popup or browser prechecks', async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'avru-bundle-auto-'));
  let daemon: Awaited<ReturnType<typeof startDaemon>> | undefined;
  let profile: Awaited<ReturnType<typeof openProfile>> | undefined;
  try {
    const cache = join(root, 'cache');
    await cp(resolve(testPackage, 'payload'), cache, { recursive: true });
    const data = join(root, testChannel);
    await install({
      root: data,
      channel: testChannel,
      sourceRoot: cache,
      version: testChannel === 'dev' ? '0.1.0-dev.1' : '0.1.0',
      execPath: process.execPath,
      hooks: {
        stop: async () => {},
        start: () => Promise.resolve('test'),
        autostart: async () => {},
        open: async () => {},
      },
    });
    await rm(cache, { recursive: true });
    daemon = await startDaemon(data);
    await page.goto(endpoint);
    await page.getByRole('button', { name: 'Enter Avru', exact: true }).click();
    await expect(page.locator('.overview')).toBeVisible();
    await page.getByRole('button', { name: /Add browser/ }).click();
    await expect(page.locator('.install')).toContainText('chrome://extensions');
    await expect(page.locator('.install')).toContainText('edge://extensions');
    await page.getByRole('button', { name: /Prepare to load/ }).click();
    const extension = join(data, 'extension');
    await expect(page.getByLabel('Prepared extension folder')).toHaveText(
      extension,
    );
    profile = await openProfile(join(root, 'browser'), 'zh-CN', extension);
    await waitForProfile(profile, page);
    const manifest = JSON.parse(
      await readFile(join(extension, 'manifest.json'), 'utf8'),
    ) as { action: { default_popup?: string } };
    expect(manifest.action.default_popup).toBeUndefined();
    await expect(page.locator('.install')).not.toContainText(
      'No extension response',
    );
  } finally {
    await profile?.context.close();
    await daemon?.stop();
    await rm(root, { recursive: true, force: true });
  }
});
