import { expect, test, type Page } from '@playwright/test';
import {
  COPY,
  FILE,
  PAGES,
  WORKSPACES,
  signIn,
  startMockWorkspaceApi,
  type MockWorkspaceApi,
} from './mock-workspace-api';
import {
  ADMIN_ROWS,
  ANY_LOGIN,
  GONE_ROUTE,
  MEMBER_OPEN,
  WORK_ROWS,
  outside,
  outsideRoutes,
  wholeNav,
} from './shell-nav';

/**
 * A member in the one shell (phases W5c and W6b). Signs in through the real
 * /login form, then: the normal rail and nav with no Admin rows, a switcher
 * that lists exactly the member's workspaces (its private one as Only you),
 * and the owner Pages screen, which reads the owner routes in the member's
 * scope and shows only the items of its workspaces. A new page lands in the
 * workspace the switcher shows (`?ws=`): the private one, Team (where the
 * member is a Moderator), and never one the member is not in. Runs against
 * the in-memory brain, no real one.
 */
let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
});
test.afterEach(async () => {
  await api.close();
});

/** What a member may ask: what every login asks, its own kept routes (its
 *  live updates are /api/member/realtime), and the owner routes the brain
 *  opened to it (W6b). Returns what is left over. */
const beyondMember = (asked: readonly string[]) =>
  outsideRoutes(outside(asked, [...ANY_LOGIN, /^\/api\/member\/(realtime|home)$/]), MEMBER_OPEN);

/** Pick a workspace in the rail's switcher, by its label. */
async function pickWorkspace(page: Page, label: RegExp | string) {
  await page
    .getByRole('button', { name: /^Workspace:/ })
    .first()
    .click();
  await page.getByRole('menuitemradio', { name: label }).click();
}

/** New page, with this title, from the Pages screen. */
async function newPage(page: Page, title: string) {
  await page.getByRole('main').getByRole('button', { name: 'New', exact: true }).first().click();
  await page.getByLabel('Title').fill(title);
  await page.getByRole('button', { name: 'Create page' }).click();
}

test('the rail: the work screens and Workspaces, flat, no scope choice and no Admin rows', async ({
  page,
}) => {
  await signIn(page, 'member');
  const nav = await wholeNav(page, 'member');
  for (const name of [...WORK_ROWS, 'Workspaces', 'Telegram']) {
    await expect(nav.getByRole('link', { name, exact: true }), name).toBeVisible();
  }
  for (const name of ADMIN_ROWS) {
    await expect(nav.getByRole('link', { name, exact: true }), name).toHaveCount(0);
  }
});

test('the switcher lists exactly the member workspaces, its private one as Only you', async ({
  page,
}) => {
  await signIn(page, 'member');
  await page
    .getByRole('button', { name: /^Workspace:/ })
    .first()
    .click();
  // All my workspaces, Only you, then each workspace by name; Board room,
  // Admin and Client desk are workspaces of the brain the member is not in.
  await expect(page.getByRole('menuitemradio')).toHaveText([
    'All my workspaces',
    'Only you',
    'Field crew',
    /^Team\s*Moderator$/,
  ]);
});

test('Pages lists the member workspaces items from the owner routes, in its scope', async ({
  page,
}) => {
  await signIn(page, 'member');
  await page.goto('/pages');
  const main = page.getByRole('main');
  await expect(main.getByText(PAGES.handbook.title, { exact: true })).toBeVisible();
  await expect(main.getByText(PAGES.survey.title, { exact: true })).toBeVisible();
  // In the brain, in a workspace the member is not in: never on the screen.
  await expect(page.getByText(PAGES.minutes.title)).toHaveCount(0);

  const asked = api.asked('member');
  expect(asked).toContain('GET /api/tree/pages');
  // No retired route (410), and no owner route the brain did not open.
  expect(asked.filter((r) => GONE_ROUTE.test(r.slice(r.indexOf(' ') + 1)))).toEqual([]);
  expect(beyondMember(asked)).toEqual([]);
});

