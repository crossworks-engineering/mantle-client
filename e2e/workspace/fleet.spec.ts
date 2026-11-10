import { expect, test } from '@playwright/test';
import { LOGINS, signIn, startMockWorkspaceApi, type MockWorkspaceApi } from './mock-workspace-api';
import { FLEET_BOX, FLEET_BOX_B, newMockFleet, withMatrix } from './mock-fleet';
import { rowsInAnyScope } from './shell-nav';

/**
 * Admin > Fleet, the Control Center's boxes and bans, and the Users screen's
 * Archived list (docs/control-center.md in the mantle repo). A box is a
 * Control Center when GET /api/fleet answers 200 (`api.fleet` set); off one
 * it answers 404 and nothing shows. In-memory brain (mock-fleet.ts).
 */

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
});
test.afterEach(async () => {
  await api.close();
});

const PATH = '/admin/fleet';
const MEMBER = LOGINS.member.loginId;

test('not a Control Center: no Fleet in the nav, and the address says so', async ({ page }) => {
  const answered = page.waitForResponse((r) => r.url().endsWith('/api/fleet'));
  await signIn(page, 'admin');
  await answered;
  expect([...(await rowsInAnyScope(page, ['Users', 'Fleet']))]).toEqual(['Users']);
  await page.goto(PATH);
  await expect(page.getByRole('main').getByText('This box is not a Control Center.')).toBeVisible();
});

