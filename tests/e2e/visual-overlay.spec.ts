import { chromium, expect, test } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('real Chrome content script paints the cursor and restores task favicon state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'avru-visual-'));
  const extension = resolve('apps/extension/.output/prod/chrome-mv3');
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(directory, {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    });
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
    const page = await context.newPage();
    await page.route('https://avru.example/visual', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head><title>Visual test</title>
          <link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E">
          </head><body><button id="target">Click me</button></body></html>`,
      });
    });
    await page.goto('https://avru.example/visual');
    const findTabId = () =>
      worker.evaluate<number | null>(
        "chrome.tabs.query({url:'https://avru.example/visual'}).then(tabs=>tabs[0]?.id??null)",
      );
    await expect.poll(findTabId, { timeout: 10_000 }).not.toBeNull();
    // Poll assertions do not return the checked value, so select it explicitly.
    const targetId = await findTabId();
    expect(targetId).toBeDefined();
    if (targetId === null) throw new Error('Missing browser tab');

    const send = (message: Record<string, unknown>) =>
      worker.evaluate<
        { ok: boolean },
        { tabId: number; message: Record<string, unknown> }
      >(
        ({ tabId, message }) => {
          const extension = globalThis as unknown as {
            chrome: {
              tabs: {
                sendMessage(
                  id: number,
                  input: Record<string, unknown>,
                ): Promise<{ ok: boolean }>;
              };
            };
          };
          return extension.chrome.tabs.sendMessage(tabId, message);
        },
        { tabId: targetId, message },
      );
    await expect
      .poll(async () => {
        try {
          return await send({ type: 'avru.cursor', x: 35, y: 45 });
        } catch {
          return null;
        }
      })
      .toEqual({ ok: true });
    const position = await page.evaluate(() => {
      const root = document.querySelector('[aria-hidden="true"]');
      const marker = root?.firstElementChild;
      if (!(root instanceof HTMLElement) || !(marker instanceof HTMLElement))
        return null;
      return {
        hostPointerEvents: root.style.pointerEvents,
        markerPointerEvents: marker.style.pointerEvents,
        opacity: marker.style.opacity,
        transform: marker.style.transform,
      };
    });
    expect(position).toEqual({
      hostPointerEvents: 'none',
      markerPointerEvents: 'none',
      opacity: '1',
      transform: 'translate3d(35px, 45px, 0px)',
    });
    expect(await page.locator('#target').isVisible()).toBe(true);

    expect(
      await send({
        type: 'avru.favicon.status',
        taskId: 't-1',
        status: 'active',
      }),
    ).toEqual({ ok: true });
    await expect(page.locator('link[data-avru-badge]')).toHaveCount(1);
    const active = await page
      .locator('link[data-avru-badge]')
      .getAttribute('href');
    expect(decodeURIComponent(active ?? '')).toContain('opacity=".5"');
    expect(
      await send({
        type: 'avru.favicon.status',
        taskId: 't-1',
        status: 'done',
      }),
    ).toEqual({ ok: true });
    expect(
      decodeURIComponent(
        (await page.locator('link[data-avru-badge]').getAttribute('href')) ??
          '',
      ),
    ).toContain('<circle');

    // The worker persists the result, and the content script restores it after reload.
    await worker.evaluate((id) => {
      const extension = globalThis as unknown as {
        chrome: {
          storage: {
            local: { set(items: Record<string, unknown>): Promise<void> };
          };
        };
      };
      return extension.chrome.storage.local.set({
        'avru.favicon.states': {
          [String(id)]: { status: 'done', taskId: 't-1' },
        },
      });
    }, targetId);
    await page.reload();
    await expect(page.locator('link[data-avru-badge]')).toHaveCount(1);

    const alternate = await context.newPage();
    await alternate.goto('about:blank');
    await page.bringToFront();
    await expect(page.locator('link[data-avru-badge]')).toHaveCount(0);
    const cleared = await worker.evaluate<Record<string, unknown>>(
      "chrome.storage.local.get('avru.favicon.states').then(state=>state['avru.favicon.states'])",
    );
    expect(cleared).toEqual({});
  } finally {
    await context?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
