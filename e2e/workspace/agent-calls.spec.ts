import { expect, test, type Page } from '@playwright/test';
import { signIn, startMockWorkspaceApi, type MockWorkspaceApi } from './mock-workspace-api';

/**
 * An in-app agent drives the window (lib/agent-ui/turn-calls, plan page
 * 596dbe4d phase 3), the window's half: a `ui-call` turn event is played
 * here through the dev build's `window.__mantleAgentCalls` (this brain has
 * no assistant), and the answers land on the mock's answer route.
 * In-memory brain, no real one.
 */

const TURN = 'turn-e2e-1';
let n = 0;
const callId = () => `0a0a0a0a-0a0a-40a0-80a0-${String(++n).padStart(12, '0')}`;

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
});
test.afterEach(async () => {
  await api.close();
});

async function call(page: Page, action: string, args: Record<string, unknown> = {}) {
  const id = callId();
  // Fired, not awaited: the handler may wait on the user (the consent prompt).
  await page.evaluate(
    ([turn, data]) => {
      void (
        window as unknown as {
          __mantleAgentCalls: { handleUiCall: (t: string, d: unknown, a: string) => Promise<void> };
        }
      ).__mantleAgentCalls.handleUiCall(turn, data, 'Saskia');
    },
    [TURN, { callId: id, action, args }] as const,
  );
  await expect.poll(() => api.uiAnswers.find((a) => a.callId === id)).toBeTruthy();
  return api.uiAnswers.find((a) => a.callId === id)!;
}

async function ready(page: Page) {
  await page.waitForFunction(() => '__mantleAgentCalls' in window);
  await page.evaluate(() =>
    (
      window as unknown as {
        __mantleAgentCalls: { loadAgentUiSetting: (f: boolean) => Promise<boolean> };
      }
    ).__mantleAgentCalls.loadAgentUiSetting(true),
  );
}

test('the setting is off by default: a call is refused and nothing is asked', async ({ page }) => {
  await signIn(page, 'admin');
  await ready(page);
  const a = await call(page, 'screen');
  expect(a.result).toMatchObject({ ok: false, error: 'no_session' });
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('the profile menu turns it on for the login', async ({ page }) => {
  await signIn(page, 'admin');
  await page
    .getByRole('button', { name: /Ada Admin/ })
    .first()
    .click();
  await page.getByRole('menuitemcheckbox', { name: 'Let agents use this window' }).click();
  await expect.poll(() => api.agentUi.admin).toBe(true);
});

test('the first call asks the user; once allowed, calls run and answer with this window', async ({
  page,
}) => {
  api.agentUi.admin = true;
  await signIn(page, 'admin');
  await ready(page);

  const first = await call(page, 'screen');
  expect(first.result).toMatchObject({ ok: false, error: 'needs_consent' });
  const ask = page.getByRole('alertdialog', {
    name: 'Saskia wants to show you around in this window',
  });
  await expect(ask).toBeVisible();
  await expect(ask.getByRole('button', { name: 'Allow for this session' })).toBeEnabled();
  await ask.getByRole('button', { name: 'Allow for this session' }).click();

  const windowId = await page.evaluate(
    () =>
      (window as unknown as { __mantleAgentCalls: { windowId: string } }).__mantleAgentCalls
        .windowId,
  );
  const read = await call(page, 'screen');
  expect(read.windowId).toBe(windowId);
  expect(read.result).toMatchObject({ ok: true });
  await expect(page.getByText('Saskia is using this window.')).toBeVisible();

  // A write the agent sets off names its call; the brain would refuse a
  // risky one. A setting the user allows goes without the name.
  await call(page, 'type', { target: { role: 'textbox', name: 'Quick note' }, text: 'Milk' });
  const add = await call(page, 'click', { target: { role: 'button', name: 'Add note' } });
  const notePost = api.requests.find((r) => r.method === 'POST' && r.path === '/api/notes');
  expect(notePost?.agentCall).toBe(add.callId);

  expect((await call(page, 'navigate', { path: '/settings/profile' })).result).toMatchObject({
    ok: true,
  });
  const clicking = call(page, 'click', { target: { role: 'switch', name: 'Sounds' } });
  const held = page.getByRole('alertdialog', { name: /wants to change a setting/ });
  await expect(held.getByRole('button', { name: 'Allow once' })).toBeEnabled();
  await held.getByRole('button', { name: 'Allow once' }).click();
  expect((await clicking).result).toMatchObject({ ok: true });
  const put = api.requests.find((r) => r.method === 'PUT' && r.path === '/api/profile/sounds');
  expect(put).toBeTruthy();
  expect(put?.agentCall).toBeUndefined();
});

test('Not now refuses, and a call is never run twice', async ({ page }) => {
  api.agentUi.admin = true;
  await signIn(page, 'admin');
  await ready(page);
  await call(page, 'screen');
  await page.getByRole('button', { name: 'Not now' }).click();
  const after = await call(page, 'screen');
  expect(after.result).toMatchObject({ ok: false, error: 'needs_consent' });
  // No second prompt in this page's life.
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});
