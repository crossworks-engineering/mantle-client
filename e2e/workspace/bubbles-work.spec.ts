import { expect, test, type Page } from '@playwright/test';
import {
  MOCK_AGENT,
  signIn,
  startMockWorkspaceApi,
  type MockWorkspaceApi,
} from './mock-workspace-api';

/**
 * Chat bubbles, phase 3: the bubble as a quick working surface. The card says
 * what the assistant did (its lead paragraph and the brain's tool tally),
 * offers the items it made, and answers: a quick reply to a person or a group
 * by the chat's own send, to an assistant by the window's own turn, and a
 * thumbs up. A turn this tab sent shows as a live card: the step, the text
 * so far, Stop, then the finished reply. In-memory brain, no real one.
 */

const CHAT = 'c0000000-0000-4000-8000-000000000001';
const GROUP = 'c0000000-0000-4000-8000-000000000002';
const PAGE = '0f0e1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';

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
const live = (page: Page) => page.getByTestId('bubble-live');

/** The stream is open and the list has been read, so a line now is a new one. */
async function settled(page: Page) {
  await expect.poll(() => api.asked('admin')).toContain('GET /api/messenger/conversations');
  await page.waitForTimeout(300);
}

async function quickReply(page: Page, text: string) {
  await page.getByTestId('bubble-reply').click();
  const input = page.getByTestId('bubble-reply-input');
  await expect(input).toBeFocused();
  await input.fill(text);
  await input.press('Enter');
}

test('an assistant card shows its lead paragraph, what the turn did, and the item it made', async ({
  page,
}) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.replyStarts(MOCK_AGENT.slug);
  const rest = 'The details go on for a long time here. '.repeat(20);
  api.chats.replyEnds(
    MOCK_AGENT.slug,
    `I created the list of new features you asked for, in the page [New features](/n/${PAGE}). It has twelve items.\n\n${rest}`,
    { calls: 6, succeeded: 5, failed: 1, skipped: 0, queued: 0, failures: [] },
  );
  await expect(card(page)).toContainText(
    'I created the list of new features you asked for, in the page New features. It has twelve items.',
  );
  await expect(card(page)).not.toContainText('The details');
  await expect(page.getByTestId('bubble-facts')).toHaveText('Used 6 tools, 1 failed');

  const item = page.getByTestId('bubble-item');
  await expect(item).toHaveText('New features');
  await item.click();
  await expect(page).toHaveURL(new RegExp(`/n/${PAGE}$`));
});

test('a quick reply goes to the chat of the card, and only to it', async ({ page }) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.say(CHAT, 'Can you check the report?');
  api.chats.say(GROUP, 'Who has the keys?', { id: 'bob-id', name: 'Bob' });
  // The newest leads: the group.
  await expect(card(page)).toContainText('Who has the keys?');

  await quickReply(page, 'Thanks, I will look a little later');
  await expect
    .poll(() => api.chats.sent)
    .toEqual([{ chat: GROUP, body: 'Thanks, I will look a little later' }]);
  // The send moved my cursor in the group, so its card goes; Ann's stays.
  await expect(card(page)).toContainText('Can you check the report?');
  expect(api.chats.sent).toHaveLength(1);
});

test('a refused reply keeps its words and says why', async ({ page }) => {
  api.chats.readOnly.add(CHAT);
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.say(CHAT, 'Can you check the report?');
  await expect(card(page)).toContainText('Can you check the report?');
  await quickReply(page, 'On it');
  await expect(card(page).getByRole('alert')).toContainText('Not sent');
  await expect(page.getByTestId('bubble-reply-input')).toHaveValue('On it');
  await expect(card(page)).toContainText('Can you check the report?');
  expect(api.chats.sent).toEqual([]);
});

test('Esc closes the reply field and sends nothing', async ({ page }) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.say(CHAT, 'Can you check the report?');
  await page.getByTestId('bubble-reply').click();
  await page.getByTestId('bubble-reply-input').fill('Not now');
  await page.getByTestId('bubble-reply-input').press('Escape');
  await expect(page.getByTestId('bubble-reply-input')).toHaveCount(0);
  await expect(card(page)).toContainText('Can you check the report?');
  expect(api.chats.sent).toEqual([]);
});

