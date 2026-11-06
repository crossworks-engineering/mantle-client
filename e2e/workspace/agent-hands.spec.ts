import { expect, test, type Page } from '@playwright/test';
import { signIn, startMockWorkspaceApi, type MockWorkspaceApi } from './mock-workspace-api';

/**
 * The agent's hands (lib/agent-ui, plan page 596dbe4d phase 1): an agent
 * drives this window while the user watches. The specs call the controller
 * a dev build exposes (`window.__mantleAgentHands`), as a lesson will.
 * In-memory brain, no real one.
 */

type Result = {
  ok: boolean;
  error?: string;
  screen?: { entries: { id?: string; role: string; name: string }[] };
};

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
});
test.afterEach(async () => {
  await api.close();
});

/** Call one of the controller's methods in the page. */
function hands(page: Page, method: string, ...args: unknown[]): Promise<Result> {
  return page.evaluate(
    ([m, a]) => {
      const h = (window as unknown as Record<string, Record<string, (...x: unknown[]) => unknown>>)
        .__mantleAgentHands!;
      return h[m as string]!(...(a as unknown[])) as Promise<Result>;
    },
    [method, args] as const,
  );
}

async function begin(page: Page) {
  await page.waitForFunction(() => '__mantleAgentHands' in window);
  await hands(page, 'begin', 'Lesson');
  await expect(
    page.getByRole('status').filter({ hasText: 'Lesson is using this window.' }),
  ).toBeVisible();
}

test('reads the screen as labelled controls, with ids', async ({ page }) => {
  await signIn(page, 'admin');
  await begin(page);
  const read = await hands(page, 'screen');
  expect(read.ok).toBe(true);
  const entries = read.screen!.entries;
  expect(entries.some((e) => e.id === 'assistant')).toBe(true);
  expect(entries.some((e) => e.role === 'button' && e.name === 'Customize')).toBe(true);
  // The agent's own bar is never in its view.
  expect(entries.some((e) => e.name.includes('is using this window'))).toBe(false);
});

test('types and clicks as the user would, then is stopped', async ({ page }) => {
  await signIn(page, 'admin');
  await begin(page);
  expect(
    await hands(page, 'type', { role: 'textbox', name: 'Quick note' }, 'Buy milk\nand bread'),
  ).toEqual({ ok: true });
  await expect(page.getByPlaceholder('Jot it down… the first line becomes the title')).toHaveValue(
    'Buy milk\nand bread',
  );
  expect((await hands(page, 'click', { role: 'button', name: 'Add note' })).ok).toBe(true);
  await expect.poll(() => api.asked('admin')).toContain('POST /api/notes');

  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByText('Lesson is using this window.')).toHaveCount(0);
  expect((await hands(page, 'screen')).error).toBe('stopped');
});

test('a settings change waits for the user: Not now refuses it, Allow once sends it', async ({
  page,
}) => {
  await signIn(page, 'admin');
  await begin(page);
  expect((await hands(page, 'go', '/settings/profile')).ok).toBe(true);
  const sounds = page.getByRole('switch', { name: 'Sounds' });
  await expect(sounds).toBeChecked();

  const first = hands(page, 'click', { role: 'switch', name: 'Sounds' });
  const held = page.getByRole('alertdialog', { name: 'Lesson wants to change a setting' });
  await expect(held).toBeVisible();
  await expect(held.getByText('PUT /api/profile/sounds')).toBeVisible();
  await held.getByRole('button', { name: 'Not now' }).click();
  expect((await first).error).toBe('needs_user');
  expect(api.asked('admin')).not.toContain('PUT /api/profile/sounds');

  const second = hands(page, 'click', { role: 'switch', name: 'Sounds' });
  await expect(held).toBeVisible();
  // Armed after a moment, so a click already on its way cannot answer it.
  await expect(held.getByRole('button', { name: 'Allow once' })).toBeEnabled();
  await held.getByRole('button', { name: 'Allow once' }).click();
  expect((await second).ok).toBe(true);
  await expect.poll(() => api.asked('admin')).toContain('PUT /api/profile/sounds');
});

test('refuses a route with a query, and pauses when the user takes over', async ({ page }) => {
  await signIn(page, 'admin');
  await begin(page);
  expect((await hands(page, 'go', '/tasks?lesson=1')).error).toBe('bad_route');
  expect((await hands(page, 'go', '//elsewhere.invalid')).error).toBe('bad_route');

  // A real click on the page is the user taking over.
  await page.mouse.click(600, 400);
  await expect(page.getByText('Lesson paused: you took over.')).toBeVisible();
  expect((await hands(page, 'screen')).error).toBe('user_took_over');
  await page.getByRole('button', { name: 'Let it go on' }).click();
  expect((await hands(page, 'screen')).ok).toBe(true);
});
