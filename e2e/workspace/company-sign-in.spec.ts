import { expect, test } from '@playwright/test';
import {
  PASSWORD,
  signIn,
  startMockWorkspaceApi,
  type MockWorkspaceApi,
} from './mock-workspace-api';
import { newMockFleet } from './mock-fleet';
import { rowsInAnyScope } from './shell-nav';

/**
 * Admin > Company sign-in: the setup screen a client's Microsoft admin uses
 * while the box's mode is `setup`, and its lock. The SCIM-token step is a
 * Control Center's only (owner, 2026-11-09): a spec that makes a token sets
 * `api.fleet`. In-memory brain (mock-sso-setup.ts, mock-fleet.ts), no real one.
 */

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
});
test.afterEach(async () => {
  await api.close();
});

const PATH = '/admin/company-sign-in';
const SECRET = 'the-client-secret-value';
const nav = (page: import('@playwright/test').Page) =>
  page.getByRole('link', { name: 'Company sign-in', exact: true });

test('mode off: the sidebar does not offer it, and the address says it is off', async ({
  page,
}) => {
  const answered = page.waitForResponse((r) => r.url().endsWith('/api/users/sso-setup'));
  await signIn(page, 'admin');
  await answered;
  expect([...(await rowsInAnyScope(page, ['Users', 'Company sign-in']))]).toEqual(['Users']);
  await page.goto(PATH);
  await expect(
    page.getByRole('main').getByText('Company sign-in is off on this box.'),
  ).toBeVisible();
});

test('a member is not offered it, and the brain is not asked', async ({ page }) => {
  api.ssoSetup.mode = 'setup';
  await signIn(page, 'member');
  await expect(page.getByRole('navigation').first()).toBeVisible();
  await expect(nav(page)).toHaveCount(0);
  // The shell's reads have gone out by now; a stream never lets the network idle.
  await page.waitForTimeout(1500);
  expect(api.asked('member').filter((r) => r.includes('sso-setup'))).toEqual([]);
});

test('setup: save the secret with the password, Test it, and it never comes back', async ({
  page,
}) => {
  api.ssoSetup.mode = 'setup';
  await signIn(page, 'admin');
  await page.goto(PATH);
  const main = page.getByRole('main');
  await expect(main.getByText('Setup is open, and company sign-in is off')).toBeVisible();
  await expect(main.getByText('the-client-id')).toBeVisible();
  await expect(
    main.getByText('https://brain.example.invalid/api/auth/oidc/callback'),
  ).toBeVisible();
  // Off a Control Center: no SCIM URL, no SCIM token step.
  await expect(main.getByText('https://brain.example.invalid/scim/v2')).toHaveCount(0);
  await expect(main.getByRole('button', { name: 'Make SCIM token' })).toHaveCount(0);

  // Test before a secret: says so.
  api.ssoSetup.testOutcome = 'no-secret';
  await main.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(main.getByText('No client secret is set yet.')).toBeVisible();

  const field = main.locator('#sso-setup-secret');
  await expect(field).toHaveAttribute('type', 'password');
  await expect(field).toHaveAttribute('autocomplete', 'new-password');
  await field.fill(SECRET);
  await main.getByRole('button', { name: 'Save secret' }).click();

  // A wrong password says so and saves nothing.
  const dialog = page.getByRole('dialog');
  await dialog.locator('#sso-setup-password').fill('not the password');
  await dialog.getByRole('button', { name: 'Save secret' }).click();
  await expect(dialog.getByText('That password is not correct. Try again.')).toBeVisible();
  expect(api.ssoSetup.secret).toBeNull();

  await dialog.locator('#sso-setup-password').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Save secret' }).click();
  await expect(dialog).toHaveCount(0);
  expect(api.ssoSetup.secret).toBe(SECRET);

  // The field stays empty after a save, and the screen shows who set it.
  await expect(main.locator('#sso-setup-secret')).toHaveValue('');
  await expect(main.getByText('Set on this screen. It is sealed and never shown.')).toBeVisible();
  await expect(main.getByText(/Set by admin@example\.invalid/)).toBeVisible();
  await expect(main).not.toContainText(SECRET);

  api.ssoSetup.testOutcome = 'secret-refused';
  await main.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(main.getByText('The provider refused the client.')).toBeVisible();
  api.ssoSetup.testOutcome = 'ok';
  await main.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(main.getByText('This does not prove a sign-in')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('main').getByText('Set on this screen.')).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText(SECRET);
  await expect(page.getByRole('main').locator('#sso-setup-secret')).toHaveValue('');
});

