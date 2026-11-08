import { expect, test, type Page } from '@playwright/test';
import {
  MOCK_AGENT,
  signIn,
  startMockWorkspaceApi,
  type MockWorkspaceApi,
} from './mock-workspace-api';
import { scopedNav } from './shell-nav';

/**
 * The Chats window (Bubble Chat phase 5): the dock's panel holds the chat
 * list (people, groups, agents) and one chat at a time, with a way back. It
 * stays open beside every screen in the column and window shapes, and a
 * reload brings it back. In-memory brain, no real one.
 */

const CHAT = 'c0000000-0000-4000-8000-000000000001';
const GROUP = 'c0000000-0000-4000-8000-000000000002';

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
  api.chats.on = true;
  api.chats.addChat(CHAT, 'Ann');
  api.chats.addChat(GROUP, 'Crew', 'group');
  api.chats.addThread(MOCK_AGENT.id, MOCK_AGENT.slug, MOCK_AGENT.name);
});
test.afterEach(async () => {
  await api.close();
});

const panel = (page: Page) => page.locator('[data-assistant-panel]');
const win = (page: Page) => page.getByTestId('window-chats');
const rows = (page: Page) => win(page).getByTestId('chat-row');
const row = (page: Page, name: string) => rows(page).filter({ hasText: name });
const back = (page: Page) => win(page).getByTestId('window-back').locator('visible=true');

async function settled(page: Page) {
  await expect.poll(() => api.asked('admin')).toContain('GET /api/messenger/conversations');
  await page.waitForTimeout(300);
}

async function openWindow(page: Page) {
  await page.keyboard.press('ControlOrMeta+i');
  await expect(win(page)).toBeVisible();
}

