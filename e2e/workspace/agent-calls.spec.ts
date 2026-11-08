import { agentView } from './window-view';
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

  // The agent acts with the user's own rights, as the user would: its
  // writes go as they are, a setting too, with no question and no tag.
  await firstAct(page, 'type', { target: { role: 'textbox', name: 'Quick note' }, text: 'Milk' });
  expect(
    (await call(page, 'click', { target: { role: 'button', name: 'Add note' } })).result,
  ).toMatchObject({ ok: true });
  const notePost = api.requests.find((r) => r.method === 'POST' && r.path === '/api/notes');
  expect(notePost).toBeTruthy();
  expect(notePost?.agentCall).toBeUndefined();

  expect((await call(page, 'navigate', { path: '/settings/profile' })).result).toMatchObject({
    ok: true,
  });
  expect(
    (await call(page, 'click', { target: { role: 'switch', name: 'Sounds' } })).result,
  ).toMatchObject({ ok: true });
  await expect
    .poll(() => api.requests.find((r) => r.method === 'PUT' && r.path === '/api/profile/sounds'))
    .toBeTruthy();
  expect(api.requests.some((r) => r.agentCall !== undefined)).toBe(false);
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
  // replace: true puts it in place of what is there.
  expect(
    (await call(page, 'type', { target: box, text: 'Bread', replace: true })).result,
  ).toMatchObject({ ok: true });
  await expect(field).toHaveValue('Bread');
});

test('the chat streams, answers and stops on the 202’s turn id, never the key', async ({
  page,
}) => {
  api.agentUi.admin = true;
  const id = callId();
  api.turnEvents = [{ type: 'ui-call', data: { callId: id, action: 'screen', args: {} } }];
  await agentView(page);
  await signIn(page, 'admin');
  await page.getByRole('button', { name: 'Toggle chats (⌘I)' }).click();
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

test('ui_look: a picture of the work area, an app frame drawn into it, a secret painted over', async ({
  page,
}) => {
  api.agentUi.admin = true;
  await signIn(page, 'admin');
  await ready(page);
  await call(page, 'screen');
  await page.getByRole('button', { name: 'Allow for this session' }).click();

  // An app frame in the work area that answers a `look` with a red picture
  // of itself, as the brain's frame document does, and a secret field.
  await page.evaluate(() => {
    const main = document.querySelector('main[data-tour="main"]')!;
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.style.cssText =
      'position:absolute;top:0;left:0;width:200px;height:100px;border:0;z-index:50';
    frame.srcdoc = `<script>
      addEventListener('message', function (e) {
        var m = e.data; if (!m || m.kind !== 'look') return;
        var c = document.createElement('canvas'); c.width = 20; c.height = 10;
        var g = c.getContext('2d'); g.fillStyle = '#ff0000'; g.fillRect(0, 0, 20, 10);
        parent.postMessage({ v: 1, kind: 'look.res', id: m.id, ok: true, dataUrl: c.toDataURL() }, '*');
      });
    </script>`;
    const secret = document.createElement('div');
    secret.setAttribute('data-secret', '');
    secret.style.cssText =
      'position:absolute;top:120px;left:0;width:200px;height:40px;background:#00ff00;z-index:50';
    main.append(frame, secret);
  });
  await page.waitForTimeout(300);

  const looked = await call(page, 'look', { scope: 'work' });
  const r = looked.result as {
    ok: boolean;
    scope: string;
    width: number;
    height: number;
    blanked: number;
    blankFrames: number;
    image: { mimeType: string; base64: string };
  };
  expect(r).toMatchObject({ ok: true, scope: 'work', blankFrames: 0 });
  expect(r.blanked).toBeGreaterThanOrEqual(1);
  expect(r.image.mimeType).toBe('image/png');
  expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(1568);
  expect((r.image.base64.length * 3) / 4).toBeLessThanOrEqual(1024 * 1024);

  // The frame's own picture is in its box; the secret is a grey box.
  const px = await page.evaluate(
    async ({ base64, width }) => {
      const main = document.querySelector('main[data-tour="main"]')!.getBoundingClientRect();
      const k = width / main.width;
      const img = new Image();
      img.src = `data:image/png;base64,${base64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const at = (x: number, y: number) => [...g.getImageData(x * k, y * k, 1, 1).data.slice(0, 3)];
      return { frame: at(100, 50), secret: at(100, 140) };
    },
    { base64: r.image.base64, width: r.width },
  );
  expect(px.frame).toEqual([255, 0, 0]);
  expect(px.secret).toEqual([128, 128, 128]);
});
