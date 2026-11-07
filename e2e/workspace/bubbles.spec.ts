import { expect, test, type Page } from '@playwright/test';
import {
  MOCK_AGENT,
  signIn,
  startMockWorkspaceApi,
  type MockWorkspaceApi,
} from './mock-workspace-api';

/**
 * Chat bubbles, phase 1: one source and one seen state for both chat systems.
 * A card comes from the one chat list. It stays until it is closed or the chat
 * is read anywhere. While a chat window is open no card shows and the chat's
 * row is highlighted instead. In-memory brain, no real one.
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

async function bubblesOn(page: Page) {
  await page.addInitScript(() => localStorage.setItem('mantle_bubbles_mode_v1', 'on'));
}

const card = (page: Page) => page.getByTestId('bubble-card');
const closeCard = (page: Page) => page.getByTestId('bubble-pop').click();
/** A chat toast's one action. */
const toastOpen = (page: Page) => page.getByRole('button', { name: 'Open', exact: true });

const isList = (asked: string) => asked === 'GET /api/messenger/conversations';

/** The stream is open and the list has been read, so a line now is a new one. */
async function settled(page: Page) {
  await expect.poll(() => api.asked('admin')).toContain('GET /api/messenger/conversations');
  await page.waitForTimeout(300);
}

test('off by default: the toast stays and no card shows', async ({ page }) => {
  await signIn(page, 'admin');
  await settled(page);
  api.chats.say(CHAT, 'Hello there');
  await expect(toastOpen(page)).toBeVisible();
  await expect(card(page)).toHaveCount(0);
});

test('the setting turns it on, and a line shows as a card with no toast', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/settings/profile');
  await page.getByRole('switch', { name: 'Chat bubbles' }).click();
  await page.goto('/');
  await settled(page);

  api.chats.say(CHAT, 'Hello there');
  await expect(card(page)).toContainText('Ann');
  await expect(card(page)).toContainText('Hello there');
  await expect(toastOpen(page)).toHaveCount(0);
});

test('close moves the read cursor, and the card stays until then', async ({ page }) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.say(CHAT, 'Hello there');
  await expect(card(page)).toBeVisible();
  // No timeout: it is still there later.
  await page.waitForTimeout(6000);
  await expect(card(page)).toBeVisible();
  expect(api.chats.reads).toEqual([]);

  await closeCard(page);
  await expect(card(page)).toHaveCount(0);
  await expect.poll(() => api.chats.reads).toEqual([{ chat: CHAT, seq: 1 }]);
});

test('a stack runs newest to oldest, and the cursor moves with the last card', async ({ page }) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.say(CHAT, 'First line');
  api.chats.say(CHAT, 'Second line');
  await expect(card(page)).toContainText('Second line');
  await expect(card(page)).toContainText('1 more');

  await closeCard(page);
  await expect(card(page)).toContainText('First line');
  // Moving it now would mark the older card read.
  expect(api.chats.reads).toEqual([]);

  await closeCard(page);
  await expect(card(page)).toHaveCount(0);
  await expect.poll(() => api.chats.reads).toEqual([{ chat: CHAT, seq: 2 }]);
});

test('a group card names the group, and a long paste shows its size', async ({ page }) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.say(GROUP, ['The start', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n'));
  await expect(card(page)).toContainText('Ann in Crew');
  await expect(card(page)).toContainText('sent a long message, 8 lines');
  await expect(card(page)).toContainText('The start');
  await expect(card(page)).toContainText('Open to read more');
  await expect(card(page)).not.toContainText('Crewb');
});

test('an assistant reply shows once, when complete, as its first sentence', async ({ page }) => {
  // A reply read earlier: it never comes back as new.
  api.chats.replyRead(MOCK_AGENT.slug, 'An old reply that was read long ago.');
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.replyStarts(MOCK_AGENT.slug);
  await page.waitForTimeout(800);
  // Pending: no text, no card.
  await expect(card(page)).toHaveCount(0);

  const rest = 'The details go on for a long time here. '.repeat(20);
  api.chats.replyEnds(MOCK_AGENT.slug, `I have **finished** the report for you. ${rest}`);
  await expect(card(page)).toContainText(MOCK_AGENT.name);
  await expect(card(page)).toContainText('I have finished the report for you.');
  await expect(card(page)).not.toContainText('The details');
  await expect(card(page)).toContainText('Open to read more');

  await closeCard(page);
  await expect(card(page)).toHaveCount(0);
  await expect.poll(() => api.chats.threadReads).toHaveLength(1);
  expect(api.chats.threadReads[0]?.agentSlug).toBe(MOCK_AGENT.slug);
  // Just past the reply, so it counts as read and nothing newer does.
  const row = api.chats.rows.find((r) => r.agentSlug === MOCK_AGENT.slug);
  expect(Date.parse(api.chats.threadReads[0]!.at!)).toBe(Date.parse(row!.lastMessageAt!) + 1);
});

test('a failed reply makes no card, and an old reply stays read', async ({ page }) => {
  api.chats.replyRead(MOCK_AGENT.slug, 'An old reply that was read long ago.');
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.replyStarts(MOCK_AGENT.slug);
  api.chats.replyFails(MOCK_AGENT.slug);
  await page.waitForTimeout(800);
  await expect(card(page)).toHaveCount(0);
});

test('closing a stale card of a thread read elsewhere does not move the cursor', async ({
  page,
}) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.replyStarts(MOCK_AGENT.slug);
  api.chats.replyEnds(MOCK_AGENT.slug, 'Done.');
  await expect(card(page)).toContainText('Done.');

  // A thread read raises no event: this tab still holds the card.
  api.chats.readElsewhere(MOCK_AGENT.id);
  await closeCard(page);
  await expect(card(page)).toHaveCount(0);
  await expect.poll(() => api.asked('admin').filter(isList).length).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  expect(api.chats.threadReads).toEqual([]);
});

