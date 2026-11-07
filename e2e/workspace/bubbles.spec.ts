import { expect, test, type Page } from '@playwright/test';
import {
  MOCK_AGENT,
  signIn,
  startMockWorkspaceApi,
  type MockWorkspaceApi,
} from './mock-workspace-api';

/**
 * Chat bubbles, phases 1 and 2: one source and one seen state for both chat
 * systems. A card comes from the one chat list. It stays until it is closed or
 * the chat is read anywhere. While a chat window is open no card shows and the
 * chat's row is highlighted instead. It has the look, the edges, the drag and
 * the pin. In-memory brain, no real one.
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

test('with the window open, a thread is marked read once its turn has ended', async ({ page }) => {
  // The turn's stream says done at once, so the window's turn is over.
  api.turnEvents = [{ type: 'done' }];
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  await page.keyboard.press('ControlOrMeta+i');
  const box = page.getByPlaceholder(/Enter to send/);
  await box.fill('Please make the report');
  await box.press('Enter');
  await expect.poll(() => api.turns.length).toBe(1);

  api.chats.replyStarts(MOCK_AGENT.slug);
  api.chats.replyEnds(MOCK_AGENT.slug, 'I have finished the report.');
  await expect.poll(() => api.chats.threadReads.length).toBeGreaterThan(0);
  await expect(card(page)).toHaveCount(0);
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

/** Press at the middle of `from`, move by steps, release. */
async function drag(page: Page, from: ReturnType<Page['getByTestId']>, dx: number, dy: number) {
  const box = (await from.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

const stack = (page: Page) => page.getByTestId('bubble-stack');
const nextCard = (page: Page) => page.getByTestId('bubble-next');
const pin = (page: Page) => page.getByTestId('bubble-pin');
const where = async (page: Page) => {
  const box = (await stack(page).boundingBox())!;
  return { x: Math.round(box.x), y: Math.round(box.y), w: box.width, h: box.height };
};

test('the look: see-through with a blur and no border, the avatar on the corner', async ({
  page,
}) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.say(CHAT, 'Hello there');
  await expect(card(page)).toBeVisible();
  const look = await card(page).evaluate((el) => {
    const s = getComputedStyle(el);
    const alpha = /\/\s*([\d.]+)\s*\)$/.exec(s.backgroundColor)?.[1];
    return {
      alpha: Number(alpha ?? 1),
      blur: s.backdropFilter,
      border: s.borderTopWidth,
      shadow: s.boxShadow,
    };
  });
  expect(look.alpha).toBeLessThan(1);
  expect(look.blur).toContain('blur');
  expect(look.border).toBe('0px');
  expect(look.shadow).not.toBe('none');

  const face = (await card(page).locator('span.absolute').first().boundingBox())!;
  const body = (await card(page).boundingBox())!;
  expect(face.x).toBeLessThan(body.x);
  expect(face.y).toBeLessThan(body.y);
});

test('the controls show on hover, and the pin stays seen while pinned', async ({ page }) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);
  await page.mouse.move(5, 5);

  api.chats.say(CHAT, 'Hello there');
  await expect(card(page)).toBeVisible();
  await expect(page.getByTestId('bubble-pop')).toHaveCSS('opacity', '0');
  await expect(pin(page)).toHaveCSS('opacity', '0');

  await card(page).hover();
  await expect(page.getByTestId('bubble-pop')).toHaveCSS('opacity', '1');
  await pin(page).click();
  await expect(pin(page)).toHaveAttribute('aria-pressed', 'true');

  await page.mouse.move(5, 5);
  await expect(page.getByTestId('bubble-pop')).toHaveCSS('opacity', '0');
  await expect(pin(page)).toHaveCSS('opacity', '1');
});

test('a drag moves the stack, a reload keeps the place, and a drag from the text opens nothing', async ({
  page,
}) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.say(CHAT, 'Hello there');
  await expect(card(page)).toBeVisible();
  const first = await where(page);

  await drag(page, page.getByTestId('bubble-open'), -300, -200);
  const moved = await where(page);
  expect(moved.x).toBe(first.x - 300);
  expect(moved.y).toBe(first.y - 200);
  await expect(page).toHaveURL((u) => u.pathname === '/');
  expect(api.chats.reads).toEqual([]);

  // The keyboard still opens it after a drag: it has no press to be one.
  await page.getByTestId('bubble-open').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL((u) => u.pathname === `/chats/${CHAT}`);
  await page.goto('/');

  // Only the drag was held back: a click after it still opens.
  await page.reload();
  await expect(card(page)).toBeVisible();
  expect(await where(page)).toEqual(moved);

  await page.getByTestId('bubble-open').click();
  await expect(page).toHaveURL((u) => u.pathname === `/chats/${CHAT}`);
});

