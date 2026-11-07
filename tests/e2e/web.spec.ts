import { expect, test } from '@playwright/test';
test('management scaffold does not claim browser readiness', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '浏览器控制工作台' }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText('尚未实现');
});