test('closing the cards of a long unread chat marks nothing read', async ({ page }) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  for (let i = 1; i <= 7; i += 1) api.chats.say(CHAT, `Line ${i}`);
  await expect(card(page)).toContainText('Line 7');
  await expect(card(page)).toContainText('4 more');
  for (let i = 0; i < 5; i += 1) await closeCard(page);
  await expect(card(page)).toHaveCount(0);
  await page.waitForTimeout(300);
  // Lines 1 and 2 were never on a card.
  expect(api.chats.reads).toEqual([]);

  await page.goto('/chats');
  await expect(page.locator('[data-testid="chat-row"][data-highlighted="true"]')).toHaveCount(1);
});

test('a reply to a turn from the window still shows if it is minimised first', async ({ page }) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  await page.keyboard.press('ControlOrMeta+i');
  const box = page.getByPlaceholder(/Enter to send/);
  await box.fill('Please make the report');
  await box.press('Enter');
  await expect.poll(() => api.turns.length).toBe(1);

  // The reply's row exists, pending, while the window is open.
  api.chats.replyStarts(MOCK_AGENT.slug);
  await page.waitForTimeout(800);
  expect(api.chats.threadReads).toEqual([]);

  await page.keyboard.press('Escape');
  api.chats.replyEnds(MOCK_AGENT.slug, 'I have finished the report.');
  await expect(card(page)).toContainText('I have finished the report.');
});

test('a close in one tab clears the other, with one read', async ({ page, context }) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);
  const other = await context.newPage();
  await other.goto('/');
  await settled(other);

  api.chats.say(CHAT, 'Hello there');
  await expect(card(page)).toBeVisible();
  await expect(card(other)).toBeVisible();

  await closeCard(page);
  await expect(card(other)).toHaveCount(0);
  await expect.poll(() => api.chats.reads).toHaveLength(1);
});

test('a reload brings back what is unread, and nothing that was closed', async ({ page }) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.say(CHAT, 'First line');
  api.chats.say(CHAT, 'Second line');
  await expect(card(page)).toContainText('Second line');
  await closeCard(page);
  await expect(card(page)).toContainText('First line');

  await page.reload();
  await expect(card(page)).toContainText('First line');
  await expect(card(page)).not.toContainText('1 more');
});

test('a chat read on another device drops its card', async ({ page }) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.say(CHAT, 'Hello there');
  await expect(card(page)).toBeVisible();
  api.chats.readElsewhere(CHAT);
  await expect(card(page)).toHaveCount(0);
  expect(api.chats.reads).toEqual([]);
});

test('a muted chat stays quiet', async ({ page }) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.rows.find((r) => r.id === CHAT)!.muted = true;
  api.chats.say(CHAT, 'Hello there');
  api.chats.say(GROUP, 'Other chat');
  await expect(card(page)).toContainText('Other chat');
  await expect(card(page)).not.toContainText('1 more');
});

test('on the chat screen: no card, the row is highlighted, leaving shows the card', async ({
  page,
}) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await page.goto('/chats');
  await settled(page);

  api.chats.say(CHAT, 'Hello there');
  const row = page.getByTestId('chat-row').filter({ hasText: 'Hello there' });
  await expect(row).toHaveAttribute('data-highlighted', 'true');
  await expect(row).toHaveAttribute('data-accent', 'info');
  await expect(card(page)).toHaveCount(0);
  await expect(toastOpen(page)).toHaveCount(0);
  // The other rows have nothing waiting.
  await expect(page.locator('[data-testid="chat-row"][data-highlighted="true"]')).toHaveCount(1);

  await page.goto('/');
  await expect(card(page)).toContainText('Hello there');
});

test('with the side window open: no card, and the toast keeps a person line', async ({ page }) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  await page.keyboard.press('ControlOrMeta+i');
  await expect(page.getByRole('main')).toBeVisible();
  await page.waitForTimeout(300);

  api.chats.say(CHAT, 'Hello there');
  await expect(toastOpen(page)).toBeVisible();
  await expect(card(page)).toHaveCount(0);

  // Minimised is not open: the card waits there.
  await page.keyboard.press('Escape');
  await expect(card(page)).toContainText('Hello there');
});

test('a click on the text opens the chat', async ({ page }) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.say(CHAT, 'Hello there');
  await page.getByTestId('bubble-open').click();
  await expect(page).toHaveURL((u) => u.pathname === `/chats/${CHAT}`);
  await expect(card(page)).toHaveCount(0);
});
