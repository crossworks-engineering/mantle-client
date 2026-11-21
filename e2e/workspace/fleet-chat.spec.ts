import { expect, test, type Page } from '@playwright/test';
import { signIn, startMockWorkspaceApi, type MockWorkspaceApi } from './mock-workspace-api';

/**
 * Fleet chat phase 1 in the chat screen (brain plan page f2f19c7b,
 * milestone 4): the @ list's handles and IT desks, the send screen with the
 * intake form and the added lines, the chips on a line (sent to @qa, a
 * desk's status), a copy line as a card whose Reply goes back, files on a
 * line (upload, too big, inline, Save to Files), a group's handle and form,
 * my own "To @bugs (IT)" thread from New chat, and the area capture's
 * "Send to chat". In-memory brain, no real one.
 */

const ANN = 'c0000000-0000-4000-8000-000000000001';
const QA = 'c0000000-0000-4000-8000-000000000002';
const CREW = 'c0000000-0000-4000-8000-000000000003';
const SHOTS = process.env.FLEET_CHAT_SHOTS;

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
  api.chats.on = true;
  api.chats.addChat(ANN, 'Ann');
  api.chats.addChat(QA, 'QA crew', 'group');
  api.chats.addChat(CREW, 'Crew', 'group');
  const qa = api.chats.rows.find((r) => r.id === QA)!;
  qa.handle = 'qa';
  qa.intake = 'bug';
});
test.afterEach(async () => {
  await api.close();
});

const main = (page: Page) => page.getByRole('main');
const box = (page: Page) => main(page).getByRole('combobox', { name: 'Message' });
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

async function openChat(page: Page, id: string) {
  await signIn(page, 'admin');
  await page.goto(`/chats/${id}`);
  await expect(main(page).getByTestId('chat-room')).toBeVisible();
}

test('the @ list offers handles, and a line to a handle shows its package first', async ({
  page,
}) => {
  await openChat(page, ANN);
  await box(page).fill('Login fails @q');
  const option = main(page).getByRole('option', { name: /@qa/ });
  await expect(option).toBeVisible();
  await expect(option).toContainText('QA crew');
  await option.click();
  await box(page).press('End');
  await box(page).pressSequentially('on save');
  await box(page).press('Enter');

  const preview = page.getByTestId('send-preview');
  await expect(preview.getByRole('heading', { name: 'Send to @qa' })).toBeVisible();
  // The bug form, and the lines the app adds, each removable.
  await preview.getByLabel('What did you do?').fill('Pressed Save');
  await expect(preview.getByLabel('What happened?')).toBeVisible();
  await expect(preview.getByTestId('added-lines')).toContainText('App version:');
  await expect(preview.getByTestId('added-lines')).toContainText('Page: /chats/');
  await shot(page, 'send-preview');
  await preview.getByRole('button', { name: 'Remove Screen' }).click();
  // Nothing went before Send.
  expect(api.chats.sentRequests).toEqual([]);
  await preview.getByRole('button', { name: 'Send' }).click();

  await expect.poll(() => api.chats.sentRequests.length).toBe(1);
  const { req } = api.chats.sentRequests[0]!;
  expect(req.mentions).toEqual([{ kind: 'handle', id: QA }]);
  expect(req.answers).toEqual({ did: 'Pressed Save' });
  expect(req.body).toContain('Login fails @qa on save');
  expect(req.body).toContain('App version:');
  expect(req.body).not.toContain('Screen:');
});

test('a line shows "Sent to @qa" and an IT desk with its status', async ({ page }) => {
  api.chats.desks = true;
  api.chats.addLine(ANN, {
    authorId: 'me',
    authorName: 'Me',
    body: 'Two places',
    mentions: [
      { kind: 'handle', id: QA, handle: 'qa', seq: 4 },
      { kind: 'desk', id: 'bug', taskId: 't1', status: 'received' },
    ],
  });
  await openChat(page, ANN);
  const chips = main(page).getByTestId('chat-chip');
  await expect(chips).toHaveText(['Sent to @qa', '@bugs (IT): Received by IT']);
  await shot(page, 'line-chips');
});

