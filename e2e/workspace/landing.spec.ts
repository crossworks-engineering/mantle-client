import { expect, test, type Page } from '@playwright/test';
import {
  KIND_ITEMS,
  PAGES,
  WORKSPACES,
  signIn,
  startMockWorkspaceApi,
  type MockWorkspaceApi,
} from './mock-workspace-api';
import { wholeNav } from './shell-nav';

/**
 * Each workspace's landing page (dev-brain task d78e7bde): Home shows the
 * landing page of the current workspace and changes when the login switches
 * at `/`: the Built-in home (the desk) with that workspace's pages, or the
 * home app a spec names; "All my workspaces" shows all of them. An
 * Admin user lands there too: the brain health Dashboard is in the menu.
 * In-memory brain, no real one.
 */

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
});
test.afterEach(async () => {
  await api.close();
});

const switcher = (page: Page) => page.getByRole('button', { name: /^Workspace:/ }).first();

async function pickWorkspace(page: Page, name: string) {
  await switcher(page).click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^${name}( Moderator)?$`) }).click();
}

/** The `ws` of every landing page the login asked for, in order (null: all). */
const homeWs = (role: 'admin' | 'member') =>
  api.requests
    .filter((r) => r.role === role && r.method === 'GET' && r.path === '/api/home')
    .map((r) => new URLSearchParams(r.query).get('ws'));

/** The desk's Pages widget: pins first, then the workspace's newest pages. */
const newest = (page: Page) => page.getByRole('main').getByRole('region', { name: 'Pages' });

test('an Admin user switches at Desk: the landing page follows the pick', async ({ page }) => {
  await signIn(page, 'admin');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Desk', level: 1 })).toBeVisible();
  // No Dashboard at Home any more.
  await expect(main.getByRole('link', { name: 'Operator view' })).toHaveCount(0);

  // All my workspaces: every workspace's pages.
  await expect(main.getByText('All my workspaces', { exact: true })).toBeVisible();
  for (const p of [PAGES.policy, PAGES.handbook]) {
    await expect(newest(page).getByText(p.title, { exact: true }), p.title).toBeVisible();
  }
  expect(homeWs('admin')).toEqual([null]);

  // Team: Team's pages only.
  await pickWorkspace(page, WORKSPACES.team.name);
  await expect(main.getByText(WORKSPACES.team.name, { exact: true }).first()).toBeVisible();
  await expect(newest(page).getByText(PAGES.handbook.title, { exact: true })).toBeVisible();
  await expect(newest(page).getByText(PAGES.policy.title, { exact: true })).toHaveCount(0);
  expect(homeWs('admin')).toContain(WORKSPACES.team.id);

  // Admin: its own, and no Team page.
  await pickWorkspace(page, WORKSPACES.admin.name);
  await expect(newest(page).getByText(PAGES.policy.title, { exact: true })).toBeVisible();
  await expect(newest(page).getByText(PAGES.handbook.title, { exact: true })).toHaveCount(0);
  expect(homeWs('admin')).toContain(WORKSPACES.admin.id);

  // Back to all of them.
  await pickWorkspace(page, 'All my workspaces');
  await expect(newest(page).getByText(PAGES.handbook.title, { exact: true })).toBeVisible();
  await expect(newest(page).getByText(PAGES.policy.title, { exact: true })).toBeVisible();
});

test('the Dashboard is in the menu, and opens on its own screen', async ({ page }) => {
  await signIn(page, 'admin');
  const nav = await wholeNav(page, 'admin');
  await expect(nav.getByRole('link', { name: 'Desk', exact: true })).toBeVisible();
  await nav.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page).toHaveURL((u) => u.pathname === '/dashboard');
  await expect(page.getByRole('main').getByRole('link', { name: 'Operator view' })).toBeVisible();
});

test('a member lands on its workspace, and never on one it is not in', async ({ page }) => {
  await signIn(page, 'member');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Desk', level: 1 })).toBeVisible();
  // Its own workspaces only, even under All my workspaces.
  await expect(newest(page).getByText(PAGES.handbook.title, { exact: true })).toBeVisible();
  await expect(newest(page).getByText(PAGES.minutes.title, { exact: true })).toHaveCount(0);
  await pickWorkspace(page, WORKSPACES.field.name);
  await expect(newest(page).getByText(PAGES.survey.title, { exact: true })).toBeVisible();
  await expect(newest(page).getByText(PAGES.handbook.title, { exact: true })).toHaveCount(0);
  expect(homeWs('member')).toEqual([null, WORKSPACES.field.id]);
  // The member never asks for the Dashboard or the old member home.
  expect(api.asked('member')).not.toContain('GET /api/dashboard');
  expect(api.asked('member')).not.toContain('GET /api/member/home');
});

test("a workspace's home app fills Desk, with a toggle to the built-in Desk", async ({ page }) => {
  api.homeApps.team = { id: KIND_ITEMS.apps[1].id, title: 'Team board', frame: true };
  await signIn(page, 'admin');
  await pickWorkspace(page, WORKSPACES.team.name);
  const main = page.getByRole('main');
  const app = main.getByRole('button', { name: 'Team board' });
  const builtIn = main.getByRole('button', { name: 'Desk', exact: true });
  await expect(app).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() => api.asked('admin'))
    .toContain(`POST /api/apps/${KIND_ITEMS.apps[1].id}/frame-ticket`);
  await expect(newest(page)).toHaveCount(0);
  // The toggle: the Built-in home with Team's data, then the app again.
  await builtIn.click();
  await expect(newest(page).getByText(PAGES.handbook.title, { exact: true })).toBeVisible();
  await app.click();
  await expect(newest(page)).toHaveCount(0);
  // Another workspace has none: its Built-in home, no toggle.
  await pickWorkspace(page, WORKSPACES.admin.name);
  await expect(newest(page).getByText(PAGES.policy.title, { exact: true })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Team board' })).toHaveCount(0);
});

test('a home app that does not load falls back to the built-in Desk', async ({ page }) => {
  api.homeApps.team = { id: KIND_ITEMS.apps[1].id, title: 'Team board', frame: false };
  await signIn(page, 'admin');
  await pickWorkspace(page, WORKSPACES.team.name);
  await expect
    .poll(() => api.asked('admin'))
    .toContain(`POST /api/apps/${KIND_ITEMS.apps[1].id}/frame-ticket`);
  await expect(newest(page).getByText(PAGES.handbook.title, { exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByRole('button', { name: 'Team board' })).toHaveCount(0);
});

test('a member is refused the Dashboard', async ({ page }) => {
  await signIn(page, 'member');
  await page.goto('/dashboard');
  await expect(page.getByText('You cannot manage this part of the brain.')).toBeVisible();
  expect(api.asked('member')).not.toContain('GET /api/dashboard');
});