test('the first open shows one list of people, groups and agents, with no agent picker', async ({
  page,
}) => {
  await signIn(page, 'admin');
  await settled(page);
  await openWindow(page);

  await expect(win(page)).toHaveAttribute('data-view', 'list');
  await expect(rows(page)).toHaveCount(3);
  for (const name of ['Ann', 'Crew', MOCK_AGENT.name]) await expect(row(page, name)).toBeVisible();
  await expect(panel(page).getByRole('combobox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Toggle chats (⌘I)' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('search jumps to a chat', async ({ page }) => {
  await signIn(page, 'admin');
  await settled(page);
  await openWindow(page);

  await win(page).getByRole('searchbox', { name: 'Search chats' }).fill('cre');
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, 'Crew')).toBeVisible();
});

test('a person row opens the chat in the window, and back comes to the list', async ({ page }) => {
  api.chats.say(CHAT, 'Hello from Ann');
  await signIn(page, 'admin');
  await settled(page);
  await openWindow(page);

  await row(page, 'Ann').click();
  await expect(win(page)).toHaveAttribute('data-view', 'chat');
  await expect(win(page).getByTestId('chat-room')).toContainText('Hello from Ann');
  // The screen behind did not move.
  await expect(page).toHaveURL((u) => u.pathname === '/');

  const box = win(page).getByRole('combobox', { name: 'Message' });
  await box.fill('Hi Ann');
  await box.press('Enter');
  await expect.poll(() => api.chats.sent).toEqual([{ chat: CHAT, body: 'Hi Ann' }]);

  await back(page).click();
  await expect(win(page)).toHaveAttribute('data-view', 'list');
  await expect(rows(page)).toHaveCount(3);
});

test('an agent row opens its thread, with no picker, and back comes to the list', async ({
  page,
}) => {
  await signIn(page, 'admin');
  await settled(page);
  await openWindow(page);

  await row(page, MOCK_AGENT.name).click();
  await expect(win(page)).toHaveAttribute('data-view', 'agent');
  const thread = win(page).getByTestId('window-agent-thread');
  await expect(thread.getByPlaceholder(/Enter to send/)).toBeVisible();
  await expect(thread.getByRole('combobox')).toHaveCount(0);

  await back(page).click();
  await expect(win(page)).toHaveAttribute('data-view', 'list');
  await expect(thread).toBeHidden();
});

test('the side column stays open across screens, and the full shape steps aside', async ({
  page,
}) => {
  await signIn(page, 'admin');
  await settled(page);
  await openWindow(page);
  await row(page, 'Ann').click();

  const nav = await scopedNav(page, 'Work');
  for (const screen of ['Notes', 'Files', 'Tables']) {
    await nav.getByRole('link', { name: screen, exact: true }).click();
    await expect(page).toHaveURL((u) => u.pathname === `/${screen.toLowerCase()}`);
    await expect(win(page)).toBeVisible();
    await expect(win(page)).toHaveAttribute('data-view', 'chat');
  }

  await page.getByRole('button', { name: 'Show as a movable window' }).click();
  await nav.getByRole('link', { name: 'Pages', exact: true }).click();
  await expect(page).toHaveURL((u) => u.pathname === '/pages');
  await expect(win(page)).toBeVisible();

  await win(page).getByRole('button', { name: 'Show as full display' }).click();
  await nav.getByRole('link', { name: 'Notes', exact: true }).click();
  await expect(page).toHaveURL((u) => u.pathname === '/notes');
  await expect(win(page)).toBeHidden();
});

test('a reload opens the window again, on its last chat', async ({ page }) => {
  await signIn(page, 'admin');
  await settled(page);
  await openWindow(page);
  await row(page, 'Crew').click();
  await expect(win(page)).toHaveAttribute('data-view', 'chat');

  await page.reload();
  await expect(win(page)).toBeVisible();
  await expect(win(page)).toHaveAttribute('data-view', 'chat');
  await expect(win(page).getByTestId('chat-room')).toContainText('Crew');

  // Minimised stays minimised.
  await page.keyboard.press('Escape');
  await expect(win(page)).toBeHidden();
  await page.reload();
  await settled(page);
  await expect(page.locator('[data-assistant-panel]')).toHaveCount(0);
});

test('a draft survives back and Open in Chats', async ({ page }) => {
  await signIn(page, 'admin');
  await settled(page);
  await openWindow(page);
  await row(page, 'Ann').click();
  await win(page).getByRole('combobox', { name: 'Message' }).fill('Half a thought');

  await back(page).click();
  await row(page, 'Ann').click();
  await expect(win(page).getByRole('combobox', { name: 'Message' })).toHaveValue('Half a thought');

  await win(page).getByRole('button', { name: 'Open in Chats' }).click();
  await expect(page).toHaveURL((u) => u.pathname === `/chats/${CHAT}`);
  await expect(win(page)).toHaveAttribute('data-view', 'list');
  await expect(page.getByRole('main').getByRole('combobox', { name: 'Message' })).toHaveValue(
    'Half a thought',
  );
  expect(api.chats.sent).toEqual([]);
});

test('inside a chat, the back button counts lines in the other chats', async ({ page }) => {
  await signIn(page, 'admin');
  await settled(page);
  await openWindow(page);
  await row(page, 'Ann').click();
  await expect(win(page).getByTestId('window-back-count')).toHaveCount(0);

  api.chats.say(GROUP, 'News in the group');
  await expect(win(page).getByTestId('window-back-count')).toHaveText('1');
  await expect(back(page)).toHaveAttribute('aria-label', 'Back to chats, 1 unread');

  await back(page).click();
  await expect(row(page, 'Crew')).toHaveAttribute('data-highlighted', 'true');
});

test('with bubbles on and the window open, a line highlights its row, with no toast and no card', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('mantle_bubbles_mode_v1', 'on'));
  await signIn(page, 'admin');
  await settled(page);
  await openWindow(page);
  await expect(rows(page)).toHaveCount(3);
  await page.waitForTimeout(300);

  api.chats.say(CHAT, 'Hello there');
  await expect(row(page, 'Ann')).toHaveAttribute('data-highlighted', 'true');
  await page.waitForTimeout(800);
  // The toast's own node (a role query skips it while the window is open).
  await expect(page.locator('div[role="status"]').filter({ hasText: 'Hello there' })).toHaveCount(
    0,
  );
  await expect(page.getByTestId('bubble-card')).toHaveCount(0);
});