test('a member is not offered it, and the brain is not asked', async ({ page }) => {
  api.fleet = newMockFleet();
  await signIn(page, 'member');
  await expect(page.getByRole('navigation').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Fleet', exact: true })).toHaveCount(0);
  await page.waitForTimeout(1500);
  expect(api.asked('member').filter((r) => r.includes('/api/fleet'))).toEqual([]);
});

test('a Control Center: the key, the two lines, the boxes, add and remove', async ({ page }) => {
  api.fleet = newMockFleet();
  await signIn(page, 'admin');
  await expect.poll(async () => [...(await rowsInAnyScope(page, ['Fleet']))]).toEqual(['Fleet']);
  await page.goto(PATH);
  const main = page.getByRole('main');
  await expect(main.getByText('SHA256:mock-fingerprint')).toBeVisible();
  await expect(main.getByText('The control service is running.')).toBeVisible();
  await expect(
    main.getByText(/MANTLE_CONTROL_CENTER=https:\/\/cc\.example\.invalid/),
  ).toBeVisible();
  await expect(main.getByText('Box A', { exact: true })).toBeVisible();
  // Box B never answered with the right key: its code and its plain words.
  await expect(main.getByText('sig', { exact: true })).toBeVisible();
  await expect(main.getByText('The box holds another key. Copy the key line again.')).toBeVisible();

  await main.locator('#fleet-box-url').fill('https://box-c.example.invalid');
  await main.locator('#fleet-box-label').fill('Box C');
  await main.getByRole('button', { name: 'Add box' }).click();
  await expect(main.getByText('Box C', { exact: true })).toBeVisible();
  await expect(main.locator('#fleet-box-url')).toHaveValue('');

  await main.getByRole('button', { name: 'Remove Box A' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByText('All calls to this box stop.')).toBeVisible();
  await confirm.getByRole('button', { name: 'Remove box' }).click();
  await expect(main.getByText('Box A', { exact: true })).toHaveCount(0);
  expect(api.fleet.boxes.map((b) => b.id)).not.toContain(FLEET_BOX.id);
});

test('a ban: the preview first, then the ban, then Lift', async ({ page }) => {
  api.fleet = newMockFleet();
  api.fleet.matches['leaver@example.invalid'] = { matched: 1, owners: 0 };
  await signIn(page, 'admin');
  await page.goto(PATH);
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'New ban' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#fleet-ban-emails').fill('Leaver@example.invalid');
  await dialog.locator('#fleet-ban-reason').fill('Left the company');
  await dialog.getByRole('button', { name: 'Preview ban' }).click();
  await expect(dialog.getByText('Box A: 1 login')).toBeVisible();
  await expect(dialog.getByText('box-b.example.invalid: no login list yet')).toBeVisible();
  expect(api.fleet.sent).toHaveLength(1);
  expect(api.fleet.sent[0]!.preview).toBe(true);

  // A change clears the preview: the ban made is the ban previewed.
  await dialog.locator('#fleet-ban-reason').fill('Left the company.');
  await expect(dialog.getByRole('button', { name: 'Make ban' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Preview ban' }).click();
  await dialog.getByRole('button', { name: 'Make ban' }).click();
  await expect(dialog).toHaveCount(0);
  const made = api.fleet.sent.at(-1)!;
  expect(made.preview).toBe(false);
  expect(made.body).toEqual({
    kind: 'disable',
    emails: ['leaver@example.invalid'],
    issuer: null,
    oid: null,
    reason: 'Left the company.',
  });

  await expect(main.getByText('leaver@example.invalid', { exact: true })).toBeVisible();
  await main.getByRole('button', { name: 'Lift', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(
    confirm.getByText('A login a box Admin disabled by hand stays disabled.'),
  ).toBeVisible();
  await confirm.getByRole('button', { name: 'Lift ban' }).click();
  await expect(main.getByText('Lifted', { exact: true })).toBeVisible();
  expect(api.fleet.lifted).toHaveLength(1);
});

test('an archive ban says Retire, and never enables', async ({ page }) => {
  api.fleet = newMockFleet();
  await signIn(page, 'admin');
  await page.goto(PATH);
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'New ban' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#fleet-ban-emails').fill('gone@example.invalid');
  await dialog.locator('#fleet-ban-kind').click();
  await page.getByRole('option', { name: /Archive/ }).click();
  await expect(dialog.getByText('This screen never enables it.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Preview ban' }).click();
  await dialog.getByRole('button', { name: 'Make archive ban' }).click();
  await expect(dialog).toHaveCount(0);
  expect(api.fleet.sent.at(-1)!.body.kind).toBe('archive');

  await expect(main.getByRole('button', { name: 'Lift', exact: true })).toHaveCount(0);
  await main.getByRole('button', { name: 'Retire' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByText(/It never enables a login/)).toBeVisible();
  await confirm.getByRole('button', { name: 'Retire ban' }).click();
  await expect(main.getByText('Retired', { exact: true })).toBeVisible();
});

test('a ban that matches a box owner says so, in the preview and on the ban', async ({ page }) => {
  api.fleet = newMockFleet();
  api.fleet.matches['owner@example.invalid'] = { matched: 1, owners: 1 };
  await signIn(page, 'admin');
  await page.goto(PATH);
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'New ban' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#fleet-ban-emails').fill('owner@example.invalid');
  await dialog.getByRole('button', { name: 'Preview ban' }).click();
  await expect(dialog.getByText('Box A: 1 login, the owner among them')).toBeVisible();
  await expect(
    dialog.getByText('The owner of this box matched a ban and stays live.'),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Make ban' }).click();
  await expect(main.getByText('The owner of this box matched a ban and stays live.')).toBeVisible();
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

test('phase 2: a brain before the key update offers no key section', async ({ page }) => {
  api.fleet = newMockFleet();
  await signIn(page, 'admin');
  await page.goto(PATH);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: /Bans/ })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Provider keys' })).toHaveCount(0);
});

test('phase 2: set a provider key on many boxes, see each answer, never the key', async ({
  page,
}) => {
  const KEY = 'sk-or-the-new-fleet-key';
  api.fleet = newMockFleet();
  api.fleet.keysOn = true;
  api.fleet.keyAnswers[FLEET_BOX_B.id] = { ok: false, reason: 'failed' };
  await signIn(page, 'admin');
  await page.goto(PATH);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Provider keys' })).toBeVisible();
  const field = main.locator('#fleet-key-value');
  await expect(field).toHaveAttribute('type', 'password');
  await expect(field).toHaveAttribute('autocomplete', 'new-password');
  await expect(main.getByRole('button', { name: 'Set key' })).toBeDisabled();

  await field.fill(KEY);
  await main.getByRole('button', { name: 'All boxes' }).click();
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

  // Each box waits, then answers at its run: ok, or failed with the old key kept.
  await expect(main.getByText('Waiting for the next run.').first()).toBeVisible();
  const boxA = main.getByRole('listitem').filter({ hasText: 'Box A: OpenRouter key' });
  await expect(boxA.getByText('Set and tested.')).toBeVisible({ timeout: 15_000 });
  const boxB = main
    .getByRole('listitem')
    .filter({ hasText: 'box-b.example.invalid: OpenRouter key' });
  await expect(boxB.getByText(/keeps the key it had/)).toBeVisible();
  await expect(main).not.toContainText(KEY);
});

test('phase 2: one box picked sends that box only', async ({ page }) => {
  api.fleet = newMockFleet();
  api.fleet.keysOn = true;
  await signIn(page, 'admin');
  await page.goto(PATH);
  const main = page.getByRole('main');
  await main.locator('#fleet-key-value').fill('another-key');
  await main.getByRole('checkbox', { name: 'Box A' }).click();
  await main.getByRole('button', { name: 'Set key on 1 box' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Set key' }).click();
  await expect.poll(() => api.fleet!.keySent.length).toBe(1);
  expect(api.fleet.keySent[0]!.boxIds).toEqual([FLEET_BOX.id]);
});

test('phase 3: a brain before the matrix offers no matrix, and is not asked', async ({ page }) => {
  api.fleet = newMockFleet();
  await signIn(page, 'admin');
  await page.goto(PATH);
  const main = page.getByRole('main');
  await expect(main.getByText('Box A', { exact: true })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Fleet matrix' })).toHaveCount(0);
  await page.waitForTimeout(1000);
  expect(api.fleet.matrixReads).toEqual([]);
});

test('phase 3: the matrix shows each box, and old facts say so', async ({ page }) => {
  api.fleet = withMatrix(newMockFleet());
  await signIn(page, 'admin');
  await page.goto(PATH);
  const matrix = page.getByRole('list', { name: 'Fleet matrix' });
  await expect(matrix).toBeVisible();
  const a = matrix.getByRole('listitem').filter({ hasText: 'Box A' }).first();
  await expect(a.getByText('Healthy', { exact: true })).toBeVisible();
  await expect(a.getByText('v0.500.42')).toBeVisible();
  await expect(a.getByText(/^Read /)).toBeVisible();
  await expect(a.getByText(/today · .* in 30 days/)).toBeVisible();
  await expect(a.getByText('Required', { exact: true })).toBeVisible();
  await expect(a.getByText('3 agents (1 off), 1 worker')).toBeVisible();
  await expect(a.getByText('3 workspaces, 2 apps, 4 logins')).toBeVisible();
  const models = a.getByRole('list', { name: 'Models in use' });
  await expect(models.getByText('openrouter · model-a ×2')).toBeVisible();
  await expect(models.getByText('openrouter · model-c')).toBeVisible();
  // An agent that is off runs no model.
  await expect(models.getByText(/model-b/)).toHaveCount(0);

  // Box B: its last read failed; the old facts stay and say they may be old.
  const b = matrix.getByRole('listitem').filter({ hasText: 'box-b.example.invalid' }).first();
  await expect(b.getByText('Down', { exact: true })).toBeVisible();
  await expect(
    b.getByText(/The box holds another key\. Copy the key line again\. This may be out of date\./),
  ).toBeVisible();
  await expect(b.getByText(/^Failed .*No good backup yet\.$/)).toBeVisible();
  expect(api.fleet.matrixReads).toContain('');
});

test('phase 3: Details reads one box and lists each agent and worker', async ({ page }) => {
  api.fleet = withMatrix(newMockFleet());
  await signIn(page, 'admin');
  await page.goto(PATH);
  const matrix = page.getByRole('list', { name: 'Fleet matrix' });
  const a = matrix.getByRole('listitem').filter({ hasText: 'Box A' }).first();
  await a.getByRole('button', { name: 'Details' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Box A' })).toBeVisible();
  await expect(dialog.getByText('Agents (3)')).toBeVisible();
  await expect(dialog.getByText('coder · agent', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Own assistant · assistant', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Custom agent · agent', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Off', { exact: true })).toBeVisible();
  await expect(dialog.getByText('AI workers (1)')).toBeVisible();
  await expect(dialog.getByText('extraction', { exact: true })).toBeVisible();
  await expect.poll(() => api.fleet!.matrixReads).toContain(FLEET_BOX.id);
  expect(api.fleet.matrixReads).not.toContain(FLEET_BOX_B.id);
});

test('phase 4: a brain before the model update offers no model section', async ({ page }) => {
  api.fleet = withMatrix(newMockFleet());
  await signIn(page, 'admin');
  await page.goto(PATH);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Fleet matrix' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Agent models' })).toHaveCount(0);
});

test('phase 4: set a shipped agent model on every box, see each answer', async ({ page }) => {
  const fleet = withMatrix(newMockFleet());
  fleet.modelsOn = true;
  fleet.modelAnswers[FLEET_BOX_B.id] = { coder: { ok: false, reason: 'policy' } };
  api.fleet = fleet;
  await signIn(page, 'admin');
  await page.goto(PATH);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Agent models' })).toBeVisible();
  // The agent list is the matrix's shipped slugs: coder only.
  await expect(main.locator('#fleet-model-agent')).toHaveText('coder');
  const current = main.getByRole('list', { name: 'Current models' });
  await expect(current.getByText('Box A: model-a')).toBeVisible();

  const field = main.locator('#fleet-model-value');
  await field.fill('has space');
  await expect(main.getByText(/A model id has letters, digits/)).toBeVisible();
  await field.fill('vendor/new-model');
  await main.locator('#fleet-model-box-' + FLEET_BOX.id).click();
  await main.locator('#fleet-model-box-' + FLEET_BOX_B.id).click();
  await main.getByRole('button', { name: 'Set model on 2 boxes' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText('Set coder to vendor/new-model on 2 boxes?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Set model' }).click();
  expect(fleet.modelSent).toEqual([
    {
      changes: [{ slug: 'coder', model: 'vendor/new-model' }],
      boxIds: [FLEET_BOX.id, FLEET_BOX_B.id],
    },
  ]);
  await expect(field).toHaveValue('');

  const updates = main.getByRole('list', { name: 'Model updates' });
  const a = updates.getByRole('listitem').filter({ hasText: 'Box A' });
  const b = updates.getByRole('listitem').filter({ hasText: 'box-b.example.invalid' });
  await expect(a.getByText('Set. It was model-a.')).toBeVisible({ timeout: 15_000 });
  await expect(
    b.getByText('The model policy of this box does not allow it. It keeps model-a.'),
  ).toBeVisible();
  // The matrix is read again and shows the new model.
  await expect(current.getByText('Box A: vendor/new-model')).toBeVisible();
  await expect(current.getByText('box-b.example.invalid: model-a')).toBeVisible();
});

test('phase 4: one box picked sends that box only', async ({ page }) => {
  const fleet = withMatrix(newMockFleet());
  fleet.modelsOn = true;
  api.fleet = fleet;
  await signIn(page, 'admin');
  await page.goto(PATH);
  const main = page.getByRole('main');
  await main.locator('#fleet-model-value').fill('vendor/other');
  await main.locator('#fleet-model-box-' + FLEET_BOX_B.id).click();
  await main.getByRole('button', { name: 'Set model on 1 box' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Set model' }).click();
  await expect.poll(() => fleet.modelSent.length).toBe(1);
  expect(fleet.modelSent[0]).toEqual({
    changes: [{ slug: 'coder', model: 'vendor/other' }],
    boxIds: [FLEET_BOX_B.id],
  });
  const updates = main.getByRole('list', { name: 'Model updates' });
  await expect(updates.getByRole('listitem')).toHaveCount(1);
  await expect(updates.getByText('Set. It was model-a.')).toBeVisible({ timeout: 15_000 });
});
