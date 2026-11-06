import { expect, test } from '@playwright/test';
import { signIn, startMockWorkspaceApi, type MockWorkspaceApi } from './mock-workspace-api';

/**
 * The Desk's Theme card picks the colour theme from a menu: each theme with
 * its colours, the worn one checked. The menu opens on the worn theme
 * (focused, so the arrows start there), and the keyboard picks another.
 * In-memory brain, no real one.
 */

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
});
test.afterEach(async () => {
  await api.close();
});

test('the Theme card picks a colour theme from a menu, by keyboard', async ({ page }) => {
  // The shell paints the brain's saved theme once /api/shell lands; a pick
  // made before that would be painted over.
  const shell = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/shell');
  await signIn(page, 'member');
  await shell;
  const card = page.getByRole('main').getByRole('region', { name: 'Theme', exact: true });
  const trigger = card.getByRole('button', { name: /^Colour theme: / });
  await expect(trigger).toBeVisible();
  const before = (await trigger.getAttribute('aria-label'))!.replace('Colour theme: ', '');

  await trigger.click();
  const menu = page.getByRole('menu');
  const worn = menu.getByRole('menuitemradio', { name: before, exact: true });
  await expect(worn).toHaveAttribute('aria-checked', 'true');
  await expect(worn).toBeFocused();
  await expect(worn).toBeInViewport();

  // The next theme down (or up, at the end of the list), by keyboard.
  const items = menu.getByRole('menuitemradio');
  const at = (await items.allTextContents()).indexOf(before);
  const step = at < (await items.count()) - 1 ? 'ArrowDown' : 'ArrowUp';
  const next = (await items.nth(step === 'ArrowDown' ? at + 1 : at - 1).textContent())!;
  await page.keyboard.press(step);
  // Radix moves the focus on a timer: wait for it before Enter.
  await expect(menu.getByRole('menuitemradio', { name: next, exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-label', `Colour theme: ${next}`);
});
