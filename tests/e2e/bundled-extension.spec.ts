import { expect, test } from '@playwright/test';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { install } from '../../apps/cli/src/install.js';
import { startDaemon } from './daemon-fixture.js';
import { openProfile } from './browser-fixture.js';
test.use({ locale: 'en-US' });
test('packaged extension loads from stable directory after package cache removal', async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'avru-bundled-extension-'));
  let daemon: Awaited<ReturnType<typeof startDaemon>> | undefined;
  let profile: Awaited<ReturnType<typeof openProfile>> | undefined;
  try {
    const cache = join(root, 'cache');
    await cp(resolve('artifacts/avru/payload'), cache, { recursive: true });
    const data = join(root, 'dev');
    await install({
      root: data,
      sourceRoot: cache,
      version: '0.1.0-dev.1',
      execPath: process.execPath,
      hooks: {
        stop: async () => {},
        start: () => Promise.resolve('unused-test-url'),
        autostart: async () => {},
        open: async () => {},
      },
    });
    await rm(cache, { recursive: true });
    const extension = join(data, 'extension');
    daemon = await startDaemon(data);
    await page.goto(daemon.url);
    await page.getByRole('button', { name: 'Enter Avru' }).click();
    await expect(page.getByLabel('Prepared extension folder')).toHaveText(
      extension,
    );
    await expect(
      page.getByText(/Extension files 0.0.1 are ready/),
    ).toBeVisible();
    profile = await openProfile(join(root, 'browser'), 'zh-CN', extension);
    await expect(profile.popup).toHaveURL(
      'chrome-extension://cbjgomelhiahmdadpkeijpbkldblanei/popup.html',
    );
    await expect(profile.popup.locator('[name="endpoint"]')).toHaveValue(
      'http://127.0.0.1:43822',
    );
    expect(await readFile(join(extension, 'manifest.json'), 'utf8')).toContain(
      '0.0.1',
    );
  } finally {
    await profile?.context.close();
    await daemon?.stop();
    await rm(root, { recursive: true, force: true });
  }
});
