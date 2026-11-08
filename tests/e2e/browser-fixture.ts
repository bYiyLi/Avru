import { chromium, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { resolve } from 'node:path';
import { testPort, testChannel, testPackage } from './daemon-fixture.js';

export const endpoint = `http://127.0.0.1:${String(testPort)}`;
export async function openProfile(
  directory: string,
  locale = 'zh-CN',
  extension = process.env.AVRU_E2E_PACKAGE_ROOT
    ? resolve(process.env.AVRU_E2E_PACKAGE_ROOT, 'payload/extension')
    : testChannel === 'prod'
      ? resolve(testPackage, 'payload/extension')
      : resolve('apps/extension/.output/dev/chrome-mv3'),
) {
  const context = await chromium.launchPersistentContext(directory, {
    channel: 'chromium',
    locale,
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
  });
  try {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker', { timeout: 15000 }));
    return { context, worker };
  } catch (error) {
    await context.close();
    throw error;
  }
}
export async function waitForProfile(
  profile: Awaited<ReturnType<typeof openProfile>>,
  management: Page,
) {
  let browserId = '';
  await expect
    .poll(async () => {
      browserId = await profile.worker.evaluate<string>(
        "chrome.storage.local.get('connection').then(value => value.connection?.browserId ?? '')",
      );
      return browserId;
    })
    .not.toBe('');
  await expect
    .poll(async () =>
      (await readProfiles(management, endpoint)).browsers.some(
        (item) => item.id === browserId && item.connected,
      ),
    )
    .toBe(true);
  const item = (await readProfiles(management, endpoint)).browsers.find(
    (item) => item.id === browserId,
  );
  if (!item) throw new Error('Missing automatic registration');
  return item;
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

export async function readProfiles(page: Page, managementUrl: string) {
  const key = new URLSearchParams(new URL(managementUrl).hash.slice(1)).get(
    'key',
  );
  const response = await page.request.get(`${endpoint}/api/browsers`, {
    headers: { Authorization: `Bearer ${key ?? ''}` },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as {
    browsers: {
      id: string;
      name: string;
      connected: boolean;
      metadata: null | {
        browserVersion: string;
        extensionVersion: string;
      };
    }[];
  };
}

export async function externalMessage(page: Page, message: unknown) {
  return page.evaluate(
    ({ id, message }) => {
      const runtime = (
        window as unknown as {
          chrome: {
            runtime: {
              lastError?: unknown;
              sendMessage(
                id: string,
                message: unknown,
                callback: (reply: unknown) => void,
              ): void;
            };
          };
        }
      ).chrome.runtime;
      return new Promise<unknown>((resolve) => {
        runtime.sendMessage(id, message, (reply) => {
          resolve(runtime.lastError ? { error: true } : reply);
        });
      });
    },
    { id: 'cbjgomelhiahmdadpkeijpbkldblanei', message },
  );
}
