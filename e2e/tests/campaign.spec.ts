import { test, expect, Page } from '@playwright/test';

async function boot(page: Page) {
  await page.goto('/');
  await page.waitForTimeout(1500);
  // click through the boot screen (loading → ready → desktop)
  for (let i = 0; i < 3; i++) {
    const boot = page.locator('.boot');
    if (await boot.count()) { await boot.click({ force: true }); await page.waitForTimeout(500); }
  }
  await expect(page.locator('.menubar')).toBeVisible();
}

test('boot → desktop → name company → first mission → mail trigger', async ({ page }) => {
  await boot(page);
  // company modal
  const nameInput = page.locator('.modal input[type=text]');
  await expect(nameInput).toBeVisible();
  await nameInput.fill('E2E Shop');
  await page.locator('.modal .btn.primary').click();
  await expect(page.locator('.menubar .pill', { hasText: 'E2E Shop' })).toBeVisible();

  // mission dock shows the first mission and a Next button
  const dock = page.locator('.mission-dock');
  await expect(dock).toContainText(/Act 1|Акт 1/);
  await dock.locator('.btn.primary').first().click();
  await page.waitForTimeout(800);

  // the trigger email arrives
  await page.locator('.dicon', { hasText: 'Mail' }).dblclick();
  await expect(page.locator('.window', { hasText: 'Mail' })).toBeVisible();
});

test('windows can be opened, tiled and closed', async ({ page }) => {
  await boot(page);
  const modal = page.locator('.modal input[type=text]');
  if (await modal.count()) { await modal.fill('WinTest'); await page.locator('.modal .btn.primary').click(); }
  await page.locator('.dicon', { hasText: 'Terminal' }).dblclick();
  await page.locator('.dicon', { hasText: 'Files' }).dblclick();
  await expect(page.locator('.window')).toHaveCount(3, { timeout: 8000 }); // mail + terminal + files
  // tile via the Windows menu
  await page.locator('.menu-item', { hasText: /Windows|Окна/ }).click();
  await page.locator('.menu-drop button', { hasText: /Tile|Плиткой/ }).click();
  // close the terminal window
  await page.locator('.window', { hasText: 'Terminal' }).locator('.t-btn', { hasText: '✕' }).click();
  await expect(page.locator('.window', { hasText: 'Terminal' })).toHaveCount(0);
});

test('language switches to Russian and back', async ({ page }) => {
  await boot(page);
  const modal = page.locator('.modal input[type=text]');
  if (await modal.count()) { await modal.fill('Lang'); await page.locator('.modal .btn.primary').click(); }
  await page.locator('.menu-item', { hasText: 'EN' }).click();
  await page.locator('.menu-drop button', { hasText: 'Русский' }).click();
  await expect(page.locator('.menubar')).toContainText('Программы');
  await page.locator('.menu-item', { hasText: 'RU' }).click();
  await page.locator('.menu-drop button', { hasText: 'English' }).click();
  await expect(page.locator('.menubar')).toContainText('Apps');
});
