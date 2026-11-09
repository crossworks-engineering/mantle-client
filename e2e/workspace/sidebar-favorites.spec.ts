import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  KIND_ITEMS,
  PAGES,
  signIn,
  startMockWorkspaceApi,
  type MockWorkspaceApi,
} from './mock-workspace-api';
import { scopedNav, wholeNav } from './shell-nav';

/**
 * The sidebar's tabs and Favorites (2026-11-07): Favorites, Work and Settings
 * (called Admin until 2026-11-09), where Settings holds every setting. A favorite is a starred screen or a
 * workspace item (`/n/<id>`, from the item's "..." menu), saved on the
 * login (PUT /api/profile/nav-favorites), shown with the item's own look,
 * in the login's order. In-memory brain, no real one.
 */

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
});
test.afterEach(async () => {
  await api.close();
});

const favoriteRows = (nav: Locator) => nav.locator('[data-favorite]');
const favoriteOrder = (nav: Locator) =>
  favoriteRows(nav).evaluateAll((rows) => rows.map((r) => r.getAttribute('data-favorite')));

/** Open a favorite row's menu and pick one of its actions. */
async function favoriteAction(page: Page, nav: Locator, name: string, action: string) {
  await nav.getByRole('button', { name: `More actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: action }).click();
}

test('the tabs are Favorites, Work and Settings; Settings holds every setting', async ({
  page,
}) => {
  await signIn(page, 'admin');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByRole('radio')).toHaveText(['Favorites', 'Work', 'Settings']);
  // Work opens first.
  await expect(nav.getByRole('radio', { name: 'Work' })).toHaveAttribute('aria-checked', 'true');
  for (const name of ['Pages', 'Apps', 'Pending', 'Models']) {
    await expect(nav.getByRole('link', { name, exact: true }), name).toBeVisible();
  }
  await expect(nav.getByRole('link', { name: 'Agents', exact: true })).toHaveCount(0);

  const settings = await scopedNav(page, 'Settings');
  // Every setting, and the plumbing.
  for (const name of ['Agents', 'AI workers', 'MCP', 'Profile', 'Appearance', 'Workspaces']) {
    await expect(settings.getByRole('link', { name, exact: true }), name).toBeVisible();
  }
  for (const name of ['Backups', 'Users', 'Debug']) {
    await expect(settings.getByRole('link', { name, exact: true }), name).toBeVisible();
  }
  await expect(settings.getByRole('link', { name: 'Pages', exact: true })).toHaveCount(0);

  const favorites = await scopedNav(page, 'Favorites');
  await expect(favorites.getByTestId('favorites-empty')).toContainText('Add first favorite');
  await expect(favorites.getByRole('link')).toHaveCount(0);
});

test('a browser that chose the old Admin tab opens on Settings', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('mantle_nav_scope_v1', 'admin'));
  await signIn(page, 'admin');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByRole('radio', { name: 'Settings' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(nav.getByRole('link', { name: 'Agents', exact: true })).toBeVisible();
});

test('star a screen, favorite a page, reorder, remove', async ({ page }) => {
  await signIn(page, 'admin');
  const settings = await scopedNav(page, 'Settings');
  await settings.getByRole('link', { name: 'Agents', exact: true }).hover();
  await settings.getByRole('button', { name: 'Add Agents to favorites' }).click();
  await expect.poll(() => api.favorites.admin).toEqual(['/settings/agents']);

  // A page, from its "..." menu in the tree.
  const work = await scopedNav(page, 'Work');
  await work.getByRole('link', { name: 'Pages', exact: true }).click();
  await expect(page).toHaveURL((u) => u.pathname === '/pages');
  const handbook = PAGES.handbook;
  await page.getByRole('button', { name: `More actions for ${handbook.title}` }).click();
  await page.getByRole('menuitem', { name: 'Add to favorites' }).click();
  await expect.poll(() => api.favorites.admin).toEqual(['/settings/agents', `/n/${handbook.id}`]);

  const nav = await scopedNav(page, 'Favorites');
  const pageRow = nav.getByRole('link', { name: handbook.title, exact: true });
  await expect(pageRow).toHaveAttribute('href', `/pages/${handbook.id}`);
  await expect(nav.getByRole('link', { name: 'Agents', exact: true })).toBeVisible();
  await expect.poll(() => favoriteOrder(nav)).toEqual(['/settings/agents', `/n/${handbook.id}`]);

  // The menu says it is a favorite now.
  await page
    .getByRole('button', { name: `More actions for ${handbook.title}` })
    .first()
    .click();
  await expect(page.getByRole('menuitem', { name: 'Remove from favorites' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Reorder from the row's menu (drag does the same through moveFavorite).
  await favoriteAction(page, nav, 'Agents', 'Move down');
  await expect.poll(() => api.favorites.admin).toEqual([`/n/${handbook.id}`, '/settings/agents']);
  await expect.poll(() => favoriteOrder(nav)).toEqual([`/n/${handbook.id}`, '/settings/agents']);

  // The order survives a reload: it is the login's, on the brain.
  await page.reload();
  const again = page.getByRole('navigation', { name: 'Primary' });
  await expect(again.getByRole('radio', { name: 'Favorites' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(favoriteRows(again)).toHaveCount(2);
  await expect.poll(() => favoriteOrder(again)).toEqual([`/n/${handbook.id}`, '/settings/agents']);

  await favoriteAction(page, again, handbook.title, 'Remove from favorites');
  await favoriteAction(page, again, 'Agents', 'Remove from favorites');
  await expect.poll(() => api.favorites.admin).toEqual([]);
  await expect(again.getByTestId('favorites-empty')).toBeVisible();
});

test('an item the login can no longer open is hidden, and goes at the next save', async ({
  page,
}) => {
  const gone = '12121212-1212-4121-8121-121212121212';
  const app = KIND_ITEMS.apps[0];
  api.favorites.admin = [`/n/${gone}`, `/n/${app.id}`, '/settings/agents'];
  await signIn(page, 'admin');
  const nav = await scopedNav(page, 'Favorites');
  await expect(favoriteRows(nav)).toHaveCount(2);
  await expect(nav.getByRole('link', { name: app.title, exact: true })).toHaveAttribute(
    'href',
    `/apps/${app.id}`,
  );
  await favoriteAction(page, nav, 'Agents', 'Move up');
  await expect.poll(() => api.favorites.admin).toEqual(['/settings/agents', `/n/${app.id}`]);
});

test('a member: no tabs, Favorites first, and a page from the tree', async ({ page }) => {
  await signIn(page, 'member');
  const nav = await wholeNav(page);
  await expect(nav.getByText('Favorites', { exact: true })).toBeVisible();
  await expect(nav.getByTestId('favorites-empty')).toBeVisible();

  await nav.getByRole('link', { name: 'Pages', exact: true }).click();
  await expect(page).toHaveURL((u) => u.pathname === '/pages');
  const handbook = PAGES.handbook;
  await page.getByRole('button', { name: `More actions for ${handbook.title}` }).click();
  await page.getByRole('menuitem', { name: 'Add to favorites' }).click();
  await expect.poll(() => api.favorites.member).toEqual([`/n/${handbook.id}`]);
  await expect(nav.getByTestId('favorites-empty')).toHaveCount(0);
  await expect(nav.locator(`[data-favorite="/n/${handbook.id}"]`)).toBeVisible();
});