test('a place is saved under the login, as a place and nothing else', async ({ page }) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.say(CHAT, 'Hello there');
  await expect(card(page)).toBeVisible();
  await drag(page, page.getByTestId('bubble-open'), -300, -200);
  const keys = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.startsWith('mantle_bubbles_place_v1:')),
  );
  expect(keys).toHaveLength(1);
  // The login's id, and nothing of the message.
  const stored = await page.evaluate((k) => localStorage.getItem(k), keys[0]!);
  expect(Object.keys(JSON.parse(stored!) as object).sort()).toEqual(['x', 'y']);
});

test('a drag past the edge stays on screen, and a smaller window keeps it there', async ({
  page,
}) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.say(CHAT, 'Hello there');
  await expect(card(page)).toBeVisible();

  await drag(page, page.getByTestId('bubble-open'), -3000, -3000);
  let at = await where(page);
  // The avatar stands out by this much, and it stays on screen as well.
  expect(at.x).toBe(12);
  expect(at.y).toBe(12);

  await drag(page, page.getByTestId('bubble-open'), 3000, 3000);
  at = await where(page);
  expect(at.x + at.w).toBeLessThanOrEqual(1280);
  expect(at.y + at.h).toBeLessThanOrEqual(800 - 16);

  await page.setViewportSize({ width: 900, height: 600 });
  await expect.poll(async () => (await where(page)).x + at.w).toBeLessThanOrEqual(900);
  const small = await where(page);
  expect(small.y + small.h).toBeLessThanOrEqual(600 - 16);

  // A bigger window brings the place back.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(async () => (await where(page)).x).toBe(at.x);
});

test('the edge shows the next card, with no read and no close, and a new line comes to the front', async ({
  page,
}) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.say(CHAT, 'First line');
  await expect(card(page)).toContainText('First line');
  await expect(nextCard(page)).toHaveCount(0);

  api.chats.say(CHAT, 'Second line');
  api.chats.say(GROUP, 'Third line');
  await expect(card(page)).toContainText('Third line');
  await expect(card(page)).toContainText('2 more');

  await nextCard(page).click();
  await expect(card(page)).toContainText('Second line');
  await expect(card(page)).toContainText('2 more');
  await nextCard(page).click();
  await expect(card(page)).toContainText('First line');
  await nextCard(page).click();
  await expect(card(page)).toContainText('Third line');
  await nextCard(page).click();
  await expect(card(page)).toContainText('Second line');
  await page.waitForTimeout(300);
  expect(api.chats.reads).toEqual([]);

  api.chats.say(CHAT, 'Fourth line');
  await expect(card(page)).toContainText('Fourth line');
  await expect(card(page)).toContainText('3 more');
});

test('a close from further back closes that card and leaves the rest', async ({ page }) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.say(CHAT, 'First line');
  api.chats.say(CHAT, 'Second line');
  await expect(card(page)).toContainText('Second line');

  await nextCard(page).click();
  await expect(card(page)).toContainText('First line');
  await closeCard(page);
  await expect(card(page)).toContainText('Second line');
  expect(api.chats.reads).toEqual([]);

  await closeCard(page);
  await expect(card(page)).toHaveCount(0);
  await expect.poll(() => api.chats.reads).toEqual([{ chat: CHAT, seq: 2 }]);
});

test('a pinned line stays through a read and a reload, and goes when unpinned', async ({
  page,
}) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.say(CHAT, 'Keep this line');
  await expect(card(page)).toContainText('Keep this line');
  await pin(page).click();

  api.chats.readElsewhere(CHAT);
  await page.waitForTimeout(500);
  await expect(card(page)).toContainText('Keep this line');

  // A later line, read: the reload must find the pinned one by its seq.
  api.chats.say(CHAT, 'A later line');
  api.chats.readElsewhere(CHAT);
  await page.reload();
  await expect(card(page)).toContainText('Keep this line');
  await expect(card(page)).not.toContainText('more');
  await expect(pin(page)).toHaveAttribute('aria-pressed', 'true');
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  expect(stored).not.toContain('Keep this line');

  await pin(page).click();
  await expect(card(page)).toHaveCount(0);
  await page.reload();
  await settled(page);
  await expect(card(page)).toHaveCount(0);
  expect(api.chats.reads).toEqual([]);
});

test('a pinned reply stays through a read and a reload, and goes when unpinned', async ({
  page,
}) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.replyStarts(MOCK_AGENT.slug);
  api.chats.replyEnds(MOCK_AGENT.slug, 'Keep this reply.');
  await expect(card(page)).toContainText('Keep this reply.');
  await pin(page).click();

  api.chats.readElsewhere(MOCK_AGENT.id);
  await page.waitForTimeout(500);
  await expect(card(page)).toContainText('Keep this reply.');

  // Later replies, read: the reload must find the pinned one by its time.
  for (let i = 0; i < 6; i += 1) api.chats.replyRead(MOCK_AGENT.slug, `Later reply ${i}.`);
  await page.reload();
  await expect(card(page)).toContainText('Keep this reply.');
  await expect(pin(page)).toHaveAttribute('aria-pressed', 'true');

  await pin(page).click();
  await expect(card(page)).toHaveCount(0);
  expect(api.chats.threadReads).toEqual([]);
});

