import { expect, test } from '@playwright/test';
import { signIn, startMockWorkspaceApi, type MockWorkspaceApi } from './mock-workspace-api';

/**
 * The Desk on the login's profile (desk saving v2): its own route, GET and
 * PUT /api/profile/home-desk, compare-and-set on a version. A change is saved
 * once, from the version read; it is read back after a reload; and when
 * another device saved first, its desk shows with one quiet toast. A member,
 * as every login saves its own desk. In-memory brain, no real one.
 */

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
});
test.afterEach(async () => {
  await api.close();
});

type Desk = { items: Array<{ id: string }> };

test("the Desk is saved to the login, and another device's save wins", async ({ page }) => {
  await signIn(page, 'member');
  const main = page.getByRole('main');
  const widget = (name: string) => main.getByRole('region', { name, exact: true });
  const puts = () =>
    api.requests.filter((r) => r.method === 'PUT' && r.path === '/api/profile/home-desk');
  await expect(main.getByRole('heading', { name: 'Desk', level: 1 })).toBeVisible();
  await expect(widget('Clock')).toBeVisible();
  await expect(widget('Focus')).toHaveCount(0);

  // A change: saved once, from version 0.
  await main.getByRole('button', { name: 'Customize' }).click();
  await page.getByRole('switch', { name: 'Focus timer' }).click();
  await expect(widget('Focus')).toBeVisible();
  await expect.poll(() => api.desks.member?.version).toBe(1);
  expect(puts()).toHaveLength(1);
  expect((api.desks.member!.homeDesk as Desk).items.map((i) => i.id)).toContain('focus');

  // Read back from the brain after a reload.
  await page.reload();
  await expect(widget('Focus')).toBeVisible();

  // Another device saves a desk without the clock (version 2). A change here,
  // sent from version 1, loses: that desk shows, with one quiet toast, and
  // nothing is sent again.
  const theirs = api.desks.member!.homeDesk as Desk;
  api.desks.member = {
    homeDesk: { ...theirs, items: theirs.items.filter((i) => i.id !== 'clock') },
    version: 2,
  };
  await main.getByRole('button', { name: 'Customize' }).click();
  await page.getByRole('switch', { name: 'Theme' }).click();
  await expect(page.getByText('Your Desk changed on another device')).toBeVisible();
  await expect(widget('Clock')).toHaveCount(0);
  await expect(widget('Theme')).toBeVisible();
  await expect(widget('Focus')).toBeVisible();
  expect(puts()).toHaveLength(2);
  expect(api.desks.member?.version).toBe(2);
});
