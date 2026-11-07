import { expect, test, type Page } from '@playwright/test';
import { LOGINS, signIn, startMockWorkspaceApi, type MockWorkspaceApi } from './mock-workspace-api';

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

async function call(
  page: Page,
  action: string,
  args: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) {
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
    [TURN, { callId: id, action, args, ...extra }] as const,
  );
  await expect.poll(() => api.uiAnswers.find((a) => a.callId === id)).toBeTruthy();
  return api.uiAnswers.find((a) => a.callId === id)!;
}

/** A turn's first click, type or select: it asks "Allow Saskia to act in
 *  this window for this turn?" first (ask once per turn); Allow, then its
 *  answer. */
async function firstAct(page: Page, action: string, args: Record<string, unknown>, allow = true) {
  const going = call(page, action, args);
  const ask = page.getByRole('alertdialog', {
    name: 'Allow Saskia to act in this window for this turn?',
  });
  const button = ask.getByRole('button', { name: allow ? 'Allow' : 'Not now', exact: true });
  await expect(button).toBeEnabled();
  await button.click();
  return going;
}

async function ready(page: Page) {
  await page.waitForFunction(() => '__mantleAgentCalls' in window);
  await page.evaluate(async (turn) => {
    const calls = (
      window as unknown as {
        __mantleAgentCalls: {
          loadAgentUiSetting: (f: boolean) => Promise<boolean>;
          claimTurn: (t: string) => void;
        };
      }
    ).__mantleAgentCalls;
    await calls.loadAgentUiSetting(true);
    // As the dock does when its turn is accepted.
    calls.claimTurn(turn);
  }, TURN);
}