test('a new page lands in the private workspace, then in Team as a Moderator', async ({ page }) => {
  await signIn(page, 'member');
  await page.goto('/pages');
  await expect(page.getByRole('main').getByText(PAGES.handbook.title)).toBeVisible();

  await pickWorkspace(page, 'Only you');
  await newPage(page, 'My own notes page');
  await expect
    .poll(() => api.created.map((c) => [c.title, c.ws]))
    .toEqual([['My own notes page', 'own']]);

  await page.goto('/pages');
  await pickWorkspace(page, /^Team/);
  await newPage(page, 'Crew rota');
  await expect
    .poll(() => api.created.map((c) => [c.title, c.ws]))
    .toEqual([
      ['My own notes page', 'own'],
      ['Crew rota', 'team'],
    ]);

  const posts = api.requests.filter(
    (r) => r.role === 'member' && r.method === 'POST' && r.path === '/api/pages',
  );
  expect(posts.map((r) => new URLSearchParams(r.query).get('ws'))).toEqual([
    WORKSPACES.own.id,
    WORKSPACES.team.id,
  ]);
  // The private page lists under Only you.
  await page.goto('/pages');
  await pickWorkspace(page, 'Only you');
  await expect(page.getByRole('main').getByText('My own notes page')).toBeVisible();
  await expect(page.getByRole('main').getByText('Crew rota')).toHaveCount(0);
  expect(beyondMember(api.asked('member'))).toEqual([]);
});

test('a new page is refused in a workspace the member is no longer in', async ({ page }) => {
  // Taken out of Field crew after its shell loaded: the switcher still lists
  // it, the brain refuses the create in its own words.
  api.leftSince.member = ['field'];
  await signIn(page, 'member');
  await page.goto('/pages');
  await pickWorkspace(page, 'Field crew');
  await newPage(page, 'Not here');
  await expect(page.getByText('You are not in that workspace.')).toBeVisible();
  expect(api.created).toEqual([]);
  const post = api.requests.find(
    (r) => r.role === 'member' && r.method === 'POST' && r.path === '/api/pages',
  );
  expect(new URLSearchParams(post?.query ?? '').get('ws')).toBe(WORKSPACES.field.id);
});

test("the member's live updates: its own stream, never the owner's", async ({ page }) => {
  await signIn(page, 'member');
  await page.goto('/pages');
  await expect(page.getByRole('main').getByText(PAGES.handbook.title)).toBeVisible();
  await expect
    .poll(() => api.asked('member').filter((r) => r === 'GET /api/member/realtime').length)
    .toBeGreaterThan(0);
  expect(api.asked('member')).not.toContain('GET /api/realtime');
});

test('a typed admin screen says the member cannot manage it', async ({ page }) => {
  await signIn(page, 'member');
  for (const path of ['/settings/users', '/runs']) {
    await page.goto(path);
    await expect(page.getByText('You cannot manage this part of the brain.'), path).toBeVisible();
  }
  expect(beyondMember(api.asked('member'))).toEqual([]);
});

test('the retired review and Team admin screens land on the home', async ({ page }) => {
  await signIn(page, 'member');
  for (const path of ['/review', '/team-admin']) {
    await page.goto(path);
    await expect(page, path).toHaveURL((u) => u.pathname === '/');
  }
});

test('a member the brain calls not onboarded stays on the home: no loop with /onboarding', async ({
  page,
}) => {
  api.onboarded = false;
  const visited: string[] = [];
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) visited.push(new URL(f.url()).pathname);
  });
  await signIn(page, 'member');
  await expect(page).toHaveURL((u) => u.pathname === '/');
  // Time for a redirect to start, if the shell were to send one.
  await page.waitForTimeout(1500);
  await expect(page).toHaveURL((u) => u.pathname === '/');
  expect(visited).not.toContain('/onboarding');
  expect(api.asked('member')).not.toContain('GET /api/onboarding');
});

