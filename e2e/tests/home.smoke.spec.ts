import { test, expect } from '@playwright/test';

test.describe('home smoke', () => {
  test('loads plaza / home shell', async ({ page }) => {
    await page.goto('/home', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/home/);
    // App shell should paint (avoid brittle copy that changes with i18n).
    await expect(page.locator('body')).toBeVisible();
    const root = page.locator('#root, [data-testid="app-root"], main').first();
    await expect(root).toBeVisible({ timeout: 30_000 });
  });
});
