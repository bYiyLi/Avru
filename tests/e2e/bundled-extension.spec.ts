import { expect, test } from '@playwright/test';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { install } from '../../apps/cli/src/install.js';
import { startDaemon } from './daemon-fixture.js';
import { openProfile, externalMessage } from './browser-fixture.js';
test.use({ locale: 'en-US' });
test('packaged extension loads from stable directory after package cache removal', async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'avru-bundled-extension-'));
  let daemon: Awaited<ReturnType<typeof startDaemon>> | undefined;
  let second: Awaited<ReturnType<typeof openProfile>> | undefined;
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
    const worker = profile.context.serviceWorkers()[0];
    await worker?.evaluate(`chrome.runtime.onMessageExternal.addListener((_message, sender) => {
      let url; try { url = new URL(sender.url); } catch {}
      globalThis.__avruSenderShape = { idPresent: sender.id !== undefined, origin: sender.origin, urlOrigin: url?.origin, pathname: url?.pathname, hashPresent: Boolean(url?.hash), frameId: sender.frameId, documentPresent: typeof sender.documentId === 'string', tabIdPresent: typeof sender.tab?.id === 'number', incognito: sender.tab?.incognito };
    })`);
    const management = await profile.context.newPage();
    await management.goto(daemon.url);
    await management.getByRole('button', { name: '进入 Avru' }).click();
    await expect
      .poll(async () => worker?.evaluate('globalThis.__avruSenderShape'))
      .toEqual(
        expect.objectContaining({
          hashPresent: false,
          frameId: 0,
          documentPresent: true,
        }),
      );

    await expect(management.getByRole('status')).toContainText(
      '当前浏览器已连接',
    );
    // Another browser being online must not satisfy current-page detection.
    await expect(page.getByRole('status')).toContainText(
      'No extension response yet',
    );
    const key = new URLSearchParams(new URL(daemon.url).hash.slice(1)).get(
      'key',
    );
    second = await openProfile(
      join(root, 'second-browser'),
      'en-US',
      extension,
    );
    const secondPage = await second.context.newPage();
    await secondPage.goto(daemon.url);
    await expect(
      secondPage.getByRole('button', { name: 'Enter Avru' }),
    ).toBeVisible();
    // A navigation invalidates the extension-side document binding.
    const old = (await externalMessage(secondPage, { type: 'avru-probe' })) as {
      challenge: string;
    };
    expect(old.challenge).toMatch(/^[a-f0-9]{64}$/);
    const issued = await secondPage.request.post(
      'http://127.0.0.1:43822/api/connection-ticket',
      {
        headers: {
          Authorization: `Bearer ${key ?? ''}`,
          Origin: 'http://127.0.0.1:43822',
        },
        data: { challenge: old.challenge },
      },
    );
    const oneUse = (await issued.json()) as { ticket: string };
    await secondPage.reload();
    expect(
      await externalMessage(secondPage, {
        type: 'avru-redeem',
        challenge: old.challenge,
        ticket: oneUse.ticket,
      }),
    ).toEqual({ error: 'unavailable' });
    await secondPage.getByRole('button', { name: 'Enter Avru' }).click();
    await expect(secondPage.getByRole('status')).toContainText(
      'This browser is connected',
    );

    const browsers = await management.request.get(
      'http://127.0.0.1:43822/api/browsers',
      { headers: { Authorization: `Bearer ${key ?? ''}` } },
    );
    const connected = (await browsers.json()) as {
      browsers: { id: string; connected: boolean }[];
    };
    expect(connected.browsers).toHaveLength(2);
    expect(connected.browsers.every((item) => item.connected)).toBe(true);
    const wrongPort = await second.context.newPage();
    await wrongPort.route('http://127.0.0.1:43823/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<title>Untrusted local origin</title>',
      }),
    );
    await wrongPort.goto('http://127.0.0.1:43823/');
    expect(await externalMessage(wrongPort, { type: 'avru-detect' })).toEqual({
      error: true,
    });
    await wrongPort.close();
    // Revoke both, then revisit setup: neither extension silently reenrolls.
    for (const item of connected.browsers) {
      const response = await management.request.delete(
        `http://127.0.0.1:43822/api/browsers/${item.id}`,
        {
          headers: {
            Authorization: `Bearer ${key ?? ''}`,
            Origin: 'http://127.0.0.1:43822',
          },
        },
      );
      expect(response.status()).toBe(204);
    }
    await expect(secondPage.getByRole('status')).toContainText(
      'automatic connection disabled',
    );
    await secondPage.reload();
    await secondPage.getByRole('button', { name: 'Enter Avru' }).click();
    await expect(secondPage.getByRole('status')).toContainText(
      'automatic connection disabled',
    );
    const after = await secondPage.request.get(
      'http://127.0.0.1:43822/api/browsers',
      { headers: { Authorization: `Bearer ${key ?? ''}` } },
    );
    expect(
      ((await after.json()) as { browsers: unknown[] }).browsers,
    ).toHaveLength(0);
    expect(await readFile(join(extension, 'manifest.json'), 'utf8')).toContain(
      '0.0.1',
    );
  } finally {
    await second?.context.close();
    await profile?.context.close();
    await daemon?.stop();
    await rm(root, { recursive: true, force: true });
  }
});