test('a copy line is a card, and its Reply goes back', async ({ page }) => {
  api.chats.addLine(QA, {
    authorKind: 'system',
    authorId: null,
    authorName: 'Ann',
    body: 'The export button does nothing',
    event: { type: 'intake', from: { conversationId: ANN, seq: 3 }, by: 'ann-id' },
  });
  await openChat(page, QA);
  await expect(main(page).getByTestId('chat-card-label')).toHaveText('Ann, to @qa');
  const card = main(page).getByTestId('chat-card');
  await expect(card).toHaveText('The export button does nothing');
  await card.hover();
  await main(page).getByRole('button', { name: 'Reply' }).click();
  const bar = main(page).getByTestId('composer-reply');
  await expect(bar).toContainText('Reply to Ann');
  await expect(bar).toContainText('goes back to the chat it came from');
  await shot(page, 'copy-line-reply');
  await box(page).fill('Fixed in the next release');
  await box(page).press('Enter');
  await expect.poll(() => api.chats.sentRequests.length).toBe(1);
  expect(api.chats.sentRequests[0]!.req).toMatchObject({
    body: 'Fixed in the next release',
    replyToSeq: 1,
  });
  await expect(bar).toBeHidden();
});

test('files: uploaded as added, one too big is left out, a picture shows, Save to Files', async ({
  page,
}) => {
  api.chats.addLine(ANN, {
    body: 'Here is the picture',
    files: [{ id: 'att-9', name: 'shot.png', mime: 'image/png', bytes: 68, kind: 'image' }],
  });
  await openChat(page, ANN);
  await expect(main(page).getByRole('img', { name: 'shot.png' })).toBeVisible();

  await main(page)
    .getByTestId('composer-file-input')
    .setInputFiles([
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('a note') },
      { name: 'dump.log', mimeType: 'text/plain', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) },
    ]);
  const files = main(page).getByTestId('composer-file');
  await expect(files).toHaveCount(2);
  await expect(files.nth(1)).toContainText('Too big. It will not be sent.');
  await expect.poll(() => api.chats.uploads).toEqual([{ chat: ANN, name: 'notes.txt' }]);
  await shot(page, 'composer-files');
  await box(page).fill('See the files');
  await box(page).press('Enter');
  await expect.poll(() => api.chats.sentRequests.length).toBe(1);
  expect(api.chats.sentRequests[0]!.req).toMatchObject({
    body: 'See the files',
    attachments: ['att-1'],
    leftOut: [{ name: 'dump.log', bytes: 10 * 1024 * 1024 + 1 }],
  });
  await expect(files).toHaveCount(0);

  await main(page).getByTestId('chat-file').first().hover();
  await main(page).getByRole('button', { name: 'Save shot.png to Files' }).click();
  // The Files tree's own folder picker: the top of Files is `files`.
  const dialog = page.getByRole('dialog', { name: 'Save “shot.png” to…' });
  await dialog.getByRole('treeitem', { name: 'All files' }).click();
  await dialog.getByRole('button', { name: 'Save here' }).click();
  await expect.poll(() => api.chats.saved).toEqual([{ id: 'att-9', parentPath: 'files' }]);
});

test('a group admin sets its handle and intake form; a reserved word is refused here', async ({
  page,
}) => {
  await openChat(page, CREW);
  await main(page).getByRole('button', { name: 'Details' }).click();
  const handle = main(page).getByTestId('chat-handle');
  await handle.getByRole('button', { name: 'Add a handle to the group' }).click();
  await handle.getByLabel('Handle').fill('bugs');
  await handle.getByRole('button', { name: 'Save handle' }).click();
  await expect(handle).toContainText('@bugs is kept for the box');
  expect(api.chats.patched).toEqual([]);

  await handle.getByLabel('Handle').fill('@Safety');
  await handle.getByRole('combobox', { name: 'Intake form' }).click();
  await page.getByRole('option', { name: 'Feature request' }).click();
  await shot(page, 'group-handle');
  await handle.getByRole('button', { name: 'Save handle' }).click();
  await expect
    .poll(() => api.chats.patched)
    .toEqual([{ chat: CREW, req: { handle: 'safety', intake: 'feature' } }]);
  await expect(handle.getByTestId('chat-handle-text')).toHaveText('@safety, Feature request form');
});