test('the movable window moves by its list header', async ({ page }) => {
  await signIn(page, 'admin');
  await settled(page);
  await openWindow(page);
  await page.getByRole('button', { name: 'Show as a movable window' }).click();
  const box = page.getByRole('dialog', { name: 'Chats' });
  await expect(box).toBeVisible();
  const before = (await box.boundingBox())!;

  const x = before.x + 120;
  const y = before.y + 20;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 100, y + 60, { steps: 4 });
  await page.mouse.up();

  const after = (await box.boundingBox())!;
  expect(Math.round(after.x)).toBe(Math.round(before.x - 100));
  expect(Math.round(after.y)).toBe(Math.round(before.y + 60));
});

test('a minimised window does not read the chat it holds', async ({ page }) => {
  await signIn(page, 'admin');
  await settled(page);
  await openWindow(page);
  await row(page, 'Ann').click();
  await expect(win(page).getByTestId('chat-room')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(win(page)).toBeHidden();

  api.chats.say(CHAT, 'Seen by nobody');
  await page.waitForTimeout(1500);
  expect(api.chats.reads.filter((r) => r.chat === CHAT)).toEqual([]);

  // Open again: now it is on screen, and it is read.
  await page.keyboard.press('ControlOrMeta+i');
  await expect(win(page).getByTestId('chat-room')).toContainText('Seen by nobody');
  await expect
    .poll(() => api.chats.reads.filter((r) => r.chat === CHAT))
    .toEqual([{ chat: CHAT, seq: 1 }]);
});

test('/assistant?agent= on a fresh load opens that agent in the window', async ({ page }) => {
  await signIn(page, 'admin');
  await settled(page);
  // A saved view of another chat does not win over the link.
  await openWindow(page);
  await row(page, 'Ann').click();
  await expect(win(page)).toHaveAttribute('data-view', 'chat');
  // The full shape steps aside on a route change: the link's own bounce
  // to / must not. (The saved shape, as the switcher writes it.)
  await page.evaluate(() => localStorage.setItem('mantle_assistant_display', 'full'));
  await page.goto(`/assistant?agent=${MOCK_AGENT.slug}`);
  await expect(page).toHaveURL((u) => u.pathname === '/');
  await expect(win(page)).toHaveAttribute('data-view', 'agent');
  await expect(
    win(page)
      .getByTestId('window-agent-thread')
      .getByPlaceholder(/Enter to send/),
  ).toBeVisible();
});

test('Escape closes a part inside the window, or a part of the screen, and not the window', async ({
  page,
}) => {
  await signIn(page, 'admin');
  await settled(page);
  await openWindow(page);
  await row(page, 'Ann').click();
  const box = win(page).getByRole('combobox', { name: 'Message' });
  await box.fill('@');
  await expect(win(page).locator('#chat-composer-text-window-mentions')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(win(page).locator('#chat-composer-text-window-mentions')).toBeHidden();
  await expect(win(page)).toBeVisible();

  // On the screen beside it: the column stays.
  await page.getByPlaceholder(/Filter menu/).focus();
  await page.keyboard.press('Escape');
  await expect(win(page)).toBeVisible();

  // In the window itself: it minimises.
  await box.click();
  await box.fill('');
  await page.keyboard.press('Escape');
  await expect(win(page)).toBeHidden();
});

test('the browser keeps ids, never the draft text', async ({ page }) => {
  await signIn(page, 'admin');
  await settled(page);
  await openWindow(page);
  await row(page, 'Ann').click();
  await win(page).getByRole('combobox', { name: 'Message' }).fill('A private thought');
  await back(page).click();
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain('A private thought');
  expect(stored).toContain('mantle_window_view:');
});

test('Escape closes the details overlay and leaves the window open', async ({ page }) => {
  await signIn(page, 'admin');
  await settled(page);
  await openWindow(page);
  await row(page, 'Ann').click();
  await win(page).getByRole('button', { name: 'Details' }).click();
  const details = win(page).getByRole('region', { name: 'Chat details' });
  await expect(details).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(details).toBeHidden();
  await expect(win(page)).toBeVisible();
});

test('the chat the window shows pops no toast; a chat left for New chat does', async ({ page }) => {
  await signIn(page, 'admin');
  await settled(page);
  await openWindow(page);
  await row(page, 'Ann').click();
  await expect(win(page).getByTestId('chat-room')).toBeVisible();
  await page.waitForTimeout(300);

  api.chats.say(CHAT, 'On screen');
  await expect(win(page).getByTestId('chat-room')).toContainText('On screen');
  await page.waitForTimeout(800);
  await expect(page.locator('div[role="status"]').filter({ hasText: 'On screen' })).toHaveCount(0);

  await back(page).click();
  await win(page).getByRole('button', { name: 'New chat' }).click();
  await expect(win(page)).toHaveAttribute('data-view', 'new');
  api.chats.say(CHAT, 'Not on screen');
  await expect(page.locator('div[role="status"]').filter({ hasText: 'Not on screen' })).toHaveCount(
    1,
  );
});

test('with no agent row yet, Ask the assistant opens the thread', async ({ page }) => {
  // The brain lists an agent's thread once it has a line.
  api.chats.rows = api.chats.rows.filter((r) => r.kind !== 'agent');
  await signIn(page, 'admin');
  await settled(page);
  await openWindow(page);
  await expect(rows(page)).toHaveCount(2);
  await win(page).getByRole('button', { name: 'Ask the assistant' }).click();
  await expect(win(page)).toHaveAttribute('data-view', 'agent');
  await expect(
    win(page)
      .getByTestId('window-agent-thread')
      .getByPlaceholder(/Enter to send/),
  ).toBeVisible();
});

test('a brain without the messenger shows the assistant thread, with no way back', async ({
  page,
}) => {
  api.chats.missing = true;
  await signIn(page, 'admin');
  await expect.poll(() => api.asked('admin')).toContain('GET /api/messenger/unread');
  await page.getByRole('button', { name: 'Toggle chats (⌘I)' }).click();
  await expect(win(page)).toBeVisible();
  await expect(win(page)).toHaveAttribute('data-view', 'agent');
  await expect(
    win(page)
      .getByTestId('window-agent-thread')
      .getByPlaceholder(/Enter to send/),
  ).toBeVisible();
  await expect(win(page).getByTestId('window-back')).toHaveCount(0);
});

test('New chat hands its line to an agent thread opened before', async ({ page }) => {
  await signIn(page, 'admin');
  await settled(page);
  await openWindow(page);
  // The thread is mounted once, then kept.
  await row(page, MOCK_AGENT.name).click();
  await expect(win(page).getByPlaceholder(/Enter to send/)).toBeVisible();
  await back(page).click();

  await win(page).getByRole('button', { name: 'New chat' }).click();
  const pane = win(page).getByTestId('new-chat');
  await pane.getByRole('combobox', { name: 'Message' }).fill('Check the pump list');
  await pane
    .getByRole('button', { name: new RegExp(MOCK_AGENT.name) })
    .first()
    .click();
  await expect(win(page)).toHaveAttribute('data-view', 'agent');
  await expect(win(page).getByPlaceholder(/Enter to send/)).toHaveValue('Check the pump list');
});

test('Escape right after opening minimises the column, with nothing else focused', async ({
  page,
}) => {
  await signIn(page, 'admin');
  await settled(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('ControlOrMeta+i');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-assistant-panel]')).toBeHidden();
});
