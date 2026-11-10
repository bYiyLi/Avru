import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Check visual feedback after the genuine QuickJS→extension→CDP path. */
export async function verifyVisualFollow(
  tab: Page,
  selected: () => Promise<boolean>,
): Promise<void> {
  await expect.poll(selected).toBe(true);
  await expect(tab.locator('link[data-avru-badge]')).toHaveCount(1);
  const badge = await tab.locator('link[data-avru-badge]').getAttribute('href');
  expect(decodeURIComponent(badge ?? '')).toContain('<circle');
  await expect
    .poll(() =>
      tab.evaluate(() => {
        const pointer = document.querySelector(
          '[aria-hidden="true"]',
        )?.firstElementChild;
        return pointer instanceof HTMLElement ? pointer.style.opacity : null;
      }),
    )
    .toBe('0');
}