test('New chat lists the IT desks; a desk opens my own thread, where a line goes to the desk', async ({
  page,
}) => {
  api.chats.desks = true;
  await signIn(page, 'admin');
  await page.goto('/chats');
  await main(page).getByRole('button', { name: 'New chat', exact: true }).click();
  const section = main(page).getByRole('region', { name: 'Handles and IT desks' });
  await expect(section.getByTestId('address-row')).toHaveCount(4);
  await shot(page, 'new-chat-addresses');
  await section.getByRole('button', { name: /@bugs \(IT\)/ }).click();
  await expect.poll(() => api.chats.opened).toEqual([{ handle: 'bugs', site: 'IT' }]);
  await expect(main(page).getByTestId('chat-room')).toContainText('To @bugs (IT)');

  await box(page).fill('The app closed itself');
  // Send waits until the thread's first line says where it goes.
  await expect(main(page).getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await box(page).press('Enter');
  const preview = page.getByTestId('send-preview');
  await expect(preview.getByRole('heading', { name: 'Send to @bugs (IT)' })).toBeVisible();
  await preview.getByLabel('What happened?').fill('It closed');
  await preview.getByRole('button', { name: 'Send' }).click();
  await expect.poll(() => api.chats.sentRequests.length).toBe(1);
  expect(api.chats.sentRequests[0]!.req).toMatchObject({
    mentions: [{ kind: 'desk', id: 'bug' }],
    answers: { happened: 'It closed' },
  });
});

test('the area capture puts its picture in the open chat, with the warning before send', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.mantleDesktop = {
      platform: 'darwin',
      notify: () => undefined,
      setBadge: () => undefined,
      capture: async (rect: { w: number; h: number }) => {
        const c = document.createElement('canvas');
        c.width = rect.w;
        c.height = rect.h;
        c.getContext('2d')!.fillRect(0, 0, rect.w, rect.h);
        const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
        return new Uint8Array(await blob.arrayBuffer());
      },
    };
  });
  await openChat(page, ANN);
  await page.getByRole('button', { name: 'Capture an area for the assistant' }).click();
  await page.mouse.move(200, 150);
  await page.mouse.down();
  await page.mouse.move(420, 300, { steps: 5 });
  await page.mouse.up();
  const capture = page.getByRole('dialog', { name: 'Screenshot' });
  await capture.getByRole('button', { name: 'Send to chat' }).click();
  await expect(capture).toBeHidden();
  // Not saved to Files: it waits in the draft of the open chat.
  expect(api.screenshots).toHaveLength(0);
  await expect(main(page).getByTestId('composer-file')).toHaveCount(1);
  await expect.poll(() => api.chats.uploads.length).toBe(1);
  expect(api.chats.uploads[0]!.chat).toBe(ANN);

  // To a handle, the send screen shows the picture with the warning.
  await box(page).fill('Look @q');
  await main(page).getByRole('option', { name: /@qa/ }).click();
  await box(page).press('Enter');
  const preview = page.getByTestId('send-preview');
  await expect(preview.getByTestId('shot-warning')).toHaveText(
    'A screenshot can show client data. Check it before you send.',
  );
  await shot(page, 'capture-to-chat-preview');
  await preview.getByRole('button', { name: 'Send' }).click();
  await expect.poll(() => api.chats.sentRequests.length).toBe(1);
  expect(api.chats.sentRequests[0]!.req.attachments).toEqual(['att-1']);
});