test('a pinned reply that is gone goes after a reload, with its pin', async ({ page }) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.replyStarts(MOCK_AGENT.slug);
  api.chats.replyEnds(MOCK_AGENT.slug, 'Keep this reply.');
  await expect(card(page)).toContainText('Keep this reply.');
  await pin(page).click();

  api.chats.readElsewhere(MOCK_AGENT.id);
  api.chats.replyGone(MOCK_AGENT.slug);
  await page.reload();
  await settled(page);
  await expect(card(page)).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.entries(localStorage)
          .filter(([k]) => k.startsWith('mantle_bubbles_pinned_v1:'))
          .map(([, v]) => v),
      ),
    )
    .toEqual(['[]']);
});

test('an edit reaches a pinned card, and a delete takes it away', async ({ page }) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.say(CHAT, 'The first words');
  await expect(card(page)).toContainText('The first words');
  await pin(page).click();
  api.chats.readElsewhere(CHAT);
  await page.waitForTimeout(300);

  api.chats.edit(CHAT, 1, 'The new words');
  await expect(card(page)).toContainText('The new words');

  api.chats.deleteLine(CHAT, 1);
  await expect(card(page)).toHaveCount(0);
});

test('closing a new line reads the chat while an older card of it stays pinned', async ({
  page,
}) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.say(CHAT, 'Keep this line');
  await expect(card(page)).toContainText('Keep this line');
  await pin(page).click();

  api.chats.say(CHAT, 'A new line');
  await expect(card(page)).toContainText('A new line');
  await closeCard(page);
  await expect(card(page)).toContainText('Keep this line');
  await expect.poll(() => api.chats.reads).toEqual([{ chat: CHAT, seq: 2 }]);
  await page.waitForTimeout(300);
  await expect(card(page)).toContainText('Keep this line');
});

test('closing a pinned card takes the pin with it', async ({ page }) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.say(CHAT, 'Keep this line');
  await expect(card(page)).toContainText('Keep this line');
  await pin(page).click();
  await closeCard(page);
  await expect(card(page)).toHaveCount(0);

  await page.reload();
  await settled(page);
  await expect(card(page)).toHaveCount(0);
  // It may be a line read long ago, so its close reads nothing.
  expect(api.chats.reads).toEqual([]);
});

test('a pinned line in a muted chat comes back after a reload', async ({ page }) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.say(CHAT, 'Keep this line');
  await expect(card(page)).toContainText('Keep this line');
  await pin(page).click();
  api.chats.rows.find((r) => r.id === CHAT)!.muted = true;
  await page.reload();
  await expect(card(page)).toContainText('Keep this line');
});

test('closing a pinned reply moves no assistant cursor', async ({ page }) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.replyStarts(MOCK_AGENT.slug);
  api.chats.replyEnds(MOCK_AGENT.slug, 'Keep this reply.');
  await expect(card(page)).toContainText('Keep this reply.');
  await pin(page).click();
  // Read elsewhere, and a reply that failed holds the row at 1.
  api.chats.readElsewhere(MOCK_AGENT.id);
  api.chats.replyStarts(MOCK_AGENT.slug);
  api.chats.replyFails(MOCK_AGENT.slug);
  await page.waitForTimeout(500);
  await closeCard(page);
  await expect(card(page)).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(api.chats.threadReads).toEqual([]);
});

test('a double click on the X closes one card', async ({ page }) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.say(CHAT, 'First line');
  api.chats.say(CHAT, 'Second line');
  await expect(card(page)).toContainText('Second line');
  await page.getByTestId('bubble-pop').dblclick();
  await expect(card(page)).toContainText('First line');
});

test('a pin in one tab holds the card in the other', async ({ page, context }) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);
  const other = await context.newPage();
  await other.goto('/');
  await settled(other);

  api.chats.say(CHAT, 'Keep this line');
  await expect(card(page)).toBeVisible();
  await expect(card(other)).toBeVisible();

  await pin(page).click();
  await expect(pin(other)).toHaveAttribute('aria-pressed', 'true');
  api.chats.readElsewhere(CHAT);
  await page.waitForTimeout(500);
  await expect(card(other)).toContainText('Keep this line');
});

test('the Assistant window still moves, by the same drag helper', async ({ page }) => {
  await signIn(page, 'admin');
  await settled(page);

  await page.keyboard.press('ControlOrMeta+i');
  await page.getByRole('button', { name: 'Show as a movable window' }).click();
  const box = page.getByRole('dialog', { name: /assistant/ });
  await expect(box).toBeVisible();
  const before = (await box.boundingBox())!;

  const x = before.x + before.width / 2;
  const y = before.y + 6;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 100, y + 60, { steps: 4 });
  await page.mouse.up();

  const after = (await box.boundingBox())!;
  expect(Math.round(after.x)).toBe(Math.round(before.x - 100));
  expect(Math.round(after.y)).toBe(Math.round(before.y + 60));
});
