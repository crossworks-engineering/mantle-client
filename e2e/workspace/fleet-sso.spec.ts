import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { signIn, startMockWorkspaceApi, type MockWorkspaceApi } from './mock-workspace-api';
import { FLEET_BOX, FLEET_BOX_B, newMockFleet, SSO_PASSWORD, withSso } from './mock-fleet';

/**
 * Control Center > Fleet sign-in: each box's company sign-in staged from
 * the Control Center (POST /api/fleet/sso). The secret is typed once, sent
 * with the person's own password, and never shown. The mode goes up one
 * step at a time from here, never down; required asks a warning first. In-memory brain
 * (mock-fleet.ts withSso: box A in setup mode, box B does not answer).
 * A box with no status (or an old one) reads it once on open; so does the
 * list when no box has a status yet.
 *
 * E2E_SHOTS=<dir> also saves screenshots there.
 */

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
  api.fleet = withSso(newMockFleet());
});
test.afterEach(async () => {
  await api.close();
});
test.use({ viewport: { width: 1440, height: 900 } });

const SSO = '/admin/fleet/sso';
const SHOTS = process.env.E2E_SHOTS || '';

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

const sent = (what: string) => api.fleet!.ssoSent.filter((b) => b.do === what);

test('the list reads every box once on open, and Refresh reads them again', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto(SSO);
  const main = page.getByRole('main');
  const table = main.getByRole('table', { name: 'Fleet sign-in' });
  await expect(table.getByRole('row')).toHaveCount(3);
  // No box had a status: read on open, with no click.
  await expect(table.getByRole('row').filter({ hasText: 'Box A' })).toContainText('Setup');
  await expect(table.getByRole('row').filter({ hasText: 'Box A' })).toContainText('from .env');
  await expect(table.getByRole('row').filter({ hasText: 'box-b' })).toContainText('HTTPS');
  expect(sent('status')).toHaveLength(1);
  expect(sent('status')[0]?.boxIds).toHaveLength(2);
  await shot(page, 'fleet-sso-all');
  // Box A has a status now: opening it reads nothing more.
  await table.getByRole('button', { name: 'Box A' }).click();
  await expect(main.getByRole('button', { name: 'Turn on (optional)' })).toBeVisible();
  expect(sent('status')).toHaveLength(1);
  await page.goto(SSO);
  await expect(table.getByRole('row').filter({ hasText: 'Box A' })).toContainText('Setup');
  await main.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => sent('status').length).toBe(2);
});

test('no stored status: the page reads it on open and the Open setup button is there', async ({
  page,
}) => {
  const box = api.fleet!.ssoStatus[FLEET_BOX.id]!;
  box.mode = 'off';
  box.modeFrom = 'none';
  await signIn(page, 'admin');
  await page.goto(`${SSO}?box=${FLEET_BOX.id}`);
  const main = page.getByRole('main');
  const openSetup = main.getByRole('button', { name: 'Open setup' });
  await expect(openSetup).toBeEnabled();
  expect(sent('status')).toEqual([{ do: 'status', boxIds: [FLEET_BOX.id] }]);
  // Mode off: the fields are off, and one line says why.
  await expect(main.getByLabel('Tenant ID')).toBeDisabled();
  await expect(main.getByLabel('Client secret')).toBeDisabled();
  await expect(
    main.getByText('The fields open in setup mode. Press Open setup first.'),
  ).toBeVisible();
  await shot(page, 'fleet-sso-open-setup');

  await openSetup.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Your password').fill(SSO_PASSWORD);
  await dialog.getByRole('button', { name: 'Raise mode' }).click();
  await expect(main.getByText('Raised to Setup.', { exact: true })).toBeVisible();
  await expect(main.getByLabel('Tenant ID')).toBeEnabled();
  await expect(main.getByText('The fields open in setup mode.', { exact: false })).toHaveCount(0);
  expect(sent('status')).toHaveLength(1);
});

