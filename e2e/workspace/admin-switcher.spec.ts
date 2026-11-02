import { expect, test, type Page } from '@playwright/test';
import {
  KIND_ITEMS,
  PAGES,
  WORKSPACES,
  signIn,
  startMockWorkspaceApi,
  type MockWorkspaceApi,
} from './mock-workspace-api';

/**
 * An Admin user who is also in Team switches workspace (dev-brain task
 * fc3b47ed): the switcher's label follows the pick, the lists load again
 * with the new `?ws=`, and a create names it. Then back to Admin, the same.
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

/** Pick a workspace by its name (a Moderator one's row also says
 *  Moderator). */
async function pickWorkspace(page: Page, name: string) {
  await switcher(page).click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^${name}( Moderator)?$`) }).click();
}

async function newPage(page: Page, title: string) {
  await page.getByRole('main').getByRole('button', { name: 'New', exact: true }).first().click();
  await page.getByLabel('Title').fill(title);
  await page.getByRole('button', { name: 'Create page' }).click();
}

/** The `ws` of every Pages list the admin asked for, in order. */
const listWs = () =>
  api.requests
    .filter((r) => r.role === 'admin' && r.method === 'GET' && r.path === '/api/tree/pages')
    .map((r) => new URLSearchParams(r.query).get('ws'));

/** The `ws` of every page create the admin sent, in order. */
const createWs = () =>
  api.requests
    .filter((r) => r.role === 'admin' && r.method === 'POST' && r.path === '/api/pages')
    .map((r) => new URLSearchParams(r.query).get('ws'));

test('an Admin user in Team switches to Team and back: label, lists and creates follow', async ({
  page,
}) => {
  await signIn(page, 'admin');
  await page.goto('/pages');
  const main = page.getByRole('main');
  await expect(main.getByText(PAGES.minutes.title, { exact: true })).toBeVisible();

  await pickWorkspace(page, 'Admin');
  await expect(switcher(page)).toHaveAccessibleName('Workspace: Admin');
  await expect.poll(listWs).toContain(WORKSPACES.admin.id);

  // To Team: the label says so, the list loads again for Team only.
  await pickWorkspace(page, 'Team');
  await expect(switcher(page)).toHaveAccessibleName('Workspace: Team');
  await expect.poll(() => listWs().at(-1)).toBe(WORKSPACES.team.id);
  await expect(main.getByText(PAGES.handbook.title, { exact: true })).toBeVisible();
  await expect(main.getByText(PAGES.minutes.title, { exact: true })).toHaveCount(0);

  await newPage(page, 'Team plan');
  await expect.poll(() => api.created.map((c) => [c.title, c.ws])).toEqual([['Team plan', 'team']]);
  expect(createWs()).toEqual([WORKSPACES.team.id]);

  // And back to Admin.
  await page.goto('/pages');
  await expect(switcher(page)).toHaveAccessibleName('Workspace: Team');
  await pickWorkspace(page, 'Admin');
  await expect(switcher(page)).toHaveAccessibleName('Workspace: Admin');
  await expect.poll(() => listWs().at(-1)).toBe(WORKSPACES.admin.id);

  await newPage(page, 'Admin plan');
  await expect
    .poll(() => api.created.map((c) => [c.title, c.ws]))
    .toEqual([
      ['Team plan', 'team'],
      ['Admin plan', 'admin'],
    ]);
  expect(createWs()).toEqual([WORKSPACES.team.id, WORKSPACES.admin.id]);
});

/** Fill this origin's localStorage until it takes nothing more, as a
 *  browser whose storage is full (every new write is a QuotaExceededError). */
async function fillStorage(page: Page) {
  const left = await page.evaluate(() => {
    let i = 0;
    for (const size of [1 << 20, 1 << 16, 1 << 12, 1 << 8, 16, 1]) {
      const chunk = 'x'.repeat(size);
      for (;;) {
        try {
          localStorage.setItem(`e2e-fill-${i++}`, chunk);
        } catch {
          break;
        }
      }
    }
    try {
      localStorage.setItem('e2e-fill-probe', 'x');
      return true;
    } catch {
      return false;
    }
  });
  expect(left, 'storage still takes writes').toBe(false);
}

test('with browser storage full, a switch still switches for the page', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/pages');
  const main = page.getByRole('main');
  await expect(main.getByText(PAGES.minutes.title, { exact: true })).toBeVisible();

  // Nothing picked yet (All my workspaces, where an Admin user's creates
  // land in Admin) and the storage is full: the pick cannot be stored.
  await expect(switcher(page)).toHaveAccessibleName('Workspace: All my workspaces');
  await fillStorage(page);

  await pickWorkspace(page, 'Team');
  await expect(switcher(page)).toHaveAccessibleName('Workspace: Team');
  await expect.poll(() => listWs().at(-1)).toBe(WORKSPACES.team.id);
  await expect(main.getByText(PAGES.minutes.title, { exact: true })).toHaveCount(0);
  await newPage(page, 'Team plan');
  await expect.poll(() => api.created.map((c) => [c.title, c.ws])).toEqual([['Team plan', 'team']]);
  expect(createWs()).toEqual([WORKSPACES.team.id]);

  // And back to Admin, without a reload (the pick lives in the page).
  await page.getByRole('link', { name: 'Pages', exact: true }).first().click();
  await expect(page).toHaveURL((u) => u.pathname === '/pages');
  await expect(switcher(page)).toHaveAccessibleName('Workspace: Team');
  await pickWorkspace(page, 'Admin');
  await expect(switcher(page)).toHaveAccessibleName('Workspace: Admin');
  await expect.poll(() => listWs().at(-1)).toBe(WORKSPACES.admin.id);
  await newPage(page, 'Admin plan');
  await expect.poll(() => createWs()).toEqual([WORKSPACES.team.id, WORKSPACES.admin.id]);
});

/** Each list screen: the list route it reads, and its Admin and Team item. */
const SCREENS = [
  {
    path: '/pages',
    list: '/api/tree/pages',
    admin: PAGES.policy.title,
    team: PAGES.handbook.title,
  },
  {
    path: '/notes',
    list: '/api/tree/notes',
    admin: KIND_ITEMS.notes[0].title,
    team: KIND_ITEMS.notes[1].title,
  },
  {
    path: '/files',
    list: '/api/tree/files',
    admin: KIND_ITEMS.files[0].title,
    team: KIND_ITEMS.files[1].title,
  },
  {
    path: '/apps',
    list: '/api/apps',
    admin: KIND_ITEMS.apps[0].title,
    team: KIND_ITEMS.apps[1].title,
  },
] as const;

test('a switch on Pages, Notes, Files and Apps loads each list again for the picked workspace', async ({
  page,
}) => {
  await signIn(page, 'admin');
  const main = page.getByRole('main');
  /** The `ws` of the last list `list` the admin asked for. */
  const lastWs = (list: string) =>
    api.requests
      .filter((r) => r.role === 'admin' && r.method === 'GET' && r.path === list)
      .map((r) => new URLSearchParams(r.query).get('ws'))
      .at(-1);

  for (const s of SCREENS) {
    await page.goto(s.path);
    // All my workspaces: both.
    await expect(switcher(page)).toHaveAccessibleName('Workspace: All my workspaces');
    await expect(main.getByText(s.admin, { exact: true }), s.path).toBeVisible();
    await expect(main.getByText(s.team, { exact: true }), s.path).toBeVisible();
    expect(lastWs(s.list), s.path).toBeNull();

    await pickWorkspace(page, 'Team');
    await expect.poll(() => lastWs(s.list), s.path).toBe(WORKSPACES.team.id);
    await expect(main.getByText(s.team, { exact: true }), s.path).toBeVisible();
    await expect(main.getByText(s.admin, { exact: true }), s.path).toHaveCount(0);

    await pickWorkspace(page, 'Admin');
    await expect.poll(() => lastWs(s.list), s.path).toBe(WORKSPACES.admin.id);
    await expect(main.getByText(s.admin, { exact: true }), s.path).toBeVisible();
    await expect(main.getByText(s.team, { exact: true }), s.path).toHaveCount(0);

    // Back to All for the next screen.
    await pickWorkspace(page, 'All my workspaces');
    await expect(switcher(page)).toHaveAccessibleName('Workspace: All my workspaces');
  }
});
