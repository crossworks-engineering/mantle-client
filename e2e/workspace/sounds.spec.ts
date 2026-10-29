import { expect, test } from '@playwright/test';
import { signIn, startMockWorkspaceApi, type MockWorkspaceApi } from './mock-workspace-api';

/**
 * The UI sounds on the profile screen: a change is saved at once to the
 * login's own copy (PUT /api/profile/sounds), and the save names the login
 * the tab shows (`loginId`), which the brain holds to the session's login
 * (403 login-mismatch otherwise).
 * In-memory brain, no real one.
 */

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
});
test.afterEach(async () => {
  await api.close();
});

test('a sound change is saved to the login, naming it', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/settings/profile');
  const sounds = page.getByRole('switch', { name: 'Sounds' });
  await expect(sounds).toBeChecked();

  await sounds.click();
  await expect(sounds).not.toBeChecked();
  // The mock stores a PUT only when its loginId is this login's.
  await expect.poll(() => api.sounds.admin?.enabled).toBe(false);
  const puts = api.requests.filter((r) => r.method === 'PUT' && r.path === '/api/profile/sounds');
  expect(puts).toHaveLength(1);
});