test('the read fails: the reason and Read status are shown by the mode', async ({ page }) => {
  await signIn(page, 'admin');
  // Box B does not answer.
  await page.goto(`${SSO}?box=${FLEET_BOX_B.id}`);
  const main = page.getByRole('main');
  const mode = main.locator('section').filter({
    has: page.getByRole('heading', { name: 'Sign-in mode' }),
  });
  await expect(mode.getByText('This box cannot reach the box over HTTPS.')).toBeVisible();
  const again = mode.getByRole('button', { name: 'Read status' });
  await expect(again).toBeEnabled();
  expect(sent('status')).toEqual([{ do: 'status', boxIds: [FLEET_BOX_B.id] }]);
  await shot(page, 'fleet-sso-read-failed');
  // One read on open, no loop: the next read is the person's.
  await again.click();
  await expect.poll(() => sent('status').length).toBe(2);
  await expect(mode.getByText('This box cannot reach the box over HTTPS.')).toBeVisible();
});

test('the Microsoft side walks Entra with the values of this box', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto(`${SSO}?box=${FLEET_BOX.id}`);
  const main = page.getByRole('main');
  const ms = main.locator('section').filter({
    has: page.getByRole('heading', { name: 'Microsoft side' }),
  });
  // Setup mode: the steps are open, with the box's own redirect URI to copy.
  await expect(ms.getByText('https://box-a.example.invalid/api/auth/oidc/callback')).toBeVisible();
  await expect(ms.getByText('Mantle box-a.example.invalid').first()).toBeVisible();
  await expect(ms.getByRole('button', { name: 'Copy: Redirect URI (Web)' })).toBeVisible();
  await expect(ms).toContainText('Copy the Value. Not the Secret ID.');
  await expect(ms).toContainText('Then Test. Then Turn on (optional).');
  await ms.scrollIntoViewIfNeeded();
  await shot(page, 'fleet-sso-microsoft-side');
  await ms.screenshot(SHOTS ? { path: join(SHOTS, 'fleet-sso-microsoft-side-part.png') } : {});
});

test('once sign-in is on, the Microsoft steps fold away', async ({ page }) => {
  api.fleet!.ssoStatus[FLEET_BOX.id]!.mode = 'optional';
  await signIn(page, 'admin');
  await page.goto(`${SSO}?box=${FLEET_BOX.id}`);
  const main = page.getByRole('main');
  const ms = main.locator('section').filter({
    has: page.getByRole('heading', { name: 'Microsoft side' }),
  });
  const fold = ms.getByText('Sign-in is on. Show the Microsoft steps again', { exact: false });
  await expect(fold).toBeVisible();
  const uri = ms.getByText('https://box-a.example.invalid/api/auth/oidc/callback');
  await expect(uri).toBeHidden();
  await fold.click();
  await expect(uri).toBeVisible();
});