test('the setting is off by default: the window claims no turn and runs nothing', async ({
  page,
}) => {
  await signIn(page, 'admin');
  await ready(page);
  const id = callId();
  await page.evaluate(
    ([turn, data]) => {
      void (
        window as unknown as {
          __mantleAgentCalls: { handleUiCall: (t: string, d: unknown, a: string) => Promise<void> };
        }
      ).__mantleAgentCalls.handleUiCall(turn, data, 'Saskia');
    },
    [TURN, { callId: id, action: 'screen', args: {} }] as const,
  );
  await page.waitForTimeout(500);
  // The brain offers no ui tools then either; nothing runs and nothing is asked.
  expect(api.uiAnswers).toHaveLength(0);
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
  await firstAct(page, 'type', { target: { role: 'textbox', name: 'Quick note' }, text: 'Milk' });
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

test('a turn this window did not send is not acted on here', async ({ page }) => {
  api.agentUi.admin = true;
  await signIn(page, 'admin');
  await ready(page);
  const id = callId();
  await page.evaluate(
    ([data]) => {
      void (
        window as unknown as {
          __mantleAgentCalls: { handleUiCall: (t: string, d: unknown, a: string) => Promise<void> };
        }
      ).__mantleAgentCalls.handleUiCall('another-turn', data, 'Saskia');
    },
    [{ callId: id, action: 'screen', args: {} }] as const,
  );
  await page.waitForTimeout(500);
  expect(api.uiAnswers.find((a) => a.callId === id)).toBeUndefined();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('Stop stops the agent: its turn is cancelled and later calls answer stopped', async ({
  page,
}) => {
  api.agentUi.admin = true;
  await signIn(page, 'admin');
  await ready(page);
  await call(page, 'screen');
  await page.getByRole('button', { name: 'Allow for this session' }).click();
  expect((await call(page, 'screen')).result).toMatchObject({ ok: true });

  await page.getByRole('button', { name: 'Stop' }).click();
  await expect.poll(() => api.asked('admin')).toContain(`POST /api/assistant/turn/${TURN}/cancel`);
  const after = await call(page, 'screen');
  expect(after.result).toMatchObject({ ok: false, error: 'stopped' });
  await expect(page.getByText('Saskia is using this window.')).toHaveCount(0);
});

test('a member turns it on, and its own window answers its agent', async ({ page }) => {
  await signIn(page, 'member');
  await page
    .getByRole('button', { name: /Mo Member/ })
    .first()
    .click();
  await page.getByRole('menuitemcheckbox', { name: 'Let agents use this window' }).click();
  await expect.poll(() => api.agentUi.member).toBe(true);
  await page.keyboard.press('Escape');

  await ready(page);
  expect((await call(page, 'screen')).result).toMatchObject({
    ok: false,
    error: 'needs_consent',
  });
  await page.getByRole('button', { name: 'Allow for this session' }).click();
  const read = await call(page, 'screen');
  expect(read.role).toBe('member');
  expect(read.result).toMatchObject({ ok: true });
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

test('a write the brain refuses as the agent’s is held; Allow once sends it again, untagged', async ({
  page,
}) => {
  api.agentUi.admin = true;
  api.refuseAgentWrites = /^\/api\/notes$/;
  await signIn(page, 'admin');
  await ready(page);
  await call(page, 'screen');
  await page.getByRole('button', { name: 'Allow for this session' }).click();

  await firstAct(page, 'type', { target: { role: 'textbox', name: 'Quick note' }, text: 'Milk' });
  const adding = call(page, 'click', { target: { role: 'button', name: 'Add note' } });
  const held = page.getByRole('alertdialog', {
    name: 'Saskia wants to send, share or publish something',
  });
  await expect(held.getByText('POST /api/notes')).toBeVisible();
  await expect(held.getByRole('button', { name: 'Allow once' })).toBeEnabled();
  await held.getByRole('button', { name: 'Allow once' }).click();
  const add = await adding;
  expect(add.result).toMatchObject({ ok: true });
  const posts = api.requests.filter((r) => r.method === 'POST' && r.path === '/api/notes');
  expect(posts.map((r) => r.agentCall)).toEqual([add.callId, undefined]);
});

test('Not now on a refused write sends nothing more, and the agent hears needs_user', async ({
  page,
}) => {
  api.agentUi.admin = true;
  api.refuseAgentWrites = /^\/api\/notes$/;
  await signIn(page, 'admin');
  await ready(page);
  await call(page, 'screen');
  await page.getByRole('button', { name: 'Allow for this session' }).click();

  await firstAct(page, 'type', { target: { role: 'textbox', name: 'Quick note' }, text: 'Milk' });
  const adding = call(page, 'click', { target: { role: 'button', name: 'Add note' } });
  const held = page.getByRole('alertdialog', {
    name: 'Saskia wants to send, share or publish something',
  });
  await held.getByRole('button', { name: 'Not now' }).click();
  expect((await adding).result).toMatchObject({ ok: false, error: 'needs_user' });
  const posts = api.requests.filter((r) => r.method === 'POST' && r.path === '/api/notes');
  expect(posts).toHaveLength(1);
});

test('a typed text is added after what the field holds', async ({ page }) => {
  api.agentUi.admin = true;
  await signIn(page, 'admin');
  await ready(page);
  await call(page, 'screen');
  await page.getByRole('button', { name: 'Allow for this session' }).click();
  const box = { role: 'textbox', name: 'Quick note' };
  await firstAct(page, 'type', { target: box, text: 'Buy ' });
  await call(page, 'type', { target: box, text: 'milk' });
  const field = page.getByPlaceholder('Jot it down… the first line becomes the title');
  await expect(field).toHaveValue('Buy milk');
  // Replacing what the field holds waits for the user.
  const replacing = call(page, 'type', { target: box, text: 'Bread', replace: true });
  const held = page.getByRole('alertdialog', { name: 'Saskia wants to replace what is there' });
  await expect(held.getByRole('button', { name: 'Allow once' })).toBeEnabled();
  await held.getByRole('button', { name: 'Allow once' }).click();
  expect((await replacing).result).toMatchObject({ ok: true });
  await expect(field).toHaveValue('Bread');
});

test('the chat streams, answers and stops on the 202’s turn id, never the key', async ({
  page,
}) => {
  api.agentUi.admin = true;
  const id = callId();
  api.turnEvents = [{ type: 'ui-call', data: { callId: id, action: 'screen', args: {} } }];
  await signIn(page, 'admin');
  await page.getByRole('button', { name: 'Toggle assistant (⌘I)' }).click();
  const box = page.getByPlaceholder(/Enter to send/);
  await box.fill('Show me around');
  await box.press('Enter');

  await expect.poll(() => api.turns.length).toBe(1);
  const turn = api.turns[0]!;
  expect(turn.turnId).toBe(`turn-${LOGINS.admin.loginId}.${turn.key}`);
  await expect
    .poll(() => api.asked('admin'))
    .toContain(`GET /api/assistant/turn/${turn.turnId}/stream`);
  // The agent's call is answered on the turn the 202 named.
  await expect.poll(() => api.uiAnswers.find((a) => a.callId === id)?.turnId).toBe(turn.turnId);
  await page.getByRole('button', { name: 'Not now' }).click();

  await page.getByTitle('Stop generating').click();
  await expect
    .poll(() => api.asked('admin'))
    .toContain(`POST /api/assistant/turn/${turn.turnId}/cancel`);
  expect(api.asked('admin').some((r) => r.includes(`/api/assistant/turn/${turn.key}/`))).toBe(
    false,
  );
});

test('a call past its expiresAt is answered window_gone and not run', async ({ page }) => {
  api.agentUi.admin = true;
  await signIn(page, 'admin');
  await ready(page);
  await call(page, 'screen');
  await page.getByRole('button', { name: 'Allow for this session' }).click();
  const late = await call(
    page,
    'navigate',
    { path: '/settings/profile' },
    { expiresAt: new Date(Date.now() - 1000).toISOString() },
  );
  expect(late.result).toMatchObject({ ok: false, error: 'window_gone' });
  await expect(page).toHaveURL((u) => u.pathname === '/');
  const inTime = await call(
    page,
    'navigate',
    { path: '/settings/profile' },
    { expiresAt: new Date(Date.now() + 60_000).toISOString() },
  );
  expect(inTime.result).toMatchObject({ ok: true });
});

test('after Not now, the user’s own save of the agent’s change is asked about again', async ({
  page,
}) => {
  api.agentUi.admin = true;
  api.refuseAgentWrites = /^\/api\/notes$/;
  await signIn(page, 'admin');
  await ready(page);
  await call(page, 'screen');
  await page.getByRole('button', { name: 'Allow for this session' }).click();

  await firstAct(page, 'type', { target: { role: 'textbox', name: 'Quick note' }, text: 'Milk' });
  const adding = call(page, 'click', { target: { role: 'button', name: 'Add note' } });
  const held = page.getByRole('alertdialog', {
    name: 'Saskia wants to send, share or publish something',
  });
  await held.getByRole('button', { name: 'Not now' }).click();
  expect((await adding).result).toMatchObject({ ok: false, error: 'needs_user' });

  // The text is still in the box; the user presses Add note themselves.
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  const ask = page.getByRole('alertdialog', { name: 'Save the changes the assistant made?' });
  await expect(ask.getByRole('button', { name: /Discard the assistant/ })).toBeVisible();
  await expect(ask.getByRole('button', { name: 'Save' })).toBeEnabled();
  await ask.getByRole('button', { name: 'Save' }).click();
  await expect
    .poll(() => api.requests.filter((r) => r.method === 'POST' && r.path === '/api/notes').length)
    .toBe(2);
  const posts = api.requests.filter((r) => r.method === 'POST' && r.path === '/api/notes');
  expect(posts[1]!.agentCall).toBeUndefined();
});

test('a turn asks once before it acts; Not now refuses the rest of it; a new turn asks again', async ({
  page,
}) => {
  api.agentUi.admin = true;
  await signIn(page, 'admin');
  await ready(page);
  await call(page, 'screen');
  await page.getByRole('button', { name: 'Allow for this session' }).click();
  const box = { role: 'textbox', name: 'Quick note' };
  const ask = page.getByRole('alertdialog', {
    name: 'Allow Saskia to act in this window for this turn?',
  });

  // Reads never ask.
  expect((await call(page, 'screen')).result).toMatchObject({ ok: true });
  await expect(ask).toHaveCount(0);

  // Not now: this call and the rest of the turn are the user's.
  const refused = await firstAct(page, 'type', { target: box, text: 'Milk' }, false);
  expect(refused.result).toMatchObject({ ok: false, error: 'needs_user' });
  expect((await call(page, 'type', { target: box, text: 'Milk' })).result).toMatchObject({
    ok: false,
    error: 'needs_user',
  });
  await expect(ask).toHaveCount(0);
  await expect(page.getByPlaceholder('Jot it down… the first line becomes the title')).toHaveValue(
    '',
  );

  // A new turn asks again; once allowed, its next acting call does not.
  await page.evaluate(() => {
    (
      window as unknown as { __mantleAgentCalls: { claimTurn: (t: string) => void } }
    ).__mantleAgentCalls.claimTurn('turn-e2e-2');
  });
  const second = await (async () => {
    const id = callId();
    await page.evaluate(
      ([data]) => {
        void (
          window as unknown as {
            __mantleAgentCalls: {
              handleUiCall: (t: string, d: unknown, a: string) => Promise<void>;
            };
          }
        ).__mantleAgentCalls.handleUiCall('turn-e2e-2', data, 'Saskia');
      },
      [{ callId: id, action: 'type', args: { target: box, text: 'Bread' } }] as const,
    );
    await ask.getByRole('button', { name: 'Allow', exact: true }).click();
    await expect.poll(() => api.uiAnswers.find((a) => a.callId === id)).toBeTruthy();
    return api.uiAnswers.find((a) => a.callId === id)!;
  })();
  expect(second.result).toMatchObject({ ok: true });
  await expect(page.getByPlaceholder('Jot it down… the first line becomes the title')).toHaveValue(
    'Bread',
  );
});
