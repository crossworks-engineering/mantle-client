import { expect, test } from '@playwright/test';
import {
  LOGINS,
  PAGES,
  signIn,
  startMockWorkspaceApi,
  type MockWorkspaceApi,
} from './mock-workspace-api';
import { ADMIN_ROWS, GONE_ROUTE, WORK_ROWS, rowsInAnyScope, scopedNav } from './shell-nav';

/**
 * An admin in the one shell (phase W5c): every area, so the full nav with
 * Settings > Users, and the owner Pages screen, which reads the owner tree
 * (GET /api/tree/pages) and so every page of the brain. In-memory brain, no
 * real one.
 */
/** The Users screen's retired reads (410 on a W5c brain; the email code
 *  sender on a W8 one). */
const GONE =
  /\/api\/team-admin\/(submissions|member-items|needs-you|requests|notify)|\/api\/team-admin\/clients|\/api\/access\/client-report|\/api\/apps\/members/;

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
});
test.afterEach(async () => {
  await api.close();
});

test('the full nav, the owner Pages screen and Settings > Users', async ({ page }) => {
  await signIn(page, 'admin');
  const rows = [...WORK_ROWS, ...ADMIN_ROWS, 'Workspaces'];
  expect([...(await rowsInAnyScope(page, rows))].sort()).toEqual([...rows].sort());

  const nav = await scopedNav(page, 'Work');
  await nav.getByRole('link', { name: 'Pages', exact: true }).click();
  // Home lists the newest pages too (task d78e7bde): be on Pages first.
  await expect(page).toHaveURL((u) => u.pathname === '/pages');
  await expect.poll(() => api.asked('admin')).toContain('GET /api/tree/pages');
  const main = page.getByRole('main');
  for (const p of Object.values(PAGES)) {
    await expect(main.getByText(p.title, { exact: true }), p.title).toBeVisible();
  }
  expect(api.asked('admin')).toContain('GET /api/tree/pages');

  // Users is plumbing, so the Admin scope holds it.
  const admin = await scopedNav(page, 'Admin');
  await admin.getByRole('link', { name: 'Users', exact: true }).click();
  await expect(page).toHaveURL((u) => u.pathname === '/settings/users');
  await expect(main.getByText(LOGINS.member.name).first()).toBeVisible();
  // No sign-in by email code and no client login (W8).
  await expect(main.getByText('Sign-in by email code')).toHaveCount(0);
  await expect(main.getByText(/client login/i)).toHaveCount(0);
  await expect(page.getByText('You cannot manage this part of the brain.')).toHaveCount(0);
  const asked = api.asked('admin');
  for (const read of ['/api/users', '/api/team-admin/invites']) {
    expect(asked, read).toContain(`GET ${read}`);
  }
  expect(asked.filter((r) => /\/api\/(client|member)\//.test(r))).toEqual([]);
  // The routes a W5c, W6b or W8 brain answers 410: never asked.
  expect(asked.filter((r) => GONE.test(r))).toEqual([]);
  expect(asked.filter((r) => GONE_ROUTE.test(r.slice(r.indexOf(' ') + 1)))).toEqual([]);
  // The admin's live updates are the owner stream.
  expect(asked).not.toContain('GET /api/member/realtime');
});
