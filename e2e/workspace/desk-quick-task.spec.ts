import { expect, test } from '@playwright/test';
import { signIn, startMockWorkspaceApi, type MockWorkspaceApi } from './mock-workspace-api';

/**
 * Quick task, the twin of Quick note: a task from the Desk. Offered only to a
 * login that has Tasks; the first line is the title and the rest the body;
 * it lands in the workspace the switcher shows (the create route's `?ws=`),
 * and the box clears. In-memory brain, no real one.
 */

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
});
test.afterEach(async () => {
  await api.close();
});

const customize = async (page: import('@playwright/test').Page) =>
  page.getByRole('main').getByRole('button', { name: 'Customize' }).click();

test('Quick task adds a task, with its body, in the picked workspace', async ({ page }) => {
  api.tasksKind = true;
  // The Admin user: the brain opens POST /api/tasks to it (not to a member).
  await signIn(page, 'admin');
  await customize(page);
  await page.getByRole('switch', { name: 'Quick task' }).click();
  await page.keyboard.press('Escape');

  // Team, where the Admin user is a Moderator.
  await page
    .getByRole('button', { name: /^Workspace:/ })
    .first()
    .click();
  await page.getByRole('menuitemradio', { name: /^Team( Moderator)?$/ }).click();
  await expect(page.getByRole('button', { name: 'Workspace: Team' }).first()).toBeVisible();

  const box = page.getByRole('main').getByRole('textbox', { name: 'Quick task' });
  await box.fill('Book the venue\nfor 40 people');
  await box.press('ControlOrMeta+Enter');
  await expect(page.getByText('Task added')).toBeVisible();
  await expect(box).toHaveValue('');
  expect(api.tasks.map((t) => [t.title, t.body, t.ws])).toEqual([
    ['Book the venue', 'for 40 people', 'team'],
  ]);
});

test('a login without Tasks is not offered Quick task', async ({ page }) => {
  await signIn(page, 'member');
  await customize(page);
  await expect(page.getByRole('switch', { name: 'Quick note' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Quick task' })).toHaveCount(0);
});