test('setup: the SCIM token shows once, and a new one warns first', async ({ page }) => {
  api.fleet = newMockFleet();
  api.ssoSetup.mode = 'setup';
  await signIn(page, 'admin');
  await page.goto(PATH);
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Make SCIM token' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#sso-setup-password').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Make token' }).click();
  await expect(main.getByText('made-scim-token-1')).toBeVisible();
  await expect(main.getByText('it is shown only once')).toBeVisible();
  await main.getByRole('button', { name: 'I copied it' }).click();
  await expect(main.getByText('made-scim-token-1')).toHaveCount(0);
  await expect(main.getByText('Made on this screen. Only its hash is kept.')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('main').getByText('Made on this screen.')).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText('made-scim-token-1');

  await page.getByRole('main').getByRole('button', { name: 'Make a new token' }).click();
  await expect(page.getByRole('dialog').getByText('stops working at once')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  expect(api.ssoSetup.tokensMade).toBe(1);
});

test('the .env wins: its values read so, and no write is offered', async ({ page }) => {
  api.fleet = newMockFleet();
  api.ssoSetup.mode = 'setup';
  api.ssoSetup.envSecret = true;
  api.ssoSetup.envScim = 'off';
  await signIn(page, 'admin');
  await page.goto(PATH);
  const main = page.getByRole('main');
  await expect(main.getByText('From the box .env.')).toBeVisible();
  await expect(main.getByText('Stopped by the box .env.')).toBeVisible();
  await expect(main.locator('#sso-setup-secret')).toHaveCount(0);
  await expect(main.getByRole('button', { name: /token/i })).toHaveCount(0);
});

