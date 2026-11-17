import { expect, test } from '@playwright/test';
import { signIn, startMockWorkspaceApi, type MockWorkspaceApi } from './mock-workspace-api';
import { rowsInAnyScope } from './shell-nav';

/**
 * The optional Sync service (email and contacts; lib/sync.ts):
 * the shell's `features.sync: false` takes its rows out of the nav, and a
 * typed link to one of its screens says the service is off. In-memory brain
 * (mock-workspace-api.ts), no real one.
 */

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
});
test.afterEach(async () => {
  await api.close();
});

test('Sync on: the nav offers Email and Contacts', async ({ page }) => {
  await signIn(page, 'admin');
  expect([...(await rowsInAnyScope(page, ['Email', 'Contacts']))].sort()).toEqual([
    'Contacts',
    'Email',
  ]);
});

test('Sync off: no Email row, and /inbox says the service is off', async ({ page }) => {
  api.sync = false;
  await signIn(page, 'admin');
  expect([...(await rowsInAnyScope(page, ['Email', 'Contacts', 'Files']))]).toEqual(['Files']);
  await page.goto('/inbox');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Sync is turned off' })).toBeVisible();
  await expect(main.getByRole('link', { name: 'Open Settings > Services' })).toHaveAttribute(
    'href',
    '/settings/services',
  );
});
