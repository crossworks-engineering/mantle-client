import { expect, test } from '@playwright/test';
import { signIn, startMockWorkspaceApi, type MockWorkspaceApi } from './mock-workspace-api';

/**
 * The "Update In Progress" notice: on, every signed-in page shows it full
 * screen and nothing closes it; the brain going down keeps it up; the brain
 * back on a new version with it off reloads the page without it. The sign-in
 * page shows it too. In-memory brain (mock-workspace-api.ts), no real one.
 */

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
});
test.afterEach(async () => {
  await api.close();
});

const notice = (page: import('@playwright/test').Page) =>
  page.getByRole('alertdialog', { name: 'Update In Progress' });

test('on, down, then back on a new version: it stays up, then the page reloads without it', async ({
  page,
}) => {
  api.updateNotice = { on: false, version: '1.0.0' };
  await signIn(page, 'admin');
  await expect(notice(page)).toHaveCount(0);

  api.updateNotice = { on: true, version: '1.0.0' };
  // A reload asks at once; a page already open asks within 15 s.
  await page.reload();
  await expect(notice(page)).toBeVisible();
  await expect(notice(page).getByText('Getting ready')).toBeVisible();
  await expect(notice(page).getByRole('progressbar')).toBeVisible();
  await expect(notice(page).getByRole('button')).toHaveCount(0);
  await expect(notice(page).getByRole('link')).toHaveCount(0);

  // Nothing closes it.
  await page.keyboard.press('Escape');
  await page.mouse.click(8, 8);
  await expect(notice(page)).toBeVisible();
  await expect(page).toHaveURL((u) => u.pathname === '/');

  // The box goes down: it stays, and says it is restarting.
  api.down = true;
  await expect(notice(page).getByText('Restarting services')).toBeVisible({ timeout: 15_000 });
  await expect(notice(page)).toBeVisible();

  // Back, on a new version, and off: the page reloads, with no notice.
  await page.evaluate(() => {
    (window as unknown as { beforeRoll?: boolean }).beforeRoll = true;
  });
  const reloaded = page.waitForEvent('load', { timeout: 20_000 });
  api.down = false;
  api.updateNotice = { on: false, version: '1.0.1' };
  await reloaded;
  await expect(notice(page)).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { beforeRoll?: boolean }).beforeRoll ?? null),
  ).toBeNull();
});

test('a page opened while the brain is down shows it from the last answer', async ({ page }) => {
  api.updateNotice = { on: false, version: '1.0.0' };
  await signIn(page, 'admin');
  api.updateNotice = { on: true, version: '1.0.0' };
  await page.reload();
  await expect(notice(page)).toBeVisible();
  api.down = true;
  await page.reload();
  await expect(notice(page)).toBeVisible();
  await expect(notice(page).getByText('Restarting services')).toBeVisible();
});

test('off on the same version: it goes, and the page reloads (the interface may have rolled)', async ({
  page,
}) => {
  api.updateNotice = { on: false, version: '1.0.0' };
  await signIn(page, 'admin');
  api.updateNotice = { on: true, version: '1.0.0' };
  await page.reload();
  await expect(notice(page)).toBeVisible();
  const reloaded = page.waitForEvent('load', { timeout: 20_000 });
  api.updateNotice = { on: false, version: '1.0.0' };
  await reloaded;
  await expect(notice(page)).toHaveCount(0);
});

test('the sign-in page shows it too, and blocks it', async ({ page }) => {
  api.updateNotice = { on: true, version: '1.0.0' };
  await page.goto('/login');
  await expect(notice(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
});

test('a brain without the route shows nothing', async ({ page }) => {
  api.updateNotice = null;
  await signIn(page, 'member');
  await expect(page.getByRole('main')).toBeVisible();
  await expect(notice(page)).toHaveCount(0);
  expect(api.requests.some((r) => r.path === '/api/update-notice')).toBe(true);
});
