import { MEMBER_EMAIL, MEMBER_PASSWORD } from '../lib/env';
import { expect, test } from '../lib/fixtures';
import { ANY_LOGIN, GONE_ROUTE, MEMBER_OPEN, outside, outsideRoutes } from '../workspace/shell-nav';

/**
 * A member chats with its assistant in the panel (W7c, W7f), against a real
 * brain from the W7c release on: it needs the member chat routes, so it does
 * not run against an older brain. Signs in through /login as the member
 * named in E2E_MEMBER_EMAIL / E2E_MEMBER_PASSWORD (skipped without them),
 * opens the assistant panel, sends one message, and checks every request the
 * page made is a route the brain opens to a member: what every login asks,
 * the member's own kept routes, the owner routes of MEMBER_OPEN and the
 * member chat routes below. Nothing on the Admin-only routes (the live
 * stream of a turn, /api/pending, /api/runs, /api/profile), and nothing on
 * a route the brain answers 410.
 */

const ID = '[0-9a-f-]{36}';
const rx = (method: string, path: string) => new RegExp(`^${method} ${path}$`);

/** The chat routes a W7c brain opens to every login, as `METHOD path`. */
const MEMBER_CHAT_OPEN: readonly RegExp[] = [
  rx('GET', '/api/assistant/(thread|messages|threads|conversations|stream)'),
  rx('GET', `/api/assistant/threads/${ID}`),
  rx('POST', '/api/assistant/(turn|threads|read|transcribe)'),
  rx('POST', `/api/assistant/threads/${ID}/(continue|summarize)`),
];

/** What a member may ask; returns what is left over. */
const beyondMember = (asked: readonly string[]) =>
  outsideRoutes(outside(asked, [...ANY_LOGIN, /^\/api\/member\/(realtime|home)$/]), [
    ...MEMBER_OPEN,
    ...MEMBER_CHAT_OPEN,
  ]);

test.describe('member assistant chat', () => {
  test.skip(({ topology }) => topology === 'same-origin', 'owner UI lives on the client app');
  test.skip(!MEMBER_EMAIL || !MEMBER_PASSWORD, 'set E2E_MEMBER_EMAIL and E2E_MEMBER_PASSWORD');

  test('opens the panel and sends a message on member routes only', async ({ visitorPage }) => {
    const page = visitorPage;
    const asked: string[] = [];
    page.on('request', (req) => {
      const url = new URL(req.url());
      if (url.pathname.startsWith('/api/')) asked.push(`${req.method()} ${url.pathname}`);
    });

    await page.goto('/login');
    await page.locator('#email').fill(MEMBER_EMAIL);
    await page.locator('#password').fill(MEMBER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL((u) => u.pathname === '/', { timeout: 60_000 });

    // The Chats window opens on its list; the deep link opens the
    // assistant's own thread in it (a new login has no row for it yet).
    await page.goto('/assistant');
    const box = page.getByPlaceholder(/Message your assistant/);
    await expect(box).toBeEnabled({ timeout: 30_000 });

    const text = `e2e member hello ${Date.now()}`;
    const turn = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/assistant/turn' && r.request().method() === 'POST',
    );
    await box.fill(text);
    await page.getByRole('button', { name: 'Send' }).click();
    expect((await turn).status()).toBeLessThan(400);
    await expect(page.getByText(text)).toBeVisible();
    // A first poll of the thread for the reply.
    await expect
      .poll(() => asked.filter((r) => r.startsWith('GET /api/assistant/messages')).length, {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);

    expect(asked.filter((r) => GONE_ROUTE.test(r.slice(r.indexOf(' ') + 1)))).toEqual([]);
    expect(beyondMember(asked)).toEqual([]);
  });
});