test('the box locked with the screen open: a Save says so, and the screen shows the lock', async ({
  page,
}) => {
  api.ssoSetup.mode = 'setup';
  await signIn(page, 'admin');
  await page.goto(PATH);
  const main = page.getByRole('main');
  await main.locator('#sso-setup-secret').fill(SECRET);
  await main.getByRole('button', { name: 'Save secret' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#sso-setup-password').fill(PASSWORD);
  api.ssoSetup.mode = 'optional';
  await dialog.getByRole('button', { name: 'Save secret' }).click();
  await expect(dialog.getByText('The setup screen is locked.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(main.getByText('Locked by the box operator.')).toBeVisible();
  await expect(main.locator('#sso-setup-secret')).toHaveCount(0);
  expect(api.ssoSetup.secret).toBeNull();
});

test('a Test on a locked box says locked, and the screen shows the lock', async ({ page }) => {
  api.ssoSetup.mode = 'setup';
  await signIn(page, 'admin');
  await page.goto(PATH);
  const main = page.getByRole('main');
  const button = main.getByRole('button', { name: 'Test', exact: true });
  await expect(button).toBeVisible();
  api.ssoSetup.mode = 'required';
  await button.click();
  await expect(main.getByText('Locked by the box operator.')).toBeVisible();
  await expect(main.getByRole('button', { name: 'Test', exact: true })).toHaveCount(0);
  expect(api.ssoSetup.tests).toBe(0);
});

test("the password hold's 403 and the 429 read in the brain's words", async ({ page }) => {
  api.fleet = newMockFleet();
  api.ssoSetup.mode = 'setup';
  await signIn(page, 'admin');
  await page.goto(PATH);
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Make SCIM token' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#sso-setup-password').fill(PASSWORD);
  api.ssoSetup.writeRefusal = {
    status: 403,
    body: {
      error: 'password_change_required',
      code: 'password_change_required',
      message: 'Change your password to go on.',
    },
  };
  await dialog.getByRole('button', { name: 'Make token' }).click();
  await expect(dialog.getByText('Change your password to go on.')).toBeVisible();
  await expect(dialog).not.toContainText('password_change_required');
  api.ssoSetup.writeRefusal = {
    status: 429,
    body: { error: 'Too many requests. Try again later.', code: 'rate_limited' },
  };
  await dialog.getByRole('button', { name: 'Make token' }).click();
  await expect(dialog.getByText(/too many requests/i)).toBeVisible();
  expect(api.ssoSetup.tokensMade).toBe(0);
});

test('a failed status read does not take away a token shown once', async ({ page }) => {
  api.fleet = newMockFleet();
  api.ssoSetup.mode = 'setup';
  await signIn(page, 'admin');
  await page.goto(PATH);
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Make SCIM token' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#sso-setup-password').fill(PASSWORD);
  // The read after the token fails, as a box restarting does.
  api.ssoSetup.statusAnswer = 500;
  await dialog.getByRole('button', { name: 'Make token' }).click();
  await expect(main.getByText('Could not read the latest status.')).toBeVisible();
  await expect(main.getByText('made-scim-token-1')).toBeVisible();
  await expect(main.getByText('Could not load company sign-in.')).toHaveCount(0);
  // A second make replaces this one, so it warns, though the status read failed.
  await main.getByRole('button', { name: 'I copied it' }).click();
  await main.getByRole('button', { name: 'Make a new token' }).click();
  await expect(page.getByRole('dialog').getByText('stops working at once')).toBeVisible();
});

test('a status read that hangs does not hold the dialog over the token', async ({ page }) => {
  api.fleet = newMockFleet();
  api.ssoSetup.mode = 'setup';
  await signIn(page, 'admin');
  await page.goto(PATH);
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Make SCIM token' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#sso-setup-password').fill(PASSWORD);
  let release = () => {};
  api.ssoSetup.statusHold = new Promise((r) => (release = r));
  await dialog.getByRole('button', { name: 'Make token' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(main.getByText('made-scim-token-1')).toBeVisible();
  release();
});

test('a failed Test shows why, and a save clears it', async ({ page }) => {
  api.ssoSetup.mode = 'setup';
  await signIn(page, 'admin');
  await page.goto(PATH);
  const main = page.getByRole('main');
  api.ssoSetup.writeRefusal = {
    status: 429,
    body: { error: 'Too many requests. Try again later.', code: 'rate_limited' },
  };
  await main.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(main.getByRole('alert').getByText('Too many requests.')).toBeVisible();
  api.ssoSetup.writeRefusal = null;
  await main.locator('#sso-setup-secret').fill(SECRET);
  await main.getByRole('button', { name: 'Save secret' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#sso-setup-password').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Save secret' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(main.getByRole('alert').getByText('Too many requests.')).toHaveCount(0);
});

test('a Cancel keeps the typed secret, and the password goes', async ({ page }) => {
  api.ssoSetup.mode = 'setup';
  await signIn(page, 'admin');
  await page.goto(PATH);
  const main = page.getByRole('main');
  await main.locator('#sso-setup-secret').fill(SECRET);
  await main.getByRole('button', { name: 'Save secret' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#sso-setup-password').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(main.locator('#sso-setup-secret')).toHaveValue(SECRET);
  await main.getByRole('button', { name: 'Save secret' }).click();
  await expect(page.getByRole('dialog').locator('#sso-setup-password')).toHaveValue('');
  expect(api.ssoSetup.secret).toBeNull();
});

test('a missing .env line is named', async ({ page }) => {
  api.ssoSetup.mode = 'setup';
  api.ssoSetup.envMissing = ['MANTLE_OIDC_CLIENT_ID'];
  await signIn(page, 'admin');
  await page.goto(PATH);
  await expect(
    page.getByRole('main').getByText('Missing from the box .env: MANTLE_OIDC_CLIENT_ID.'),
  ).toBeVisible();
});

test('a brain before the screen answers 405: no entry, and the address says off', async ({
  page,
}) => {
  api.ssoSetup.statusAnswer = 405;
  const answered = page.waitForResponse((r) => r.url().endsWith('/api/users/sso-setup'));
  await signIn(page, 'admin');
  await answered;
  expect([...(await rowsInAnyScope(page, ['Users', 'Company sign-in']))]).toEqual(['Users']);
  await page.goto(PATH);
  await expect(
    page.getByRole('main').getByText('Company sign-in is off on this box.'),
  ).toBeVisible();
});

test('the search palette offers it only while the sidebar does', async ({ page }) => {
  const paletteRow = async () => {
    await page.keyboard.press('Control+k');
    await page.getByRole('dialog').getByRole('combobox').fill('Company sign');
    return page.getByRole('dialog').getByRole('option', { name: /Company sign-in/ });
  };
  const answered = page.waitForResponse((r) => r.url().endsWith('/api/users/sso-setup'));
  await signIn(page, 'admin');
  await answered;
  await expect(await paletteRow()).toHaveCount(0);
  await page.keyboard.press('Escape');
  api.ssoSetup.mode = 'setup';
  await page.reload();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(await paletteRow()).toHaveCount(1);
});

test('a member at the typed address meets the area gate, and asks the brain nothing', async ({
  page,
}) => {
  api.ssoSetup.mode = 'setup';
  await signIn(page, 'member');
  await page.goto(PATH);
  await expect(page.getByText('You cannot manage this part of the brain')).toBeVisible();
  // The shell's reads have gone out by now; a stream never lets the network idle.
  await page.waitForTimeout(1500);
  expect(api.asked('member').filter((r) => r.includes('sso-setup'))).toEqual([]);
});

test('a .env value set with the screen open: a Save says so, and the form goes', async ({
  page,
}) => {
  api.ssoSetup.mode = 'setup';
  await signIn(page, 'admin');
  await page.goto(PATH);
  const main = page.getByRole('main');
  await main.locator('#sso-setup-secret').fill(SECRET);
  await main.getByRole('button', { name: 'Save secret' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#sso-setup-password').fill(PASSWORD);
  api.ssoSetup.envSecret = true;
  await dialog.getByRole('button', { name: 'Save secret' }).click();
  await expect(dialog.getByText('The box .env holds the client secret.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(main.getByText('From the box .env.')).toBeVisible();
  await expect(main.locator('#sso-setup-secret')).toHaveCount(0);
});

test('a brain before the screen may answer 404 too', async ({ page }) => {
  api.ssoSetup.statusAnswer = 404;
  await signIn(page, 'admin');
  await page.goto(PATH);
  await expect(
    page.getByRole('main').getByText('Company sign-in is off on this box.'),
  ).toBeVisible();
});

test('a status read that answers off does not take away a token shown once', async ({ page }) => {
  api.fleet = newMockFleet();
  api.ssoSetup.mode = 'setup';
  await signIn(page, 'admin');
  await page.goto(PATH);
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Make SCIM token' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#sso-setup-password').fill(PASSWORD);
  api.ssoSetup.statusAnswer = 405;
  await dialog.getByRole('button', { name: 'Make token' }).click();
  await expect(main.getByText('Company sign-in is off on this box.')).toBeVisible();
  await expect(main.getByText('made-scim-token-1')).toBeVisible();
});

for (const mode of ['optional', 'required'] as const) {
  test(`${mode}: locked and read-only, and the sidebar offers it`, async ({ page }) => {
    api.ssoSetup.mode = mode;
    api.ssoSetup.secret = SECRET;
    api.ssoSetup.token = 'kept-token';
    await signIn(page, 'admin');
    await page.goto(PATH);
    const main = page.getByRole('main');
    await expect(main.getByText('Locked by the box operator.')).toBeVisible();
    await expect(main.getByText(mode, { exact: true })).toBeVisible();
    await expect(main.getByText('the-client-id')).toBeVisible();
    await expect(main.getByText(/Set by admin@example\.invalid/)).toBeVisible();
    await expect(main.locator('#sso-setup-secret')).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Test', exact: true })).toHaveCount(0);
    await expect(main.getByRole('button', { name: /token/i })).toHaveCount(0);
    await expect(main).not.toContainText(SECRET);
    await expect(main).not.toContainText('kept-token');
    await expect
      .poll(async () => [...(await rowsInAnyScope(page, ['Company sign-in']))])
      .toEqual(['Company sign-in']);
  });
}

test('off a Control Center: no SCIM step, and the Entra steps end at the sign-in app', async ({
  page,
}) => {
  api.ssoSetup.mode = 'setup';
  await signIn(page, 'admin');
  await page.goto(PATH);
  const main = page.getByRole('main');
  await expect(main.getByText('Setup is open, and company sign-in is off')).toBeVisible();
  await expect(main.getByRole('heading', { name: 'SCIM token' })).toHaveCount(0);
  await expect(main.getByText('Assign the people to the sign-in app.')).toBeVisible();
  await expect(main.getByText('Make the SCIM token.')).toHaveCount(0);
});

test('on a Control Center: the SCIM step, the SCIM URL and the provisioning steps show', async ({
  page,
}) => {
  api.fleet = newMockFleet();
  api.ssoSetup.mode = 'setup';
  await signIn(page, 'admin');
  await page.goto(PATH);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'SCIM token' })).toBeVisible();
  await expect(main.getByText('https://brain.example.invalid/scim/v2')).toBeVisible();
  await expect(main.getByText('Assign the same people to both apps.')).toBeVisible();
});

test('the old Settings path goes to Admin', async ({ page }) => {
  api.ssoSetup.mode = 'setup';
  await signIn(page, 'admin');
  await page.goto('/settings/company-sign-in');
  await expect(page).toHaveURL((u) => u.pathname === PATH);
  await expect(page.getByRole('main').getByText('Setup is open')).toBeVisible();
});