test('a paste from Word or Excel stays text; a pasted picture goes in as a file', async ({
  page,
}) => {
  await openChat(page, ANN);
  const paste = (rich: boolean) =>
    box(page).evaluate((el, rich) => {
      const dt = new DataTransfer();
      if (rich) {
        dt.setData('text/plain', 'A1 B1');
        dt.setData('text/html', '<table><tr><td>A1</td><td>B1</td></tr></table>');
      }
      dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'image', { type: 'image/png' }));
      el.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    }, rich);
  // Cells from a sheet come with a picture of themselves: not a file.
  await paste(true);
  await page.waitForTimeout(300);
  await expect(main(page).getByTestId('composer-file')).toHaveCount(0);
  expect(api.chats.uploads).toEqual([]);
  // A picture alone (a snippet tool's) is a file, named by its type.
  await paste(false);
  await expect(main(page).getByTestId('composer-file')).toHaveCount(1);
  await expect.poll(() => api.chats.uploads).toEqual([{ chat: ANN, name: 'image.png' }]);
});

test('a capture into a draft that holds 5 files is refused, and the preview stays', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.mantleDesktop = {
      platform: 'darwin',
      notify: () => undefined,
      setBadge: () => undefined,
      capture: async (rect: { w: number; h: number }) => {
        const c = document.createElement('canvas');
        c.width = rect.w;
        c.height = rect.h;
        c.getContext('2d')!.fillRect(0, 0, rect.w, rect.h);
        const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
        return new Uint8Array(await blob.arrayBuffer());
      },
    };
  });
  await openChat(page, ANN);
  await main(page)
    .getByTestId('composer-file-input')
    .setInputFiles(
      Array.from({ length: 5 }, (_, i) => ({
        name: `${i}.txt`,
        mimeType: 'text/plain',
        buffer: Buffer.from('x'),
      })),
    );
  await expect.poll(() => api.chats.uploads.length).toBe(5);
  await page.getByRole('button', { name: 'Capture an area for the assistant' }).click();
  await page.mouse.move(200, 150);
  await page.mouse.down();
  await page.mouse.move(420, 300, { steps: 5 });
  await page.mouse.up();
  const capture = page.getByRole('dialog', { name: 'Screenshot' });
  await capture.getByRole('button', { name: 'Send to chat' }).click();
  await expect(
    page.getByText(/A line takes at most 5 files\. Not added: screenshot-/),
  ).toBeVisible();
  // Nothing thrown away: the picture is still there to save.
  await expect(capture.getByRole('img', { name: 'The captured area' })).toBeVisible();
  await expect(main(page).getByTestId('composer-file')).toHaveCount(5);
  expect(api.chats.uploads).toHaveLength(5);
});

test('a To thread holds Send until its address is read, and a failed read offers Retry', async ({
  page,
}) => {
  api.chats.desks = true;
  // The first line's read: it fails twice (the query and its one retry),
  // then answers.
  let fails = 2;
  await page.route(
    (url) =>
      url.pathname.endsWith('/messages') &&
      url.searchParams.get('after_seq') === '0' &&
      url.searchParams.get('limit') === '1',
    (route) => {
      if (fails > 0) {
        fails -= 1;
        return route.fulfill({ status: 500, body: '{"error":"busy"}' });
      }
      return route.continue();
    },
  );
  await signIn(page, 'admin');
  await page.goto('/chats');
  await main(page).getByRole('button', { name: 'New chat', exact: true }).click();
  await main(page)
    .getByRole('region', { name: 'Handles and IT desks' })
    .getByRole('button', { name: /@bugs \(IT\)/ })
    .click();
  await expect(main(page).getByTestId('chat-room')).toContainText('To @bugs (IT)');
  await box(page).fill('Still broken');
  const send = main(page).getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeDisabled();
  await box(page).press('Enter');
  await expect(page.getByTestId('send-preview')).toHaveCount(0);
  expect(api.chats.sentRequests).toEqual([]);

  await main(page).getByRole('button', { name: 'Retry' }).click();
  await expect(send).toBeEnabled();
  await send.click();
  await expect(
    page.getByTestId('send-preview').getByRole('heading', { name: 'Send to @bugs (IT)' }),
  ).toBeVisible();
});