test('a thumbs up reacts to that line and closes the card', async ({ page }) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.say(CHAT, 'Lunch at one?');
  await expect(card(page)).toContainText('Lunch at one?');
  await page.getByTestId('bubble-thumbs').click();
  await expect.poll(() => api.chats.reacted).toEqual([{ chat: CHAT, seq: 1, emoji: '👍' }]);
  await expect(card(page)).toHaveCount(0);
  await expect.poll(() => api.chats.reads).toEqual([{ chat: CHAT, seq: 1 }]);
});

test('an assistant card has no thumbs up: a click must not cost a turn', async ({ page }) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.replyStarts(MOCK_AGENT.slug);
  api.chats.replyEnds(MOCK_AGENT.slug, 'I have finished the report.');
  await expect(card(page)).toContainText('I have finished the report.');
  await expect(page.getByTestId('bubble-thumbs')).toHaveCount(0);
});

test('a reply to an assistant runs a turn, and the live card shows it working', async ({
  page,
}) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.replyStarts(MOCK_AGENT.slug);
  api.chats.replyEnds(MOCK_AGENT.slug, 'I have finished the report.');
  await expect(card(page)).toContainText('I have finished the report.');

  await quickReply(page, 'Now list the new features');
  await expect.poll(() => api.turns.length).toBe(1);
  // The card answered is seen: its read moves the cursor past it.
  await expect.poll(() => api.chats.threadReads.length).toBe(1);
  api.chats.replyStarts(MOCK_AGENT.slug);

  await expect(live(page)).toBeVisible();
  await expect(live(page)).toHaveAttribute('data-state', 'running');
  await expect(page.getByTestId('bubble-face')).toHaveAttribute('data-talking', 'true');
  await expect(page.getByTestId('bubble-step')).toContainText('Working');

  api.pushTurnEvent({
    type: 'status',
    data: { label: 'Reading the release notes', kind: 'brain' },
  });
  await expect(page.getByTestId('bubble-step')).toContainText('Reading the release notes');

  api.pushTurnEvent({ type: 'text-delta', round: 0, data: { text: 'I created the list of ' } });
  api.pushTurnEvent({ type: 'text-delta', round: 0, data: { text: 'new features.' } });
  await expect(page.getByTestId('bubble-live-text')).toHaveText(
    'I created the list of new features.',
  );

  api.pushTurnEvent({ type: 'done', data: {} });
  await expect(live(page)).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('bubble-step')).toHaveCount(0);
  await expect(page.getByTestId('bubble-live-text')).toHaveText(
    'I created the list of new features.',
  );

  // The reply's own card takes its place: one card, not two.
  api.chats.replyEnds(MOCK_AGENT.slug, 'I created the list of new features.');
  await expect(live(page)).toHaveCount(0);
  await expect(card(page)).toContainText('I created the list of new features.');
  await expect(page.getByTestId('bubble-next')).toHaveCount(0);
});

test('Stop on the live card cancels that turn', async ({ page }) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.replyStarts(MOCK_AGENT.slug);
  api.chats.replyEnds(MOCK_AGENT.slug, 'I have finished the report.');
  await quickReply(page, 'Now list the new features');
  await expect.poll(() => api.turns.length).toBe(1);

  await page.getByTestId('bubble-stop').click();
  await expect.poll(() => api.cancels).toEqual([api.turns[0]!.turnId]);
});

test('no live card while the window is open; it shows when the window is minimised', async ({
  page,
}) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  await page.keyboard.press('ControlOrMeta+i');
  const box = page.getByPlaceholder(/Enter to send/);
  await box.fill('Please list the new features');
  await box.press('Enter');
  await expect.poll(() => api.turns.length).toBe(1);
  api.pushTurnEvent({
    type: 'status',
    data: { label: 'Reading the release notes', kind: 'brain' },
  });
  await page.waitForTimeout(500);
  await expect(live(page)).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(live(page)).toBeVisible();
  await expect(page.getByTestId('bubble-step')).toContainText('Reading the release notes');
});

test('a new card talks for a moment, and not at all with reduced motion', async ({ page }) => {
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.say(CHAT, 'Lunch at one?');
  const face = page.getByTestId('bubble-face');
  await expect(face).toHaveAttribute('data-talking', 'true');
  await expect(face).not.toHaveAttribute('data-talking', 'true', { timeout: 6000 });
});

test('with reduced motion the face never talks', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await bubblesOn(page);
  await signIn(page, 'admin');
  await settled(page);

  api.chats.say(CHAT, 'Lunch at one?');
  await expect(card(page)).toContainText('Lunch at one?');
  await expect(page.getByTestId('bubble-face')).not.toHaveAttribute('data-talking', 'true');
});
