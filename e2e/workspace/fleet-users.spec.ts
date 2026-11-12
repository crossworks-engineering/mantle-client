import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { signIn, startMockWorkspaceApi, type MockWorkspaceApi } from './mock-workspace-api';
import { FLEET_BOX, FLEET_BOX_B, newMockFleet, PEOPLE, withMatrix, withPeople } from './mock-fleet';
import { CC_SCOPE, scopedNav } from './shell-nav';

/**
 * Control Center > Fleet users: every login on every linked box, one person
 * per email, each login's workspaces box by box, over the admin channel
 * (POST /api/fleet/tool: each box's users_list and workspace_user_set), and
 * the fleet-wide ban. No write goes without its one confirm. Without the
 * channel the screen shows the login counts and the bans. In-memory brain
 * (mock-fleet.ts withPeople).
 *
 * E2E_SHOTS=<dir> also saves screenshots there.
 */

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
  api.fleet = withPeople(newMockFleet());
});
test.afterEach(async () => {
  await api.close();
});
test.use({ viewport: { width: 1440, height: 900 } });

const USERS = '/admin/fleet/users';
const BOX_B = 'box-b.example.invalid';
const SHOTS = process.env.E2E_SHOTS || '';

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

/** The workspace_user_set calls the Control Center was sent. */
const writes = () => api.fleet!.toolSent.filter((b) => b.name === 'workspace_user_set');
const setCall = (boxId: string, changes: Record<string, string>[]) => ({
  boxIds: [boxId],
  name: 'workspace_user_set',
  args: { changes },
});

const people = (page: Page) => page.getByRole('main').getByRole('list', { name: 'People' });
const card = (page: Page, text: string) =>
  people(page).getByRole('listitem').filter({ hasText: text });
const grid = (page: Page) =>
  page.getByRole('main').getByRole('table', { name: 'Workspaces, box by box' });

/** A person's first login (by box name), as box:login: the address names
 *  it, never the email. */
const FIRST_LOGIN: Record<string, string> = {
  'ann@example.com': `${FLEET_BOX.id}:${PEOPLE.a.ann}`,
  'owner@example.com': `${FLEET_BOX.id}:${PEOPLE.a.owner}`,
  'dan@example.com': `${FLEET_BOX.id}:${PEOPLE.a.dan}`,
};

async function open(page: Page, email: string) {
  await page.goto(`${USERS}?person=${encodeURIComponent(FIRST_LOGIN[email]!)}`);
  await expect(grid(page)).toBeVisible();
  await expect(page.getByRole('main').getByText(email).first()).toBeVisible();
}