test('a member that types /onboarding lands on the home', async ({ page }) => {
  await signIn(page, 'member');
  await page.goto('/onboarding');
  await expect(page).toHaveURL((u) => u.pathname === '/');
  expect(api.asked('member')).not.toContain('GET /api/onboarding');
  expect(beyondMember(api.asked('member'))).toEqual([]);
});

/** The item tree row menu of a page, by its title. */
async function rowMenu(page: Page, title: string) {
  await page.getByRole('button', { name: `More actions for ${title}` }).click();
  return page.getByRole('menu');
}

test('the item caps: a Team page moves and deletes; a read page and a snapshot copy do not move', async ({
  page,
}) => {
  await signIn(page, 'member');
  await page.goto('/pages');
  const main = page.getByRole('main');
  await expect(main.getByText(COPY.title, { exact: true })).toBeVisible();

  // Team: the member is a Moderator there (mayEdit, mayManage).
  let menu = await rowMenu(page, PAGES.handbook.title);
  await expect(menu.getByRole('menuitem', { name: 'Move to…' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Delete…' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Field crew: the member only reads (no mayEdit, no mayManage).
  menu = await rowMenu(page, PAGES.survey.title);
  await expect(menu.getByRole('menuitem', { name: 'Open' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Move to…' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Delete…' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // The snapshot copy: read only, never moved; its author deletes it.
  menu = await rowMenu(page, COPY.title);
  await expect(menu.getByRole('menuitem', { name: 'Move to…' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Delete…' })).toBeVisible();
  await page.keyboard.press('Escape');

  // The read page: the pencil and the bin greyed in their slots (item header
  // contract: nothing beside them moves), and the note behind Info.
  await main.getByText(PAGES.survey.title, { exact: true }).click();
  const header = page.getByTestId('item-header');
  await expect(header.getByText(PAGES.survey.title)).toBeVisible();
  await header.getByRole('button', { name: 'About this page' }).click();
  await expect(page.getByText('You can read this item. You cannot change it.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(header.getByRole('link', { name: 'Edit' })).toHaveCount(0);
  await expect(header.getByRole('button', { name: 'Edit' })).toBeDisabled();
  await expect(header.getByRole('button', { name: 'Delete page' })).toBeDisabled();

  // The copy: the copy note (behind Info) and Delete, no Edit.
  await main.getByText(COPY.title, { exact: true }).click();
  await expect(header.getByText(COPY.title)).toBeVisible();
  await header.getByRole('button', { name: 'About this page' }).click();
  await expect(page.getByText(/This is your copy of an item that was accepted/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(header.getByRole('link', { name: 'Edit' })).toHaveCount(0);
  await expect(header.getByRole('button', { name: 'Delete page' })).toBeVisible();

  // The Team page: Edit and Delete.
  await main.getByText(PAGES.handbook.title, { exact: true }).click();
  await expect(header.getByText(PAGES.handbook.title)).toBeVisible();
  await expect(header.getByRole('link', { name: 'Edit' })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Delete page' })).toBeVisible();
  expect(beyondMember(api.asked('member'))).toEqual([]);
});

test('a /n link to a file opens it in its folder, read from the owner file route', async ({
  page,
}) => {
  await signIn(page, 'member');
  await page.goto(`/n/${FILE.id}`);
  await expect(page).toHaveURL(
    (u) =>
      u.pathname === '/files' &&
      u.searchParams.get('file') === FILE.id &&
      u.searchParams.get('path') === FILE.parentPath,
  );
  await expect(page.getByTestId('item-header').getByText(FILE.filename)).toBeVisible();
  const asked = api.asked('member');
  expect(asked).toContain(`GET /api/files/files/${FILE.id}`);
  expect(beyondMember(asked)).toEqual([]);
});
