import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openProfile } from './browser-fixture.js';

test('extension popup follows the preferred language with translated accessible controls', async () => {
  for (const locale of ['en-US', 'zh-TW', 'fr-FR']) {
    const directory = await mkdtemp(join(tmpdir(), 'avru-i18n-'));
    const { context, popup } = await openProfile(directory, locale);
    try {
      const chinese = locale.startsWith('zh');
      await expect(popup.locator('html')).toHaveAttribute(
        'lang',
        chinese ? 'zh' : 'en',
      );
      await expect(popup).toHaveTitle(
        chinese ? 'Avru 浏览器连接' : 'Avru browser connection',
      );
      await expect(
        popup.getByRole('button', {
          name: chinese ? '配对' : 'Pair',
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        popup.getByRole('textbox', {
          name: chinese ? '浏览器 / 配置名称' : 'Browser / profile name',
        }),
      ).toBeVisible();
      await expect(popup.getByRole('status')).toHaveText(
        chinese ? '未配对' : 'Not paired',
      );
    } finally {
      await context.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
});