async function pick(page: Page, trigger: ReturnType<Page['getByRole']>, option: string) {
  await trigger.click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test('the nav shows Fleet users, and the list groups one person across boxes', async ({ page }) => {
  await signIn(page, 'admin');
  const nav = await scopedNav(page, CC_SCOPE);
  await nav.getByRole('link', { name: 'Fleet users', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${USERS}$`));
  await expect(people(page).getByRole('listitem')).toHaveCount(6);
  // Ann is one person on both boxes.
  const ann = card(page, 'ann@example.com');
  await expect(ann).toHaveCount(1);
  await expect(ann.getByText('Box A · Admin')).toBeVisible();
  await expect(ann.getByText(BOX_B)).toBeVisible();
  await expect(card(page, 'carol@example.com').getByText('Banned')).toBeVisible();
  await shot(page, 'fleet-users-list');
  // A card opens its person; the address names a login id, never the email.
  await card(page, 'dan@example.com').getByRole('button').click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get('person'))
    .toBe(`${FLEET_BOX.id}:${PEOPLE.a.dan}`);
  expect(page.url()).not.toContain('example.com');
});

test('the filters: banned, admins, no workspace, one box, not seen', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto(USERS);
  const main = page.getByRole('main');
  const emails = async () =>
    (await people(page).getByRole('listitem').allInnerTexts())
      .map((t) => /[a-z]+@example\.com/.exec(t)?.[0])
      .sort();
  const show = async (name: RegExp) => {
    await main.getByRole('group', { name: 'Show' }).getByRole('button', { name }).click();
  };
  await show(/^Banned/);
  await expect.poll(emails).toEqual(['carol@example.com']);
  await show(/^Admins/);
  await expect.poll(emails).toEqual(['ann@example.com', 'owner@example.com']);
  await show(/^No workspace/);
  await expect.poll(emails).toEqual(['carol@example.com']);
  await show(/^On one box only/);
  await expect
    .poll(emails)
    .toEqual([
      'bob@example.com',
      'carol@example.com',
      'dan@example.com',
      'erin@example.com',
      'owner@example.com',
    ]);
  await show(/^Not seen in 30 days/);
  await expect.poll(emails).toEqual(['dan@example.com']);
  await show(/^All/);
  await main.getByRole('textbox', { name: 'Search people' }).fill('erin');
  await expect.poll(emails).toEqual(['erin@example.com']);
  expect(writes()).toEqual([]);
  // The read is one users_list call over every linked box, then the next
  // pages of each box that has more (Box A: five logins, two a page).
  const reads = api.fleet!.toolSent.filter((b) => b.name === 'users_list');
  expect(reads.slice(0, 3)).toEqual([
    { boxIds: [FLEET_BOX.id, FLEET_BOX_B.id], name: 'users_list', args: { offset: 0, limit: 150 } },
    { boxIds: [FLEET_BOX.id], name: 'users_list', args: { offset: 2, limit: 150 } },
    { boxIds: [FLEET_BOX.id], name: 'users_list', args: { offset: 4, limit: 150 } },
  ]);
});

test('a person: change a cell, confirm, the ids go, and the answer shows', async ({ page }) => {
  await signIn(page, 'admin');
  await open(page, 'ann@example.com');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Ann Admin' })).toBeVisible();
  // The Admin workspace is a role: no select in its row.
  await expect(grid(page).getByRole('combobox', { name: /^Role in Admin on/ })).toHaveCount(0);
  await shot(page, 'fleet-users-person');

  await pick(
    page,
    grid(page).getByRole('combobox', { name: /^Role in projects on box-b/i }),
    'User',
  );
  const send = main.getByRole('button', { name: 'Send 1 change' });
  await send.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText(`ann@example.com in projects as User on ${BOX_B}`)).toBeVisible();
  // Nothing goes before the confirm.
  expect(writes()).toEqual([]);
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => writes().length).toBe(1);
  expect(writes()[0]).toEqual(
    setCall(FLEET_BOX_B.id, [
      { loginId: PEOPLE.b.ann, workspaceId: PEOPLE.b.projects, role: 'user' },
    ]),
  );
  const changes = main
    .getByRole('heading', { name: 'Workspace changes' })
    .locator('..')
    .locator('..');
  await expect(changes.getByText('Added as a user.')).toBeVisible();

  // A box that refuses says why, in plain words.
  api.fleet!.memberRefusals[FLEET_BOX.id] = {
    [`${PEOPLE.a.ann}:${PEOPLE.a.field}`]: 'last-moderator',
  };
  await pick(
    page,
    grid(page).getByRole('combobox', { name: /^Role in Field on Box A/ }),
    'Not in it',
  );
  await main.getByRole('button', { name: 'Send 1 change' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => writes().length).toBe(2);
  expect(writes()[1]).toEqual(
    setCall(FLEET_BOX.id, [{ loginId: PEOPLE.a.ann, workspaceId: PEOPLE.a.field, role: 'none' }]),
  );
  await expect(changes.getByText(/This is the last Moderator of the workspace/)).toBeVisible();
});

test('the box owner is locked in every cell', async ({ page }) => {
  await signIn(page, 'admin');
  await open(page, 'owner@example.com');
  await expect(grid(page).getByRole('combobox')).toHaveCount(0);
  await expect(
    grid(page).getByTitle('The owner of the box is never changed here.').first(),
  ).toBeVisible();
});

test('copy workspaces from Box A to Box B: a preview, then one confirm', async ({ page }) => {
  await signIn(page, 'admin');
  await open(page, 'ann@example.com');
  const main = page.getByRole('main');
  await pick(page, main.getByRole('combobox', { name: 'Copy from box' }), 'Box A');
  await pick(page, main.getByRole('combobox', { name: 'Copy to box' }), BOX_B);
  await expect(main.getByText(`ann@example.com in projects as User on ${BOX_B}`)).toBeVisible();
  await expect(main.getByText('Field: that box has no workspace by this name.')).toBeVisible();
  await expect(main.getByText(/^Admin: the Admin workspace/)).toBeVisible();
  await main.getByText('Copy workspaces from one box to another').scrollIntoViewIfNeeded();
  await shot(page, 'fleet-users-copy-preview');
  await main.getByRole('button', { name: 'Copy 1 workspace' }).click();
  expect(writes()).toEqual([]);
  await page.getByRole('alertdialog').getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => writes().length).toBe(1);
  expect(writes()[0]).toEqual(
    setCall(FLEET_BOX_B.id, [
      { loginId: PEOPLE.b.ann, workspaceId: PEOPLE.b.projects, role: 'user' },
    ]),
  );
  // The box made it: the grid reads the box again and shows it.
  await expect(
    grid(page).getByRole('combobox', { name: /^Role in projects on box-b/i }),
  ).toHaveText('User');
});

test('Ban: the fleet-wide sentence, the preview first, then the ban', async ({ page }) => {
  api.fleet!.matches['dan@example.com'] = { matched: 1, owners: 0 };
  await signIn(page, 'admin');
  await open(page, 'dan@example.com');
  await page.getByRole('main').getByRole('button', { name: 'Ban', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText(/A ban disables this person on every linked box/)).toBeVisible();
  await expect(dialog.getByText('Box A: 1 login')).toBeVisible();
  expect(api.fleet!.sent.map((s) => s.preview)).toEqual([true]);
  await dialog.getByRole('button', { name: 'Ban on every box' }).click();
  await expect.poll(() => api.fleet!.sent.length).toBe(2);
  expect(api.fleet!.sent[1]).toEqual({
    preview: false,
    body: { kind: 'disable', emails: ['dan@example.com'], issuer: null, oid: null, reason: null },
  });
  await expect(page.getByRole('main').getByText('Banned on every linked box')).toBeVisible();
});

test('a box that has not opened its admin tools says so, the others show', async ({ page }) => {
  api.fleet!.toolRefused[FLEET_BOX_B.id] = 'scope';
  await signIn(page, 'admin');
  await page.goto(USERS);
  const main = page.getByRole('main');
  await expect(
    main
      .getByRole('list', { name: 'Boxes not shown in full' })
      .getByText(
        /has not opened its admin tools to the Control Center \(MANTLE_CONTROL_CENTER_SCOPE\)/,
      ),
  ).toBeVisible();
  await expect(people(page).getByRole('listitem')).toHaveCount(5);
  await expect(card(page, 'erin@example.com')).toHaveCount(0);
  await expect(card(page, 'ann@example.com').getByText(BOX_B)).toHaveCount(0);
});

test('a Control Center before the admin channel: counts, bans and one calm callout', async ({
  page,
}) => {
  api.fleet = withMatrix(withPeople(newMockFleet()));
  api.fleet.toolOn = false;
  await signIn(page, 'admin');
  await page.goto(USERS);
  const main = page.getByRole('main');
  await expect(
    main.getByText(
      "Names and workspaces show once the admin channel is on (Control Center release + each box's scope).",
    ),
  ).toBeVisible();
  const counts = main.getByRole('table', { name: 'Logins on each box' });
  const rowA = counts.getByRole('row').filter({ hasText: 'Box A' });
  await expect(rowA.getByRole('cell')).toHaveText(['Box A', '1', '3', '0', '4', /ago|just now/]);
  await expect(main.getByText('carol@example.com')).toBeVisible();
  await shot(page, 'fleet-users-fallback');
  await main.getByRole('button', { name: 'Lift ban' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText('carol@example.com')).toBeVisible();
  await dialog.getByRole('button', { name: 'Lift ban' }).click();
  await expect.poll(() => api.fleet!.lifted.length).toBe(1);
});

test('a box whose answer is too large shows nothing, and says so', async ({ page }) => {
  api.fleet!.toolTruncated[FLEET_BOX_B.id] = true;
  await signIn(page, 'admin');
  await page.goto(USERS);
  await expect(
    page
      .getByRole('main')
      .getByRole('list', { name: 'Boxes not shown in full' })
      .getByText("The box's list was too large or too slow to read in full; it shows no new list."),
  ).toBeVisible();
  await expect(card(page, 'erin@example.com')).toHaveCount(0);
});

test('a write still pending after 25 s is asked for again, then answered', async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page, 'admin');
  await open(page, 'ann@example.com');
  // From now on Box B answers one ask late.
  api.fleet!.toolDelay[FLEET_BOX_B.id] = 1;
  const main = page.getByRole('main');
  await pick(
    page,
    grid(page).getByRole('combobox', { name: /^Role in projects on box-b/i }),
    'User',
  );
  await main.getByRole('button', { name: 'Send 1 change' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Send', exact: true }).click();
  await expect(main.getByText('Sending…')).toBeVisible();
  const changes = main
    .getByRole('heading', { name: 'Workspace changes' })
    .locator('..')
    .locator('..');
  await expect(changes.getByText('Added as a user.')).toBeVisible({ timeout: 60_000 });
  const followUp = api.fleet!.toolSent.find((b) => Array.isArray(b.callIds));
  expect(followUp).toBeDefined();
  expect(Object.keys(followUp!)).toEqual(['callIds']);
});

test('dark: the list and a person', async ({ page }) => {
  test.skip(!SHOTS, 'screenshots only');
  await page.emulateMedia({ colorScheme: 'dark' });
  await signIn(page, 'admin');
  await open(page, 'ann@example.com');
  await shot(page, 'fleet-users-person-dark');
});