test('a save asks the password, sends only the filled fields, and never shows the secret', async ({
  page,
}) => {
  await signIn(page, 'admin');
  await page.goto(`${SSO}?box=${FLEET_BOX.id}`);
  const main = page.getByRole('main');
  await expect(main.getByText('No status yet.')).toHaveCount(0);
  // The client ID is in the box .env: its field is off. Tenant and secret are open.
  await expect(main.getByLabel('Client ID')).toBeDisabled();
  await expect(main.getByLabel('Tenant ID')).toBeEnabled();
  await main.getByLabel('Client secret').fill('the-secret-value');
  await main.getByRole('button', { name: 'Save', exact: true }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Your password').fill('wrong');
  await dialog.getByRole('button', { name: 'Save sign-in' }).click();
  await expect(dialog.getByRole('alert')).toContainText('not right');

  await dialog.getByLabel('Your password').fill(SSO_PASSWORD);
  await dialog.getByRole('button', { name: 'Save sign-in' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(main.getByText('Saved.', { exact: true })).toBeVisible();
  const last = sent('set').at(-1)!;
  expect(last).toEqual({
    do: 'set',
    boxId: FLEET_BOX.id,
    secret: 'the-secret-value',
    password: SSO_PASSWORD,
  });
  await expect(main.getByLabel('Client secret')).toHaveValue('');
  await expect(page.getByText('the-secret-value')).toHaveCount(0);
  await expect(main.getByRole('definition').filter({ hasText: /^Set / })).toBeVisible();
  await shot(page, 'fleet-sso-box');

  await main.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(
    main.getByText('The provider accepted the client id and secret.', { exact: false }),
  ).toBeVisible();
});

test('the mode goes up one step at a time: Turn on after a Test, required after a warning', async ({
  page,
}) => {
  await signIn(page, 'admin');
  await page.goto(`${SSO}?box=${FLEET_BOX.id}`);
  const main = page.getByRole('main');
  // Setup, no Test passed yet: Turn on waits for one.
  const turnOn = main.getByRole('button', { name: 'Turn on (optional)' });
  await expect(turnOn).toBeDisabled();
  await expect(main.getByText('Run a Test first.', { exact: false })).toBeVisible();
  await main.getByLabel('Client secret').fill('the-secret-value');
  await main.getByRole('button', { name: 'Save', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Your password').fill(SSO_PASSWORD);
  await dialog.getByRole('button', { name: 'Save sign-in' }).click();
  await expect(dialog).toHaveCount(0);
  await main.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(turnOn).toBeEnabled();

  await turnOn.click();
  await expect(dialog.getByRole('heading', { name: 'Raise to Optional' })).toBeVisible();
  await dialog.getByLabel('Your password').fill(SSO_PASSWORD);
  await dialog.getByRole('button', { name: 'Raise mode' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(main.getByText('Raised to Optional.', { exact: true })).toBeVisible();
  expect(sent('mode').at(-1)).toEqual({
    do: 'mode',
    boxId: FLEET_BOX.id,
    mode: 'optional',
    password: SSO_PASSWORD,
  });

  // Required: the warning first, then the password.
  await main.getByRole('button', { name: 'Make required' }).click();
  await expect(
    dialog.getByRole('heading', { name: 'Make company sign-in required?' }),
  ).toBeVisible();
  await expect(dialog).toContainText('0 of 0 active logins are linked');
  await expect(dialog).toContainText('--mode optional');
  await shot(page, 'fleet-sso-required-warning');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(sent('mode')).toHaveLength(1);
  await main.getByRole('button', { name: 'Make required' }).click();
  await dialog.getByRole('button', { name: 'I understand, continue' }).click();
  await expect(dialog.getByRole('heading', { name: 'Raise to Required' })).toBeVisible();
  await dialog.getByLabel('Your password').fill(SSO_PASSWORD);
  await dialog.getByRole('button', { name: 'Raise mode' }).click();
  await expect(main.getByText('Raised to Required.', { exact: true })).toBeVisible();
  // No step above required, and none down from here.
  await expect(main.getByRole('button', { name: /Open setup|Turn on|Make required/ })).toHaveCount(
    0,
  );
  await expect(main.getByText('Required is the top mode.', { exact: false })).toBeVisible();
});

test('a mode set in the box .env cannot be raised from here', async ({ page }) => {
  api.fleet!.ssoStatus[FLEET_BOX.id]!.modeFrom = 'env';
  await signIn(page, 'admin');
  await page.goto(`${SSO}?box=${FLEET_BOX.id}`);
  const main = page.getByRole('main');
  await expect(main.getByRole('button', { name: 'Turn on (optional)' })).toBeDisabled();
  await expect(main.getByText('Set in .env', { exact: false })).toBeVisible();
  await expect(main.getByText('from .env').first()).toBeVisible();
});

test('a Control Center before Fleet sign-in says so', async ({ page }) => {
  api.fleet!.ssoOn = false;
  await signIn(page, 'admin');
  await page.goto(SSO);
  await expect(
    page.getByRole('main').getByText('This Control Center runs a release before Fleet sign-in.'),
  ).toBeVisible();
});

// --- this box: the Control Center itself (the target `self`) ----------------------------

const selfSent = (what: string) => api.fleet!.ssoSelfSent.filter((b) => b.do === what);
const SELF_URI = 'https://cc.example.invalid/api/auth/oidc/callback';

test('this box is the first entry: off to setup, stage, Test, Turn on, with its own values', async ({
  page,
}) => {
  await signIn(page, 'admin');
  await page.goto(SSO);
  const main = page.getByRole('main');
  // The first card of the list is this box, read live on open.
  const first = main.getByRole('button').filter({ hasText: 'This box' }).first();
  await expect(first).toContainText('Off');
  expect(selfSent('status')).toEqual([{ do: 'status', boxIds: ['self'] }]);
  await first.click();
  await expect(page).toHaveURL(/[?&]box=self\b/);
  const openSetup = main.getByRole('button', { name: 'Open setup' });
  await expect(openSetup).toBeEnabled();
  await shot(page, 'fleet-sso-self-off');

  // The box's own redirect URI, once setup has it (the route names it).
  api.fleet!.ssoStatus.self!.redirectUri = SELF_URI;
  await openSetup.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Your password').fill(SSO_PASSWORD);
  await dialog.getByRole('button', { name: 'Raise mode' }).click();
  await expect(main.getByText('Raised to Setup.', { exact: true })).toBeVisible();
  expect(selfSent('mode')).toEqual([
    { do: 'mode', boxId: 'self', mode: 'setup', password: SSO_PASSWORD },
  ]);
  const ms = main.locator('section').filter({
    has: page.getByRole('heading', { name: 'Microsoft side' }),
  });
  await expect(ms.getByText(SELF_URI)).toBeVisible();
  await expect(ms.getByText('Mantle cc.example.invalid').first()).toBeVisible();

  // Stage the values with the password; the secret is never shown.
  const turnOn = main.getByRole('button', { name: 'Turn on (optional)' });
  await expect(turnOn).toBeDisabled();
  await main.getByLabel('Tenant ID').fill('11111111-2222-4333-8444-555555555555');
  await main.getByLabel('Client secret').fill('the-self-secret');
  await main.getByRole('button', { name: 'Save', exact: true }).click();
  await dialog.getByLabel('Your password').fill(SSO_PASSWORD);
  await dialog.getByRole('button', { name: 'Save sign-in' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(main.getByText('Saved.', { exact: false }).first()).toBeVisible();
  expect(selfSent('set')).toEqual([
    {
      do: 'set',
      boxId: 'self',
      tenant: '11111111-2222-4333-8444-555555555555',
      secret: 'the-self-secret',
      password: SSO_PASSWORD,
    },
  ]);
  await expect(page.getByText('the-self-secret')).toHaveCount(0);

  // Turn on waits for a Test that passed.
  await expect(turnOn).toBeDisabled();
  await main.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(turnOn).toBeEnabled();
  expect(selfSent('test')).toEqual([{ do: 'test', boxIds: ['self'] }]);
  // A reload keeps no Test for this box: Turn on asks a new one.
  await page.reload();
  await expect(main.getByRole('button', { name: 'Turn on (optional)' })).toBeDisabled();
  await main.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(turnOn).toBeEnabled();
  await turnOn.click();
  await dialog.getByLabel('Your password').fill(SSO_PASSWORD);
  await dialog.getByRole('button', { name: 'Raise mode' }).click();
  await expect(main.getByText('Raised to Optional.', { exact: true })).toBeVisible();
  // No fleet box was asked anything on the way.
  expect(sent('mode')).toEqual([]);
  expect(sent('set')).toEqual([]);
  expect(sent('test')).toEqual([]);
  await shot(page, 'fleet-sso-self-optional');
});

test('the warning before required says it is the box you are signed in to', async ({ page }) => {
  Object.assign(api.fleet!.ssoStatus.self!, {
    mode: 'optional',
    modeFrom: 'row',
    redirectUri: SELF_URI,
    linked: 1,
    active: 3,
  });
  await signIn(page, 'admin');
  await page.goto(`${SSO}?box=self`);
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Make required' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('This is the box you are signed in to.');
  await expect(dialog).toContainText('yours too, unless you are the original account');
  await expect(dialog).toContainText('1 of 3 active logins are linked, 2 are not.');
  await expect(dialog).toContainText('the .env of this box');
  await shot(page, 'fleet-sso-self-required-warning');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(selfSent('mode')).toEqual([]);
});

test('the Overview card shows the mode of this box and opens its entry', async ({ page }) => {
  api.fleet!.ssoStatus.self!.mode = 'setup';
  api.fleet!.ssoStatus.self!.modeFrom = 'row';
  await signIn(page, 'admin');
  await page.goto('/admin/fleet');
  const card = page.getByRole('main').getByRole('button').filter({ hasText: 'Company sign-in' });
  await expect(card).toContainText('Setup');
  await shot(page, 'fleet-overview-self-sso');
  await card.click();
  await expect(page).toHaveURL(/\/admin\/fleet\/sso\?box=self\b/);
  await expect(
    page.getByRole('main').getByRole('button', { name: 'Turn on (optional)' }),
  ).toBeVisible();
});
