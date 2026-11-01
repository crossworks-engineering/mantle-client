import { expect, test } from '@playwright/test';
import { signIn, startMockWorkspaceApi, type MockWorkspaceApi } from './mock-workspace-api';

/**
 * Old links to screens that are gone (client/web/lib/route-guard.ts RETIRED).
 * The team-code portal (/team, /hub) and the client sign-in page go to a bare
 * /login, whatever the link carried (a team code, a sign-in token), for a
 * visitor with no session and for a signed-in login alike. Review and Team
 * admin (phase W5c) go to the home. The rules are unit-tested in
 * client/web/lib/route-guard.test.ts; this is the running app, where the boot
 * script sends the page on before it paints. In-memory brain.
 */
let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
});
test.afterEach(async () => {
  await api.close();
});

const OLD_TEAM_CODE = 'Xy7kPq2M';
const TO_LOGIN = [
  `/team?code=${OLD_TEAM_CODE}`,
  `/team/forum?code=${OLD_TEAM_CODE}`,
  '/hub',
  `/client-signin?code=${OLD_TEAM_CODE}`,
];
const TO_HOME = ['/review', '/team-admin', '/apps/review'];

test('an old portal link with no session lands on a bare /login', async ({ page }) => {
  for (const path of TO_LOGIN) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/login$/, { timeout: 60_000 });
    expect(page.url(), path).not.toContain(OLD_TEAM_CODE);
  }
});

test('a signed-in login: portal links go to /login, review links to the home', async ({ page }) => {
  await signIn(page, 'member');
  // Where the page went right after the old link: the boot script's step. A
  // signed-in login may move on from there (/login hands it back to the app),
  // which is the app's business, not the guard's.
  const target = async (path: string) => {
    const seen: string[] = [];
    const onNav = (frame: import('@playwright/test').Frame) => {
      if (frame === page.mainFrame()) {
        const u = new URL(frame.url());
        seen.push(u.pathname + u.search);
      }
    };
    page.on('framenavigated', onNav);
    await page.goto(path);
    await expect.poll(() => seen.length, { message: path }).toBeGreaterThan(1);
    page.off('framenavigated', onNav);
    // seen[0] is the old link itself; nothing after it may carry the code.
    expect(seen.slice(1).join(' '), path).not.toContain(OLD_TEAM_CODE);
    return seen[1];
  };
  for (const path of TO_LOGIN) expect(await target(path), path).toBe('/login');
  for (const path of TO_HOME) expect(await target(path), path).toBe('/');
});
