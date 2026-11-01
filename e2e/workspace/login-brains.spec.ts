import { createServer, type Server } from 'node:http';
import { expect, test, type Page, type Route } from '@playwright/test';
import {
  MOCK_API_ORIGIN,
  startMockWorkspaceApi,
  type MockWorkspaceApi,
} from './mock-workspace-api';

/**
 * The sign-in screen against more than one brain, and against every way a
 * sign-in can fail. No brain: the default one is the in-memory brain
 * (mock-workspace-api.ts), the others are the small servers below.
 *
 * The desktop shell serves ONE static copy of the owner UI to every brain
 * window, and each window's host answers its /env.js with that window's
 * brain: its origin and its public appearance (docs/static-ui-host.md). A
 * second brain's window once came out wearing the first one's branding, with a
 * CSP that refused its own brain, so sign-in said "Could not reach the
 * server". These specs answer /env.js the way the shell's host does, and the
 * page must wear and reach only that brain.
 */

let api: MockWorkspaceApi;
const brains: Server[] = [];
test.afterEach(async () => {
  await api?.close();
  await Promise.all(brains.splice(0).map((s) => new Promise((r) => s.close(r))));
});

/** A brain of its own: its name, and its own refusal of a wrong password. */
async function startBrain(name: string): Promise<string> {
  const server = createServer((req, res) => {
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization',
      'content-type': 'application/json',
      'cache-control': 'no-store',
    };
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, headers);
      res.end(JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') return reply(204, {});
    if (path === '/api/appearance') return reply(200, { siteName: name });
    if (path === '/api/auth/bootstrap-state') return reply(200, { firstRun: false });
    if (path === '/api/auth/token') return reply(401, { error: `${name} refused that password.` });
    return reply(404, { error: 'not here' });
  });
  brains.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as { port: number };
  return `http://127.0.0.1:${port}`;
}

/** This page's /env.js names `brain`, as the shell's host does for its window. */
async function asWindowOf(page: Page, baseURL: string, brain: string, name: string) {
  const env = {
    apiBase: brain,
    serverOrigin: brain,
    turnStreaming: '',
    tour: '',
    appearance: { siteName: name },
  };
  await page.route(`${new URL(baseURL).origin}/env.js`, (route) =>
    route.fulfill({
      contentType: 'application/javascript; charset=utf-8',
      headers: { 'cache-control': 'no-store' },
      body: `window.__MANTLE_ENV__ = ${JSON.stringify(env)};`,
    }),
  );
}

const signInButton = (page: Page) => page.getByRole('button', { name: 'Sign in' });

async function submit(page: Page) {
  await page.locator('#email').fill('probe@example.invalid');
  await page.locator('#password').fill('not-the-password-1');
  await signInButton(page).click();
}

test.describe('a brain other than the one the UI was started with', () => {
  test.beforeEach(async ({ baseURL }) => {
    api = await startMockWorkspaceApi(new URL(baseURL!).origin);
  });

  for (const count of [2, 3]) {
    test(`${count} brains: each window wears its own brain and signs in to it`, async ({
      page,
      baseURL,
    }) => {
      const others = await Promise.all(
        Array.from({ length: count - 1 }, (_, i) => startBrain(`Brain ${i + 2}`)),
      );
      for (const [i, brain] of others.entries()) {
        const name = `Brain ${i + 2}`;
        const violations: string[] = [];
        page.on('console', (m) => {
          if (/Content Security Policy/.test(m.text())) violations.push(m.text());
        });
        await page.unrouteAll();
        await asWindowOf(page, baseURL!, brain, name);
        await page.goto('/login');
        // Its own branding, its own address on the screen, its own env.
        await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 60_000 });
        await expect(page).toHaveTitle(name);
        await expect(page.getByTestId('login-server')).toHaveText(
          `Signing in to ${new URL(brain).host}`,
        );
        const env = await page.evaluate(
          () => (window as { __MANTLE_ENV__?: { apiBase?: string } }).__MANTLE_ENV__,
        );
        expect(env?.apiBase).toBe(brain);
        // And the password goes to it: its own 401, not "Could not reach".
        await submit(page);
        await expect(page.getByText(`${name} refused that password.`)).toBeVisible();
        await expect(signInButton(page)).toBeEnabled();
        expect(violations).toEqual([]);
      }
    });
  }
});

test.describe('Sign in comes back after every failure', () => {
  test.beforeEach(async ({ baseURL }) => {
    api = await startMockWorkspaceApi(new URL(baseURL!).origin);
  });

  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization',
  };
  const failures: [string, (route: Route) => Promise<void>, RegExp][] = [
    ['the network', (route) => route.abort('failed'), /Could not reach the server/],
    [
      'a 4xx',
      (route) =>
        route.fulfill({ status: 429, headers: cors, json: { error: 'Too many attempts.' } }),
      /Too many attempts\./,
    ],
    [
      'a 5xx with no JSON',
      (route) => route.fulfill({ status: 502, headers: cors, body: '<html>Bad gateway</html>' }),
      /Sign-in failed\./,
    ],
    [
      'a 200 that is not JSON',
      (route) => route.fulfill({ status: 200, headers: cors, body: 'captive portal' }),
      /unexpected response/,
    ],
  ];

  test('network, 4xx, 5xx and bad JSON, one after another, then the real answer', async ({
    page,
  }) => {
    await page.goto('/login');
    await expect(signInButton(page)).toBeVisible({ timeout: 60_000 });
    for (const [, fail, message] of failures) {
      await page.route(`${MOCK_API_ORIGIN}/api/auth/token`, (route) =>
        route.request().method() === 'OPTIONS'
          ? route.fulfill({ status: 204, headers: cors })
          : fail(route),
      );
      await submit(page);
      await expect(page.getByText(message)).toBeVisible();
      await expect(signInButton(page)).toBeEnabled();
      await page.unroute(`${MOCK_API_ORIGIN}/api/auth/token`);
    }
    // Usable again means usable: the next press reaches the brain.
    await submit(page);
    await expect(page.getByText('Invalid email or password.')).toBeVisible();
    await expect(signInButton(page)).toBeEnabled();
    expect(api.signIns).toEqual([{ email: 'probe@example.invalid', status: 401 }]);
  });
});
