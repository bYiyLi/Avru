import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { install } from '../../apps/cli/src/install.js';
import { startDaemon, testPackage, testChannel } from './daemon-fixture.js';
import {
  openProfile,
  waitForProfile,
  readProfiles,
} from './browser-fixture.js';

test.use({ locale: 'zh-CN' });
test('package upgrade preserves pairing and reports the running version until browser restart', async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'avru-extension-upgrade-'));
  const data = join(root, 'dev');
  const options = {
    root: data,
    sourceRoot: resolve(testPackage, 'payload'),
    version: testChannel === 'prod' ? '0.1.0' : '0.1.0-dev.1',
    channel: testChannel,
    execPath: process.execPath,
    hooks: {
      stop: async () => {},
      start: () => Promise.resolve('unused-test-url'),
      autostart: async () => {},
      open: async () => {},
    },
  } satisfies Parameters<typeof install>[0];
  let daemon: Awaited<ReturnType<typeof startDaemon>> | undefined;
  let profile: Awaited<ReturnType<typeof openProfile>> | undefined;
  try {
    await install(options);
    const extension = join(data, 'extension');
    const manifestPath = join(extension, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<
      string,
      unknown
    >;
    // A real browser loads this older fixture; production payload and candidate remain untouched.
    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, version: '0.0.0' }),
    );
    daemon = await startDaemon(data);
    profile = await openProfile(join(root, 'browser'), 'zh-CN', extension);
    await page.goto(daemon.url);
    await page.getByRole('button', { name: '进入 Avru', exact: true }).click();
    await waitForProfile(profile, page);
    await page.getByRole('button', { name: '浏览器', exact: true }).click();
    await expect(page.getByText('建议更新', { exact: true })).toBeVisible();
    await daemon.stop();
    await install(options);
    expect(JSON.parse(await readFile(manifestPath, 'utf8'))).toMatchObject({
      version: '0.0.1',
    });
    daemon = await startDaemon(data);
    const current = daemon;
    await page.goto(current.url);
    await page.getByRole('button', { name: '进入 Avru', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await readProfiles(page, current.url)).browsers[0]?.metadata
            ?.extensionVersion,
        { timeout: 20000 },
      )
      .toBe('0.0.0');
    await page.getByRole('button', { name: '浏览器', exact: true }).click();
    await expect(page.getByText('建议更新', { exact: true })).toBeVisible();
    // Restart the same real browser profile to load the updated files and recover its saved pairing.
    await profile.context.close();
    profile = await openProfile(join(root, 'browser'), 'zh-CN', extension);
    await expect
      .poll(
        async () =>
          (await readProfiles(page, current.url)).browsers[0]?.metadata
            ?.extensionVersion,
        { timeout: 20000 },
      )
      .toBe('0.0.1');
    await expect(page.getByText('一致', { exact: true })).toBeVisible();
    expect((await readProfiles(page, current.url)).browsers).toHaveLength(1);
  } finally {
    await profile?.context.close();
    await daemon?.stop();
    await rm(root, { recursive: true, force: true });
  }
});
