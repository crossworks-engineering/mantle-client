import { expect, test, type Page } from '@playwright/test';
import { signIn, startMockWorkspaceApi, type MockWorkspaceApi } from './mock-workspace-api';
import { FLEET_BOX, FLEET_BOX_B, newMockFleet } from './mock-fleet';

/**
 * The Control Center broadcast (docs/control-center.md in the mantle repo,
 * "Broadcast"): an Admin writes one message, picks the boxes, confirms, and
 * the Sent list shows each box's mark (delivered, or the failure that keeps
 * it waiting). On a box, the Announcements chat is read-only: no composer,
 * no Reply, no Leave. In-memory brain (mock-fleet.ts, mock-chats.ts).
 */

const SHOTS = process.env.CC_BROADCAST_SHOTS;
const ANNOUNCEMENTS = 'c0000000-0000-4000-8000-0000000000a1';

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
});
test.afterEach(async () => {
  await api.close();
});

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};
const target = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Boxes to send to' })
    .getByRole('listitem')
    .filter({ hasText: name });

test('an Admin writes a broadcast, picks the boxes, confirms, and sees each box', async ({
  page,
}) => {
  api.fleet = newMockFleet();
  api.fleet.broadcastOn = true;
  // Box B does not answer: its broadcast waits there with the reason.
  api.fleet.broadcastAnswers[FLEET_BOX_B.id] = 'unreachable';
  await signIn(page, 'admin');
  await page.goto('/admin/fleet/broadcast');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Broadcast' })).toBeVisible();
  await expect(main.getByText('Nothing sent yet.')).toBeVisible();
  // Nothing goes before a box is picked and a message is written.
  const send = main.getByRole('button', { name: /^Send/ });
  await expect(send).toBeDisabled();
  await target(page, 'Box A').getByRole('checkbox').check();
  await expect(send).toBeDisabled();
  await main.getByLabel('Title (optional)').fill('Maintenance tonight');
  await main.getByLabel('Message').fill('The boxes restart at 22:00 UTC.');
  await main.getByRole('button', { name: 'All boxes' }).click();
  await expect(send).toHaveText('Send to 2 boxes');
  await shot(page, 'cc-broadcast-write');
  await send.click();

  const ask = page.getByRole('alertdialog', { name: 'Send to every person on 2 boxes?' });
  await expect(ask).toBeVisible();
  await expect(ask).toContainText('cannot be taken back');
  await ask.getByRole('button', { name: 'Send' }).click();
  await expect(ask).toHaveCount(0);
  expect(api.fleet.broadcastSent).toEqual([
    {
      title: 'Maintenance tonight',
      text: 'The boxes restart at 22:00 UTC.',
      boxIds: [FLEET_BOX.id, FLEET_BOX_B.id],
    },
  ]);
  // The form is clear again; the Sent list shows the marks.
  await expect(main.getByLabel('Message')).toHaveValue('');
  const sent = main.getByTestId('broadcast-sent');
  await expect(sent).toHaveCount(1);
  await expect(sent).toContainText('Maintenance tonight');
  await expect(sent).toContainText('1 of 2 delivered');
  const boxes = sent.getByRole('list', { name: 'Boxes' }).getByRole('listitem');
  await expect(boxes.filter({ hasText: 'Box A' })).toContainText('Delivered');
  await expect(boxes.filter({ hasText: 'box-b.example.invalid' })).toContainText(
    'Not delivered yet',
  );
  await expect(boxes.filter({ hasText: 'box-b.example.invalid' })).toContainText('HTTPS');
  // The box cards say how the last one went.
  await expect(target(page, 'Box A')).toContainText('Last broadcast: Delivered');
  await shot(page, 'cc-broadcast-sent');

  // A failure waits for the next run: the screen stops reading. Box B
  // answers again; a reload shows it delivered.
  const reads = () =>
    api.requests.filter((r) => r.path === '/api/fleet/broadcasts' && r.method === 'GET').length;
  const before = reads();
  await page.waitForTimeout(6_000);
  expect(reads()).toBe(before);
  delete api.fleet.broadcastAnswers[FLEET_BOX_B.id];
  await page.reload();
  await expect(main.getByTestId('broadcast-sent')).toContainText('2 of 2 delivered');
});

test('a brain before the broadcast says so in the Sent list', async ({ page }) => {
  api.fleet = newMockFleet();
  await signIn(page, 'admin');
  await page.goto('/admin/fleet/broadcast');
  await expect(
    page.getByRole('main').getByText(/A brain a release behind has none yet/),
  ).toBeVisible();
});

test('the Announcements chat is read-only: no composer, no Reply, no Leave', async ({ page }) => {
  api.chats.on = true;
  api.chats.addChat(ANNOUNCEMENTS, 'Announcements', 'group');
  api.chats.rows.find((r) => r.id === ANNOUNCEMENTS)!.announcements = true;
  api.chats.addLine(ANNOUNCEMENTS, {
    authorKind: 'system',
    authorId: null,
    authorName: 'it@example.com',
    body: 'Maintenance tonight\n\nThe boxes restart at 22:00 UTC.',
    event: { type: 'announcement', broadcastId: 'bc-1', title: 'Maintenance tonight' },
  });
  await signIn(page, 'admin');
  await page.goto(`/chats/${ANNOUNCEMENTS}`);
  const main = page.getByRole('main');
  await expect(main.getByTestId('chat-room')).toBeVisible();
  await expect(main.getByTestId('chat-card-label')).toHaveText('Announcement from it@example.com');
  await expect(main.getByTestId('chat-card')).toContainText('The boxes restart at 22:00 UTC.');
  await expect(main.getByTestId('chat-read-only')).toHaveText(
    'Only IT posts in Announcements. To answer, message the sender.',
  );
  await expect(main.getByRole('combobox', { name: 'Message' })).toHaveCount(0);
  await main.getByTestId('chat-card').hover();
  await expect(main.getByRole('button', { name: 'Reply' })).toHaveCount(0);
  await shot(page, 'cc-broadcast-announcements');
  // The details: no Leave group.
  await main.getByRole('button', { name: 'Details' }).click();
  await expect(page.getByRole('button', { name: 'Leave group' })).toHaveCount(0);
  expect(api.chats.sent).toEqual([]);
});
