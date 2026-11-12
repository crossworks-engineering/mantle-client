import { expect, test } from '@playwright/test';
import { LOGINS, signIn, startMockWorkspaceApi, type MockWorkspaceApi } from './mock-workspace-api';
import { FLEET_BOX, FLEET_BOX_B, newMockFleet, withMatrix } from './mock-fleet';
import { CC_SCOPE, rowsInAnyScope, scopedNav } from './shell-nav';

/**
 * The Control Center screens (the CC tab of the rail: Overview, Linked boxes,
 * Fleet matrix, Bans, Provider keys, Agent models, Pool entry, Worker groups,
 * Update notice, Fleet changes) and the Users screen's Archived list
 * (docs/control-center.md in the mantle repo). A box is a Control Center when
 * GET /api/fleet answers 200 (`api.fleet` set); off one it answers 404 and
 * nothing shows. Every screen is a card list with its detail beside it: none
 * opens a dialog to show or to edit. In-memory brain (mock-fleet.ts).
 */

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
});
test.afterEach(async () => {
  await api.close();
});

const PATH = '/admin/fleet';
const BOXES = `${PATH}/boxes`;
const MATRIX = `${PATH}/matrix`;
const BANS = `${PATH}/bans`;
const KEYS = `${PATH}/keys`;
const MODELS = `${PATH}/models`;
const POOLS = `${PATH}/pools`;
const GROUPS = `${PATH}/groups`;
const NOTICE = `${PATH}/notice`;
const CHANGES = `${PATH}/changes`;
const MEMBER = LOGINS.member.loginId;
const BOX_B = 'box-b.example.invalid';
const SCREENS = [
  'Overview',
  'Linked boxes',
  'Fleet users',
  'Fleet matrix',
  'Bans',
  'Provider keys',
  'Agent models',
  'Pool entry',
  'Worker groups',
  'Update notice',
  'Fleet changes',
];

/** A box's card in the list of boxes a change goes to. */
const target = (page: import('@playwright/test').Page, name: string) =>
  page
    .getByRole('list', { name: 'Boxes to send to' })
    .getByRole('listitem')
    .filter({ hasText: name });

/** One row of the Fleet changes table. */
const change = (page: import('@playwright/test').Page, box: string) =>
  page.getByRole('table', { name: 'Fleet changes' }).getByRole('row').filter({ hasText: box });

test('not a Control Center: no CC tab, no screen in the nav, and the address says so', async ({
  page,
}) => {
  const answered = page.waitForResponse((r) => r.url().endsWith('/api/fleet'));
  await signIn(page, 'admin');
  await answered;
  expect([...(await rowsInAnyScope(page, ['Users', 'Linked boxes', 'Bans']))]).toEqual(['Users']);
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByRole('radio', { name: CC_SCOPE, exact: true })).toHaveCount(0);
  for (const path of [PATH, MATRIX]) {
    await page.goto(path);
    await expect(
      page.getByRole('main').getByText('This box is not a Control Center.'),
    ).toBeVisible();
  }
});

