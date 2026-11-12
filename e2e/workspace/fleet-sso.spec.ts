import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { signIn, startMockWorkspaceApi, type MockWorkspaceApi } from './mock-workspace-api';
import { FLEET_BOX, newMockFleet, SSO_PASSWORD, withSso } from './mock-fleet';

/**
 * Control Center > Fleet sign-in: each box's company sign-in staged from
 * the Control Center (POST /api/fleet/sso). The secret is typed once, sent
 * with the person's own password, and never shown. The mode goes up one
 * step at a time from here, never down; required asks a warning first. In-memory brain
 * (mock-fleet.ts withSso: box A in setup mode, box B does not answer).
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

test('Refresh reads every box, and the table shows each one', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto(SSO);
  const main = page.getByRole('main');
  const table = main.getByRole('table', { name: 'Fleet sign-in' });
  await expect(table.getByRole('row')).toHaveCount(3);
  await main.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(table.getByRole('row').filter({ hasText: 'Box A' })).toContainText('Setup');
  await expect(table.getByRole('row').filter({ hasText: 'Box A' })).toContainText('from .env');
  await expect(table.getByRole('row').filter({ hasText: 'box-b' })).toContainText('HTTPS');
  expect(sent('status')).toHaveLength(1);
  expect(sent('status')[0]?.boxIds).toHaveLength(2);
  await shot(page, 'fleet-sso-all');
});

test('a save asks the password, sends only the filled fields, and never shows the secret', async ({
  page,
}) => {
  await signIn(page, 'admin');
  await page.goto(`${SSO}?box=${FLEET_BOX.id}`);
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Read status' }).click();
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
  await main.getByRole('button', { name: 'Read status' }).click();
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
  await main.getByRole('button', { name: 'Read status' }).click();
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
