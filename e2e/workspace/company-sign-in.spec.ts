import { expect, test } from '@playwright/test';
import {
  PASSWORD,
  signIn,
  startMockWorkspaceApi,
  type MockWorkspaceApi,
} from './mock-workspace-api';
import { rowsInAnyScope } from './shell-nav';

/**
 * Settings > Company sign-in: the setup screen a client's Microsoft admin uses
 * while the box's mode is `setup`, and its lock. In-memory brain
 * (mock-sso-setup.ts), no real one.
 */

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
});
test.afterEach(async () => {
  await api.close();
});

const PATH = '/settings/company-sign-in';
const SECRET = 'the-client-secret-value';
const nav = (page: import('@playwright/test').Page) =>
  page.getByRole('link', { name: 'Company sign-in', exact: true });

test('mode off: the sidebar does not offer it, and the address says it is off', async ({
  page,
}) => {
  await signIn(page, 'admin');
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
  await expect(main.getByText('https://brain.example.invalid/scim/v2')).toBeVisible();

  // Test before a secret: says so.
  api.ssoSetup.testOutcome = 'no-secret';
  await main.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(main.getByText('No client secret is set yet.')).toBeVisible();

  const field = main.locator('#sso-setup-secret');
  await expect(field).toHaveAttribute('type', 'password');
  await field.fill(SECRET);
  await main.getByRole('button', { name: 'Save secret' }).click();

  // A wrong password says so and saves nothing.
  const dialog = page.getByRole('dialog');
  await dialog.locator('#sso-setup-password').fill('not the password');
  await dialog.getByRole('button', { name: 'Save secret' }).click();
  await expect(dialog.getByText('Type your password to make this change.')).toBeVisible();
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
});

test("the password hold's 403 and the 429 read in the brain's words", async ({ page }) => {
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
      reason: 'password-change-required',
      message: 'Change your password to go on.',
    },
  };
  await dialog.getByRole('button', { name: 'Make token' }).click();
  await expect(dialog.getByText('Change your password to go on.')).toBeVisible();
  await expect(dialog).not.toContainText('password_change_required');
  api.ssoSetup.writeRefusal = { status: 429, body: { error: 'Too many requests.' } };
  await dialog.getByRole('button', { name: 'Make token' }).click();
  await expect(dialog.getByText(/too many requests/i)).toBeVisible();
  expect(api.ssoSetup.tokensMade).toBe(0);
});

test('a failed status read does not take away a token shown once', async ({ page }) => {
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
  await expect(main.getByText('made-scim-token-1')).toBeVisible();
  await expect(main.getByText('Could not load company sign-in.')).toHaveCount(0);
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
  await signIn(page, 'admin');
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
  await signIn(page, 'admin');
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
  await expect(page.getByRole('main').locator('#sso-setup-secret')).toHaveCount(0);
  expect(api.asked('member').filter((r) => r.includes('sso-setup'))).toEqual([]);
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
    expect(await rowsInAnyScope(page, ['Company sign-in'])).toEqual(new Set(['Company sign-in']));
  });
}