test('a member is not offered it, and the brain is not asked', async ({ page }) => {
  api.fleet = newMockFleet();
  await signIn(page, 'member');
  await expect(page.getByRole('navigation').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Linked boxes', exact: true })).toHaveCount(0);
  await page.waitForTimeout(1500);
  expect(api.asked('member').filter((r) => r.includes('/api/fleet'))).toEqual([]);
});

test('a Control Center: the CC tab holds every screen, and only those', async ({ page }) => {
  api.fleet = newMockFleet();
  await signIn(page, 'admin');
  const cc = page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('radio', { name: CC_SCOPE, exact: true });
  await expect(cc).toBeVisible();
  const nav = await scopedNav(page, CC_SCOPE);
  await expect(nav.getByRole('link')).toHaveText(SCREENS);
  // Settings does not repeat them.
  const settings = await scopedNav(page, 'Settings');
  await expect(settings.getByRole('link', { name: 'Users', exact: true })).toBeVisible();
  await expect(settings.getByRole('link', { name: 'Fleet matrix', exact: true })).toHaveCount(0);
  // A row opens its own screen.
  await (await scopedNav(page, CC_SCOPE)).getByRole('link', { name: 'Bans', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${BANS}$`));
  await expect(page.getByRole('main').getByRole('heading', { name: /^Bans/ })).toBeVisible();
});

test('Overview: the numbers, the service, the two lines, and what needs an admin', async ({
  page,
}) => {
  api.fleet = newMockFleet();
  await signIn(page, 'admin');
  await page.goto(PATH);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Fleet summary' })).toBeVisible();
  await expect(main.getByText('1 of 2')).toBeVisible();
  await expect(main.getByText('SHA256:mock-fingerprint')).toBeVisible();
  await expect(main.getByText('The control service is running')).toBeVisible();
  await expect(
    main.getByText(/MANTLE_CONTROL_CENTER=https:\/\/cc\.example\.invalid/),
  ).toBeVisible();

  // Box B never answered with the right key: one card, its plain words, a way there.
  const needs = main.getByRole('list', { name: 'Needs you' });
  await expect(needs.getByRole('listitem')).toHaveCount(1);
  await needs.getByText(`${BOX_B} does not answer`).click();
  await expect(
    main.getByText('The box holds another key. Copy the key line again.').last(),
  ).toBeVisible();
  await main.getByRole('link', { name: 'Open the box' }).click();
  await expect(page).toHaveURL(new RegExp(`${BOXES}\\?box=${FLEET_BOX_B.id}$`));
  await expect(main.getByRole('heading', { name: BOX_B })).toBeVisible();
});

test('Linked boxes: each box as a card, link one more, remove one', async ({ page }) => {
  api.fleet = newMockFleet();
  await signIn(page, 'admin');
  await page.goto(BOXES);
  const main = page.getByRole('main');
  // The first box opens by itself.
  await expect(main.getByRole('heading', { name: 'Box A' })).toBeVisible();
  await expect(main.getByText('https://box-a.example.invalid').first()).toBeVisible();
  await expect(main.getByText('4 logins', { exact: true })).toBeVisible();

  // Box B: its code and its plain words.
  await main.getByRole('button', { name: new RegExp(BOX_B) }).click();
  await expect(main.getByText('Not linked').first()).toBeVisible();
  await expect(main.getByText('sig', { exact: true })).toBeVisible();
  await expect(main.getByText('The box holds another key. Copy the key line again.')).toBeVisible();

  // Link a box: the two lines and the form, in the pane.
  await main.getByRole('button', { name: 'Link box' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(main.getByText(/MANTLE_CONTROL_CENTER_KEY=ed25519:/)).toBeVisible();
  await main.locator('#fleet-box-url').fill('https://box-c.example.invalid');
  await main.locator('#fleet-box-label').fill('Box C');
  await main.getByRole('button', { name: 'Add box' }).click();
  // The new box opens.
  await expect(main.getByRole('heading', { name: 'Box C' })).toBeVisible();
  await expect(main.getByText('Waiting for the first run')).toBeVisible();

  await main.getByRole('button', { name: /^Box A/ }).click();
  await main.getByRole('button', { name: 'Remove Box A' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByText('All calls to this box stop.')).toBeVisible();
  await confirm.getByRole('button', { name: 'Remove box' }).click();
  await expect(main.getByText('Box A', { exact: true })).toHaveCount(0);
  expect(api.fleet.boxes.map((b) => b.id)).not.toContain(FLEET_BOX.id);
});

test('a ban: the preview first, then the ban, then Lift, with no dialog for the form', async ({
  page,
}) => {
  api.fleet = newMockFleet();
  api.fleet.matches['leaver@example.invalid'] = { matched: 1, owners: 0 };
  await signIn(page, 'admin');
  await page.goto(BANS);
  const main = page.getByRole('main');
  // No ban yet: the form is there already.
  await expect(main.getByRole('heading', { name: 'New ban' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await main.locator('#fleet-ban-emails').fill('Leaver@example.invalid');
  await main.locator('#fleet-ban-reason').fill('Left the company');
  await main.getByRole('button', { name: 'Preview ban' }).click();
  await expect(main.getByText('Box A: 1 login')).toBeVisible();
  await expect(main.getByText(`${BOX_B}: no login list yet`)).toBeVisible();
  expect(api.fleet.sent).toHaveLength(1);
  expect(api.fleet.sent[0]!.preview).toBe(true);

  // A change clears the preview: the ban made is the ban previewed.
  await main.locator('#fleet-ban-reason').fill('Left the company.');
  await expect(main.getByRole('button', { name: 'Make ban' })).toHaveCount(0);
  await main.getByRole('button', { name: 'Preview ban' }).click();
  await main.getByRole('button', { name: 'Make ban' }).click();
  const made = () => api.fleet!.sent.at(-1)!;
  await expect.poll(() => made().preview).toBe(false);
  expect(made().body).toEqual({
    kind: 'disable',
    emails: ['leaver@example.invalid'],
    issuer: null,
    oid: null,
    reason: 'Left the company.',
  });

  // The new ban opens: its card and its detail.
  await expect(main.getByRole('heading', { name: 'leaver@example.invalid' })).toBeVisible();
  await expect(main.getByText('Left the company.')).toBeVisible();
  await expect(main.getByText('1 login on 1 box at the last run.')).toBeVisible();
  await main.getByRole('button', { name: 'Lift', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(
    confirm.getByText('A login a box Admin disabled by hand stays disabled.'),
  ).toBeVisible();
  await confirm.getByRole('button', { name: 'Lift ban' }).click();
  await expect(main.getByText('Lifted', { exact: true }).first()).toBeVisible();
  await expect(main.getByRole('button', { name: 'Lift', exact: true })).toHaveCount(0);
  expect(api.fleet.lifted).toHaveLength(1);
});

test('an archive ban says Retire, and never enables', async ({ page }) => {
  api.fleet = newMockFleet();
  await signIn(page, 'admin');
  await page.goto(`${BANS}?ban=new`);
  const main = page.getByRole('main');
  await main.locator('#fleet-ban-emails').fill('gone@example.invalid');
  await main.locator('#fleet-ban-kind').click();
  await page.getByRole('option', { name: /Archive/ }).click();
  await expect(main.getByText('This screen never enables it.')).toBeVisible();
  await main.getByRole('button', { name: 'Preview ban' }).click();
  await main.getByRole('button', { name: 'Make archive ban' }).click();
  await expect(main.getByRole('heading', { name: 'gone@example.invalid' })).toBeVisible();
  expect(api.fleet.sent.at(-1)!.body.kind).toBe('archive');

  await expect(main.getByRole('button', { name: 'Lift', exact: true })).toHaveCount(0);
  await main.getByRole('button', { name: 'Retire' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByText(/It never enables a login/)).toBeVisible();
  await confirm.getByRole('button', { name: 'Retire ban' }).click();
  await expect(main.getByText('Retired', { exact: true }).first()).toBeVisible();
});

test('a ban that matches a box owner says so: the preview, the ban, the Overview', async ({
  page,
}) => {
  api.fleet = newMockFleet();
  api.fleet.matches['owner@example.invalid'] = { matched: 1, owners: 1 };
  await signIn(page, 'admin');
  await page.goto(BANS);
  const main = page.getByRole('main');
  await main.locator('#fleet-ban-emails').fill('owner@example.invalid');
  await main.getByRole('button', { name: 'Preview ban' }).click();
  await expect(main.getByText('Box A: 1 login, the owner among them')).toBeVisible();
  await expect(main.getByText('The owner of this box matched a ban and stays live.')).toBeVisible();
  await main.getByRole('button', { name: 'Make ban' }).click();
  await expect(main.getByRole('heading', { name: 'owner@example.invalid' })).toBeVisible();
  await expect(main.getByText('The owner of this box matched a ban and stays live.')).toBeVisible();
  await expect(main.getByText('1 login, the owner among them')).toBeVisible();

  await page.goto(PATH);
  await expect(
    main.getByRole('list', { name: 'Needs you' }).getByText('A ban matched the owner of a box'),
  ).toBeVisible();
});

test('Users: an archived login is listed apart, and Enable asks first', async ({ page }) => {
  api.loginState[MEMBER] = {
    disabledAt: '2026-11-09T08:00:00.000Z',
    archivedAt: '2026-11-09T08:00:00.000Z',
  };
  await signIn(page, 'admin');
  await page.goto('/settings/users');
  const archived = page.getByRole('region', { name: /Archived/ });
  await expect(archived.getByText('Mo Member')).toBeVisible();
  await archived.getByText('Mo Member').click();
  const main = page.getByRole('main');
  await expect(main.getByText(/a permanent disable/).first()).toBeVisible();
  await expect(main.getByRole('button', { name: 'Disable again' })).toHaveCount(0);

  await main.getByRole('switch', { name: 'Disable this login' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByText('Enable an archived login?')).toBeVisible();
  await expect(confirm.getByText(/mo@example\.invalid is archived/)).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  expect(api.loginPatches).toEqual([]);

  await main.getByRole('switch', { name: 'Disable this login' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Enable login' }).click();
  await expect(page.getByRole('region', { name: /Archived/ })).toHaveCount(0);
  expect(api.loginPatches).toEqual([{ id: MEMBER, body: { disabled: false } }]);
});

test('Users: a disabled login can be disabled again', async ({ page }) => {
  api.loginState[MEMBER] = { disabledAt: '2026-11-09T08:00:00.000Z', archivedAt: null };
  await signIn(page, 'admin');
  await page.goto('/settings/users?selected=' + MEMBER);
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Disable again' }).click();
  await expect.poll(() => api.loginPatches).toEqual([{ id: MEMBER, body: { disabled: true } }]);
  expect(api.loginState[MEMBER]!.disabledAt).not.toBe('2026-11-09T08:00:00.000Z');
});

test('phase 2: a brain before the key update says so on Provider keys', async ({ page }) => {
  api.fleet = newMockFleet();
  await signIn(page, 'admin');
  await page.goto(KEYS);
  const main = page.getByRole('main');
  await expect(main.getByText(/it does not have the provider key update yet/)).toBeVisible();
  await expect(main.locator('#fleet-key-value')).toHaveCount(0);
});

test('phase 2: set a provider key on many boxes, see each answer, never the key', async ({
  page,
}) => {
  const KEY = 'sk-or-the-new-fleet-key';
  api.fleet = newMockFleet();
  api.fleet.keysOn = true;
  api.fleet.keyAnswers[FLEET_BOX_B.id] = { ok: false, reason: 'failed' };
  await signIn(page, 'admin');
  await page.goto(KEYS);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Set a provider key' })).toBeVisible();
  const field = main.locator('#fleet-key-value');
  await expect(field).toHaveAttribute('type', 'password');
  await expect(field).toHaveAttribute('autocomplete', 'new-password');
  await expect(main.getByRole('button', { name: 'Set key' })).toBeDisabled();
  await expect(main.getByText('Tick the boxes on the left first.')).toBeVisible();

  await field.fill(KEY);
  await main.getByRole('button', { name: 'All boxes' }).click();
  await expect(main.getByRole('heading', { name: 'Send to 2 boxes' })).toBeVisible();
  await main.getByRole('button', { name: 'Set key on 2 boxes' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByText('Set the OpenRouter key on 2 boxes?')).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  expect(api.fleet.keySent).toEqual([]);

  await main.getByRole('button', { name: 'Set key on 2 boxes' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Set key' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect(api.fleet.keySent).toEqual([
    { service: 'openrouter', value: KEY, boxIds: [FLEET_BOX.id, FLEET_BOX_B.id] },
  ]);
  // The field empties when the key is sent.
  await expect(main.locator('#fleet-key-value')).toHaveValue('');

  // Each box's card waits, then answers at its run: ok, or failed with the old key kept.
  await expect(main.getByText(/Waiting for the next run\./).first()).toBeVisible();
  await expect(target(page, 'Box A').getByText('OpenRouter key: Set and tested.')).toBeVisible({
    timeout: 15_000,
  });
  await expect(target(page, BOX_B).getByText(/keeps the key it had/)).toBeVisible();
  await expect(main).not.toContainText(KEY);
});

test('phase 2: one box picked sends that box only', async ({ page }) => {
  api.fleet = newMockFleet();
  api.fleet.keysOn = true;
  await signIn(page, 'admin');
  await page.goto(KEYS);
  const main = page.getByRole('main');
  await main.locator('#fleet-key-value').fill('another-key');
  await main.getByRole('checkbox', { name: 'Box A' }).click();
  await main.getByRole('button', { name: 'Set key on 1 box' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Set key' }).click();
  await expect.poll(() => api.fleet!.keySent.length).toBe(1);
  expect(api.fleet.keySent[0]!.boxIds).toEqual([FLEET_BOX.id]);
});

test('phase 3: a brain before the matrix says so, and is not asked', async ({ page }) => {
  api.fleet = newMockFleet();
  await signIn(page, 'admin');
  await page.goto(BOXES);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Box A' })).toBeVisible();
  await page.goto(MATRIX);
  await expect(main.getByText(/it does not have the fleet matrix yet/)).toBeVisible();
  await page.waitForTimeout(1000);
  expect(api.fleet.matrixReads).toEqual([]);
});

test('phase 3: the matrix sets every box side by side, and old facts say so', async ({ page }) => {
  api.fleet = withMatrix(newMockFleet());
  await signIn(page, 'admin');
  await page.goto(MATRIX);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'All boxes' })).toBeVisible();
  await expect(main.getByText('1 of 2')).toBeVisible();
  const matrix = main.getByRole('table', { name: 'Fleet matrix' });
  const a = matrix.getByRole('row').filter({ hasText: 'Box A' });
  await expect(a.getByText('Healthy', { exact: true })).toBeVisible();
  await expect(a.getByText('v0.500.42')).toBeVisible();
  await expect(a.getByText('Required', { exact: true })).toBeVisible();
  await expect(a.getByText('Good', { exact: true })).toBeVisible();
  // Box B: its last read failed; the old facts stay and say they are old.
  const b = matrix.getByRole('row').filter({ hasText: BOX_B });
  await expect(b.getByText('Down', { exact: true })).toBeVisible();
  await expect(b.getByText('Failed', { exact: true })).toBeVisible();
  await expect(b.getByText(/, old$/)).toBeVisible();
  // Each shipped agent's model, box by box.
  const models = main.getByRole('table', { name: 'Agent models by box' });
  await expect(models.getByRole('row').filter({ hasText: 'coder' })).toContainText('model-a');
  expect(api.fleet.matrixReads).toContain('');
});

test('phase 3: a box opens in the pane, read alone, with each agent and worker', async ({
  page,
}) => {
  api.fleet = withMatrix(newMockFleet());
  await signIn(page, 'admin');
  await page.goto(MATRIX);
  const main = page.getByRole('main');
  await main
    .getByRole('table', { name: 'Fleet matrix' })
    .getByRole('button', { name: 'Box A' })
    .click();
  // In the pane beside the list: no dialog.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`${MATRIX}\\?box=${FLEET_BOX.id}$`));
  await expect(main.getByRole('heading', { name: 'Box A' })).toBeVisible();
  await expect(main.getByText(/in 30 days/)).toBeVisible();
  await expect(main.getByText('Required', { exact: true })).toBeVisible();
  await expect(main.getByText('2 apps')).toBeVisible();
  const models = main.getByRole('list', { name: 'Models in use' });
  await expect(models.getByText('openrouter · model-a ×2')).toBeVisible();
  await expect(models.getByText('openrouter · model-c')).toBeVisible();
  // An agent that is off runs no model.
  await expect(models.getByText(/model-b/)).toHaveCount(0);
  await expect(main.getByText('Agents: 3 agents (1 off)')).toBeVisible();
  const agents = main.getByRole('table', { name: 'Agents' });
  await expect(agents.getByRole('row').filter({ hasText: 'coder' })).toContainText('agent');
  await expect(agents.getByRole('row').filter({ hasText: 'Own assistant' })).toBeVisible();
  await expect(
    agents.getByRole('row').filter({ hasText: 'Custom agent' }).getByText('Off', { exact: true }),
  ).toBeVisible();
  await expect(main.getByText('AI workers: 1 worker')).toBeVisible();
  await expect(
    main.getByRole('table', { name: 'AI workers' }).getByText('extraction', { exact: true }),
  ).toBeVisible();
  await expect(main.getByRole('list', { name: 'Services' }).getByText('Database')).toBeVisible();
  await expect.poll(() => api.fleet!.matrixReads).toContain(FLEET_BOX.id);
  expect(api.fleet.matrixReads).not.toContain(FLEET_BOX_B.id);

  // Box B from its card: old facts, and a failed backup.
  await main.getByRole('button', { name: new RegExp(`^${BOX_B.replaceAll('.', '\\.')}`) }).click();
  await expect(main.getByText('This may be out of date')).toBeVisible();
  await expect(
    main.getByText(/The box holds another key\. Copy the key line again\./),
  ).toBeVisible();
  await expect(main.getByText('No good backup yet')).toBeVisible();
});

test('phase 4: a brain before the fleet writes says so on each of their screens', async ({
  page,
}) => {
  api.fleet = withMatrix(newMockFleet());
  await signIn(page, 'admin');
  const main = page.getByRole('main');
  for (const path of [MODELS, POOLS, GROUPS, NOTICE, CHANGES]) {
    await page.goto(path);
    await expect(main.getByText(/it does not have the fleet changes yet/)).toBeVisible();
  }
  await expect(main.locator('form')).toHaveCount(0);
});

test('phase 4: set a shipped agent model on every box, see each answer', async ({ page }) => {
  const fleet = withMatrix(newMockFleet());
  fleet.writesOn = true;
  fleet.writeAnswers[FLEET_BOX_B.id] = { coder: { ok: false, reason: 'policy' } };
  api.fleet = fleet;
  await signIn(page, 'admin');
  await page.goto(MODELS);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Set an agent model' })).toBeVisible();
  // The agent list is the matrix's shipped slugs: coder only.
  await expect(main.locator('#fleet-model-agent')).toHaveText('coder');
  // Each box's card shows the model it runs now.
  await expect(target(page, 'Box A').getByText('model-a', { exact: true })).toBeVisible();

  const field = main.locator('#fleet-model-value');
  await field.fill('has space');
  await expect(main.getByText(/A model id has letters, digits/)).toBeVisible();
  // A model the fleet runs fills the field in one click.
  await main.getByRole('button', { name: 'model-a', exact: true }).click();
  await expect(field).toHaveValue('model-a');
  await field.fill('vendor/new-model');
  await main.getByRole('checkbox', { name: 'Box A' }).click();
  await main.getByRole('checkbox', { name: BOX_B }).click();
  await main.getByRole('button', { name: 'Set model on 2 boxes' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText('Set coder to vendor/new-model on 2 boxes?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Set model' }).click();
  await expect.poll(() => fleet.writeSent.length).toBe(1);
  expect(fleet.writeSent).toEqual([
    {
      path: '/api/fleet/models',
      body: {
        changes: [{ slug: 'coder', model: 'vendor/new-model' }],
        boxIds: [FLEET_BOX.id, FLEET_BOX_B.id],
      },
    },
  ]);
  await expect(field).toHaveValue('');

  // The matrix is read again when the last change is answered: the card shows the new model.
  await expect(target(page, 'Box A').getByText('vendor/new-model', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(target(page, BOX_B).getByText('model-a', { exact: true })).toBeVisible();

  // Each box's answer, in Fleet changes.
  await page.goto(CHANGES);
  await expect(change(page, 'Box A').getByText('Set. It was model-a.')).toBeVisible();
  await expect(change(page, 'Box A').getByText('Done', { exact: true })).toBeVisible();
  await expect(
    change(page, BOX_B).getByText(
      'The model policy of this box does not allow it. It keeps model-a.',
    ),
  ).toBeVisible();
  await expect(change(page, BOX_B).getByText('Refused', { exact: true })).toBeVisible();
  // One box alone.
  await main.getByRole('button', { name: /^Box A/ }).click();
  await expect(page.getByRole('table', { name: 'Fleet changes' }).getByRole('row')).toHaveCount(2);
});

test('phase 4: one box picked sends that box only', async ({ page }) => {
  const fleet = withMatrix(newMockFleet());
  fleet.writesOn = true;
  api.fleet = fleet;
  await signIn(page, 'admin');
  await page.goto(MODELS);
  const main = page.getByRole('main');
  await main.locator('#fleet-model-value').fill('vendor/other');
  await main.getByRole('checkbox', { name: BOX_B }).click();
  await main.getByRole('button', { name: 'Set model on 1 box' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Set model' }).click();
  await expect.poll(() => fleet.writeSent.length).toBe(1);
  expect(fleet.writeSent[0]!.body).toEqual({
    changes: [{ slug: 'coder', model: 'vendor/other' }],
    boxIds: [FLEET_BOX_B.id],
  });
  await page.goto(CHANGES);
  const rows = page.getByRole('table', { name: 'Fleet changes' }).getByRole('row');
  // The head row and the one change.
  await expect(rows).toHaveCount(2);
  await expect(rows.getByText('Set. It was model-a.')).toBeVisible({ timeout: 20_000 });
});

test('phase 4: a pool entry and the update notice, each on its own screen', async ({ page }) => {
  const fleet = withMatrix(newMockFleet());
  fleet.writesOn = true;
  fleet.writeAnswers[FLEET_BOX_B.id] = { poolEntry: { ok: false, reason: 'fit' } };
  api.fleet = fleet;
  await signIn(page, 'admin');
  await page.goto(POOLS);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Send a pool entry' })).toBeVisible();

  // A pool entry: the pool from the brain's list, two routes, every box.
  await main.locator('#fleet-pool-pool').click();
  await page.getByRole('option', { name: 'Read images' }).click();
  await main.locator('#fleet-pool-name').fill('Model A');
  await main.locator('#fleet-pool-vendor').fill('Vendor');
  await main.locator('#fleet-pool-provider-0').fill('OpenRouter');
  await main.locator('#fleet-pool-model-0').fill('has space');
  await expect(main.getByText('Each route needs a provider id and a model id')).toBeVisible();
  await main.locator('#fleet-pool-model-0').fill('vendor/a');
  await main.getByRole('button', { name: 'Add route' }).click();
  await main.locator('#fleet-pool-provider-1').fill('direct');
  await main.locator('#fleet-pool-model-1').fill('a-1');
  await main.getByRole('checkbox', { name: 'Box A' }).click();
  await main.getByRole('checkbox', { name: BOX_B }).click();
  await main.getByRole('button', { name: 'Send pool entry to 2 boxes' }).click();
  let dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText('Set Model A in Read images on 2 boxes?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Send pool entry' }).click();
  await expect.poll(() => fleet.writeSent.length).toBe(1);
  expect(fleet.writeSent[0]).toEqual({
    path: '/api/fleet/settings',
    body: {
      changes: [
        {
          kind: 'poolEntry',
          pool: 'vision',
          name: 'Model A',
          vendor: 'Vendor',
          routes: [
            { provider: 'openrouter', model: 'vendor/a' },
            { provider: 'direct', model: 'a-1' },
          ],
        },
      ],
      boxIds: [FLEET_BOX.id, FLEET_BOX_B.id],
    },
  });
  await expect(main.locator('#fleet-pool-name')).toHaveValue('');
  // Each box's card says what it answered to this kind of change.
  await expect(target(page, 'Box A').getByText(/Added at the end of the pool\./)).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    target(page, BOX_B).getByText(/does not fit the pool\. Nothing was set\./),
  ).toBeVisible();

  // The update notice: on blocks every login, and the screen says so twice.
  await page.goto(NOTICE);
  await expect(main.getByText('On blocks every login on that box for up to an hour')).toBeVisible();
  // The cards here say nothing of the pool entry: it is another kind.
  await expect(target(page, 'Box A').getByText(/pool/i)).toHaveCount(0);
  await main.getByRole('radio', { name: /On: block every login/ }).click();
  await main.getByRole('checkbox', { name: 'Box A' }).click();
  await main.getByRole('button', { name: 'Turn it on for 1 box' }).click();
  dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText('Turn the update notice on for 1 box?')).toBeVisible();
  await expect(dialog.getByText(/Every login on each box is blocked/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Turn it on' }).click();
  await expect.poll(() => fleet.writeSent.length).toBe(2);
  expect(fleet.writeSent[1]!.body).toEqual({
    changes: [{ kind: 'updateNotice', on: true }],
    boxIds: [FLEET_BOX.id],
  });
  await expect(target(page, 'Box A').getByText(/On\. Logins wait on this box\./)).toBeVisible({
    timeout: 20_000,
  });

  await page.goto(CHANGES);
  await expect(change(page, 'Box A').getByText('Added at the end of the pool.')).toBeVisible();
  await expect(change(page, 'Box A').getByText('On. Logins wait on this box.')).toBeVisible();
  await expect(change(page, BOX_B).getByText('Update notice on')).toHaveCount(0);
});

test('phase 4: a worker group, and each reason in plain words', async ({ page }) => {
  const fleet = withMatrix(newMockFleet());
  fleet.writesOn = true;
  fleet.writeAnswers[FLEET_BOX_B.id] = { workerGroup: { ok: false, reason: 'members' } };
  api.fleet = fleet;
  await signIn(page, 'admin');
  await page.goto(GROUPS);
  const main = page.getByRole('main');
  await main.locator('#fleet-group-slug').fill('Review Panel');
  await expect(main.getByText('A slug has small letters, digits, - and _ only.')).toBeVisible();
  await main.locator('#fleet-group-slug').fill('Review-Panel');
  await main.locator('#fleet-group-name').fill('Review panel');
  await main.locator('#fleet-group-members').fill('Extractor, summarizer extractor');
  await main.locator('#fleet-group-enabled').click();
  await main.getByRole('button', { name: 'All boxes' }).click();
  await main.getByRole('button', { name: 'Send worker group to 2 boxes' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText('Set worker group review-panel on 2 boxes?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Send worker group' }).click();
  await expect.poll(() => fleet.writeSent.length).toBe(1);
  expect(fleet.writeSent[0]!.body).toEqual({
    changes: [
      {
        kind: 'workerGroup',
        slug: 'review-panel',
        name: 'Review panel',
        members: ['extractor', 'summarizer'],
        enabled: false,
      },
    ],
    boxIds: [FLEET_BOX.id, FLEET_BOX_B.id],
  });
  await expect(target(page, 'Box A').getByText(/Made\./)).toBeVisible({ timeout: 20_000 });
  await expect(
    target(page, BOX_B).getByText(
      /A member is not an enabled worker on this box\. Nothing was set\./,
    ),
  ).toBeVisible();
  // And the Overview names the refusal.
  await page.goto(PATH);
  await expect(
    main.getByRole('list', { name: 'Needs you' }).getByText(`${BOX_B} refused 1 change`),
  ).toBeVisible();
});
