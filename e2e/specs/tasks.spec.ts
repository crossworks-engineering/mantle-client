import { expect, test } from '../lib/fixtures';
import { ARTIFACTS_DIR } from '../lib/env';
import { clickUntilOpen } from '../lib/hydration';
import { openFromTree, treeRow } from '../lib/tree';
import type { APIRequestContext, Page } from '@playwright/test';

/**
 * `/tasks` behaviour net.
 *
 * The Tasks screen is the reference implementation for `docs/ui-style-guide.md`
 * and the most-changed surface in the app, and it had ZERO UI coverage: every
 * rule it establishes was verified by hand, once, in a browser. That was enough
 * to know it worked; it is not enough to keep it working while ~24 other screens
 * are edited to match it and the shared primitives underneath them move.
 *
 * Four behaviours, in value order (see docs/handover-ui-consistency.md §1):
 *  1. reordering a BLOCKED card inside In progress must not clear the flag —
 *     `statusForDrop` is unit-tested, the drag path that calls it is not;
 *  2. a long title truncates and the header actions stay inside the pane —
 *     the `editor-header.spec` shape: measure, budget, assert;
 *  3. archive/restore spans client + API + the archived-exclusion default;
 *  4. tick a Blocked task, untick it, it returns to Blocked — pure client
 *     state (a `useRef` map), easy to break, invisible when broken.
 *
 * Every spec tags its fixtures with a unique marker and narrows the screen to
 * it, so the suite's other content (and a box's real tasks) cannot change what
 * the assertions see: `?q=<marker>`, which the board, the Archived list and
 * the List view's item tree all read. Fixtures are deleted in a `finally`.
 */

type Task = { id: string; status: string; rank: string | null; archivedAt: string | null };

/** Board and detail both want room; the default 1280 leaves the board's three
 *  columns beside a 672px form under 200px each. */
test.use({ viewport: { width: 1600, height: 900 } });

async function createTask(
  api: APIRequestContext,
  data: Record<string, unknown>,
): Promise<{ id: string }> {
  const res = await api.post('/api/tasks', { data });
  expect(res.status(), `POST /api/tasks ${JSON.stringify(data)}`).toBe(201);
  return ((await res.json()) as { task: Task }).task;
}

async function readTask(api: APIRequestContext, id: string): Promise<Task> {
  const res = await api.get(`/api/tasks/${id}`);
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { task: Task }).task;
}

/** The card element for a task, in either the list or the board — both stamp
 *  the mark attributes the share/mention layer uses. */
function card(page: Page, title: string) {
  return page.locator(`[data-mark-kind="task"][data-mark-label="${title}"]`);
}

test.describe('tasks', () => {
  test.skip(({ topology }) => topology === 'same-origin', 'owner UI lives on the client app');

  test('board: reordering a blocked card inside In progress keeps it blocked', async ({
    ownerApi,
    ownerPage,
  }) => {
    // Blocked cards render UNDER In progress (there is no fourth column), so a
    // plain tidy-up drag inside that column must not post `in_progress` and
    // silently unblock the task. Ranks are set explicitly so the column order
    // is alpha → bravo → charlie before the drag, whatever the server returns.
    // The marker must not contain the word "blocked" — the badge assertion below
    // matches card text case-insensitively and would find the title too.
    const marker = `E2E stuck drag ${Date.now()}`;
    const alpha = await createTask(ownerApi, {
      title: `${marker} alpha`,
      status: 'in_progress',
      rank: 'g',
    });
    const bravo = await createTask(ownerApi, {
      title: `${marker} bravo`,
      status: 'blocked',
      rank: 'm',
    });
    const charlie = await createTask(ownerApi, {
      title: `${marker} charlie`,
      status: 'in_progress',
      rank: 't',
    });

    try {
      await ownerPage.goto(`/tasks?view=board&q=${encodeURIComponent(marker)}`);
      const source = card(ownerPage, `${marker} bravo`);
      const target = card(ownerPage, `${marker} alpha`);
      await expect(source).toBeVisible();
      await expect(target).toBeVisible();
      // The card has to SAY it is blocked — the column heading can't.
      await expect(source.getByText('Blocked')).toBeVisible();

      const from = (await source.boundingBox())!;
      const to = (await target.boundingBox())!;
      // dnd-kit's PointerSensor arms after 6px of travel, so the gesture needs a
      // deliberate first nudge; then land in alpha's UPPER half, which makes
      // alpha the `over` target and inserts bravo above it.
      await ownerPage.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await ownerPage.mouse.down();
      await ownerPage.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 12, {
        steps: 4,
      });
      await ownerPage.mouse.move(to.x + to.width / 2, to.y + 6, { steps: 12 });
      await ownerPage.mouse.up();

      // The rank MUST change: without this the spec passes vacuously whenever
      // the synthetic drag fails to register, which is the failure mode that
      // left this behaviour untested in the first place.
      await expect
        .poll(async () => (await readTask(ownerApi, bravo.id)).rank, {
          message: 'the drag never reached the API — no rank was written',
        })
        .not.toBe('m');
      const moved = await readTask(ownerApi, bravo.id);
      expect(moved.status, 'a reorder inside In progress must not clear Blocked').toBe('blocked');
      expect(moved.rank! < 'g', `rank ${moved.rank} should sort above alpha's 'g'`).toBeTruthy();

      // Still under In progress, still badged, and now ahead of alpha. The
      // count check waits out the DragOverlay, which renders a second copy of
      // the card — with the same mark attributes — until the drop settles.
      await expect(source).toHaveCount(1);
      await expect(source.getByText('Blocked')).toBeVisible();
      const after = (await source.boundingBox())!;
      const alphaAfter = (await target.boundingBox())!;
      expect(after.y).toBeLessThan(alphaAfter.y);
      await ownerPage.screenshot({ path: `${ARTIFACTS_DIR}tasks-board-blocked-drag.png` });
    } finally {
      for (const t of [alpha, bravo, charlie]) await ownerApi.delete(`/api/tasks/${t.id}`);
    }
  });

  test('detail: a long title truncates and the header actions stay in the pane', async ({
    ownerApi,
    ownerPage,
  }) => {
    // 130 chars — the length that first pushed the actions out of the pane when
    // this header was built. The title cell is `min-w-0 truncate`, the action
    // cluster `shrink-0`; drop either and the buttons leave the panel.
    const marker = `E2E long title ${Date.now()}`;
    const title = `${marker} ${'wide'.repeat(28)}`.slice(0, 130);
    const task = await createTask(ownerApi, { title });

    try {
      await ownerPage.goto('/tasks');
      const detail = ownerPage.locator('[data-testid="detail"]');
      const heading = detail.getByRole('heading', { name: title });
      await openFromTree(ownerPage, marker, heading);

      // Truncated, not wrapped: one line, clipped by the title's own box, the
      // text or a wrapper of it inside the heading.
      const clipped = await heading.getByText(title, { exact: true }).evaluate((el) => {
        for (let n: Element | null = el; n && n.tagName !== 'H2'; n = n.parentElement) {
          if (n.scrollWidth > n.clientWidth && n.getClientRects().length === 1) return true;
        }
        return false;
      });
      expect(clipped, 'the title should truncate on one line').toBeTruthy();

      // Every action still inside the pane, and on the title's row.
      const paneBox = (await detail.boundingBox())!;
      const headingBox = (await heading.boundingBox())!;
      for (const name of ['Edit task', 'Archive', 'Delete task']) {
        const button = detail.getByRole('button', { name, exact: true });
        await expect(button).toBeVisible();
        const box = (await button.boundingBox())!;
        expect(box.x + box.width, `${name} overflows the detail pane`).toBeLessThanOrEqual(
          paneBox.x + paneBox.width,
        );
        expect(
          Math.abs(box.y + box.height / 2 - (headingBox.y + headingBox.height / 2)),
          `${name} left the title's row`,
        ).toBeLessThan(8);
      }
      await ownerPage.screenshot({ path: `${ARTIFACTS_DIR}tasks-long-title.png` });
    } finally {
      await ownerApi.delete(`/api/tasks/${task.id}`);
    }
  });

  test('archive hides a task from list and board; restore brings it back', async ({
    ownerApi,
    ownerPage,
  }) => {
    // Spans the client, the API's `archived: boolean` and the server's
    // exclude-by-default filter — the one test that fails if any of the three
    // regresses. Archiving must also never re-index (see the handover's
    // landmine 3), so `updatedAt` is the only field allowed to move.
    const marker = `E2E archive ${Date.now()}`;
    const title = `${marker} filed away`;
    const task = await createTask(ownerApi, { title, status: 'done' });

    try {
      // Board first: a live task is there.
      await ownerPage.goto(`/tasks?view=board&q=${encodeURIComponent(marker)}`);
      await expect(card(ownerPage, title)).toBeVisible();

      // Archive from the detail pane, opened from the List view's tree.
      await ownerPage.goto('/tasks');
      const detail = ownerPage.locator('[data-testid="detail"]');
      await openFromTree(ownerPage, marker, detail.getByRole('heading', { name: title }));
      await detail.getByRole('button', { name: 'Archive', exact: true }).click();

      // Gone from the tree (which holds no archived tasks), and the API
      // stamped it.
      await expect(treeRow(ownerPage, title)).toBeHidden();
      await expect.poll(async () => (await readTask(ownerApi, task.id)).archivedAt).not.toBeNull();
      // Status is a separate axis — archiving must not rewrite it.
      expect((await readTask(ownerApi, task.id)).status).toBe('done');

      // Gone from the board too (the board asks for `status=all`, which must
      // still exclude archived work).
      await ownerPage.goto(`/tasks?view=board&q=${encodeURIComponent(marker)}`);
      await expect(card(ownerPage, title)).toBeHidden();

      // The List view's Archived button is where it went. (The status filter
      // that used to hold an Archived option belongs to the paged list, which
      // the tree replaced; Archived itself still is that list.)
      await ownerPage.goto('/tasks');
      const list = ownerPage.locator('[data-testid="list"]');
      // Typed until the answer shows: a fill a beat before hydration is reset.
      await expect(async () => {
        await list.getByRole('textbox', { name: 'Search tasks' }).fill(marker);
        await expect(list.getByText(/^Nothing matches/)).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 20_000 });
      await list.getByRole('button', { name: 'Archived', exact: true }).click();
      await expect(ownerPage).toHaveURL(/status=archived/);
      await expect(card(ownerPage, title)).toBeVisible();
      await ownerPage.screenshot({ path: `${ARTIFACTS_DIR}tasks-archived.png` });

      // Restore, from the same button in the same place. Click the row first:
      // a change of view deliberately does not steal the pane, so it may still
      // hold whatever it held before.
      await card(ownerPage, title).click();
      const archivedDetail = ownerPage.locator('[data-testid="detail"]');
      await expect(archivedDetail.getByRole('heading', { name: title })).toBeVisible();
      await archivedDetail.getByRole('button', { name: 'Restore from archive' }).click();
      await expect(card(ownerPage, title)).toBeHidden();
      await expect.poll(async () => (await readTask(ownerApi, task.id)).archivedAt).toBeNull();

      // …and it is back on the board.
      await ownerPage.goto(`/tasks?view=board&q=${encodeURIComponent(marker)}`);
      await expect(card(ownerPage, title)).toBeVisible();
    } finally {
      await ownerApi.delete(`/api/tasks/${task.id}`);
    }
  });

  test('the tree search lives in ?q=: a link, opening a task, the board, a reload, clearing', async ({
    ownerApi,
    ownerPage,
  }) => {
    // A link with ?q= used to open the tree unfiltered, and a reload, Back or
    // a switch to the Board lost the text: the tree kept it in local state.
    const marker = `E2E tree q ${Date.now()}`;
    const title = `${marker} pump`;
    const other = `E2E tree other ${Date.now()}`;
    const hit = await createTask(ownerApi, { title, status: 'open' });
    const miss = await createTask(ownerApi, { title: other, status: 'open' });
    const q = () => new URL(ownerPage.url()).searchParams.get('q');

    try {
      await ownerPage.goto(`/tasks?q=${encodeURIComponent(marker)}`);
      const list = ownerPage.locator('[data-testid="list"]');
      const search = list.getByRole('textbox', { name: 'Search tasks' });
      await expect(search).toHaveValue(marker);
      await expect(treeRow(ownerPage, title)).toBeVisible({ timeout: 20_000 });
      await expect(treeRow(ownerPage, other)).toBeHidden();

      // Opening a task from the search keeps q, so Back finds the search.
      const detail = ownerPage.locator('[data-testid="detail"]');
      await clickUntilOpen(treeRow(ownerPage, title), detail.getByRole('heading', { name: title }));
      await expect.poll(q).toBe(marker);

      // To the Board and back: the same text both ways.
      await ownerPage.getByRole('radio', { name: 'Board view' }).click();
      await expect(ownerPage).toHaveURL(/view=board/);
      expect(q()).toBe(marker);
      await expect(ownerPage.getByPlaceholder('Search tasks…')).toHaveValue(marker);
      await expect(card(ownerPage, title)).toBeVisible();
      await expect(card(ownerPage, other)).toBeHidden();
      await ownerPage.getByRole('radio', { name: 'List view' }).click();
      await expect(ownerPage).not.toHaveURL(/view=board/);
      await expect(search).toHaveValue(marker);
      await expect(treeRow(ownerPage, title)).toBeVisible();

      // A reload keeps it.
      await ownerPage.reload();
      await expect(search).toHaveValue(marker);
      await expect(treeRow(ownerPage, title)).toBeVisible({ timeout: 20_000 });

      // Clearing the search takes q out of the URL.
      await expect(async () => {
        await search.fill('');
        await expect.poll(q, { timeout: 2_000 }).toBeNull();
      }).toPass({ timeout: 20_000 });
    } finally {
      for (const t of [hit, miss]) await ownerApi.delete(`/api/tasks/${t.id}`);
    }
  });

  test('files: the card lists the task files, Attach sends one, Delete names them', async ({
    ownerApi,
    ownerPage,
  }) => {
    // The screen, not the brain: the file routes are answered here, so the
    // spec runs against a brain with or without files on tasks. The one-task
    // read is the real one with `files` added.
    const marker = `E2E files ${Date.now()}`;
    const title = `${marker} crash`;
    const task = await createTask(ownerApi, { title });
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    );
    const files = [
      {
        id: '00000000-0000-4000-8000-0000000000f1',
        filename: 'server.log',
        mimeType: 'text/plain',
        sizeBytes: 2048,
        createdAt: new Date().toISOString(),
      },
    ];
    const posted: string[] = [];
    await ownerPage.route(
      (url) => url.pathname === `/api/tasks/${task.id}`,
      async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const res = await route.fetch();
        const body = (await res.json()) as { task: Record<string, unknown> };
        return route.fulfill({ response: res, json: { task: { ...body.task, files } } });
      },
    );
    await ownerPage.route(
      (url) => url.pathname === `/api/tasks/${task.id}/files`,
      async (route) => {
        const sent = route.request().postDataBuffer()?.toString('latin1') ?? '';
        const filename = /filename="([^"]+)"/.exec(sent)?.[1] ?? 'unnamed';
        posted.push(filename);
        const file = {
          id: '00000000-0000-4000-8000-0000000000f2',
          filename,
          mimeType: 'image/png',
          sizeBytes: png.byteLength,
          createdAt: new Date().toISOString(),
        };
        files.push(file);
        return route.fulfill({ status: 201, json: { file } });
      },
    );
    await ownerPage.route(
      (url) => url.pathname.startsWith(`/api/tasks/${task.id}/files/`),
      (route) => route.fulfill({ status: 200, contentType: 'image/png', body: png }),
    );

    try {
      await ownerPage.goto('/tasks');
      const detail = ownerPage.locator('[data-testid="detail"]');
      await openFromTree(ownerPage, marker, detail.getByRole('heading', { name: title }));

      const items = detail.locator('[data-testid="task-file"]');
      await expect(items).toHaveCount(1);
      await expect(items.first()).toContainText('server.log');
      await expect(detail.getByText('1 of 5')).toBeVisible();

      await detail
        .locator('input[type="file"]')
        .setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: png });
      await expect.poll(() => posted).toEqual(['shot.png']);
      await expect(items).toHaveCount(2);
      await expect(detail.getByRole('img', { name: 'shot.png' })).toBeVisible();
      await expect(detail.getByText('2 of 5')).toBeVisible();
      await ownerPage.screenshot({ path: `${ARTIFACTS_DIR}tasks-files.png` });

      // The delete dialog says the files go too.
      await detail.getByRole('button', { name: 'Delete task', exact: true }).click();
      await expect(ownerPage.getByRole('alertdialog')).toContainText(
        'This also deletes its 2 files.',
      );
      await ownerPage.getByRole('button', { name: 'Cancel' }).click();
    } finally {
      await ownerApi.delete(`/api/tasks/${task.id}`);
    }
  });

  test('submit: Send to each target, the sent line and reply, a Reply on a received copy', async ({
    ownerApi,
    ownerPage,
  }) => {
    // The screen, not the brain, as the files spec: the submit routes are
    // answered here, and the one-task read is the real one with
    // `submission` added once the spec has one for it.
    const marker = `E2E submit ${Date.now()}`;
    const mine = await createTask(ownerApi, { title: `${marker} mine` });
    const copy = await createTask(ownerApi, { title: `${marker} copy` });
    const at = '2026-11-10T09:00:00.000Z';
    const submissions: Record<string, Record<string, unknown>> = {
      [copy.id]: {
        side: 'received',
        kind: 'feature',
        from: {
          box: { id: 'b1', name: 'Plant box' },
          taskId: 't1',
          by: { name: 'Ann', email: 'ann@example.com' },
        },
        receivedAt: at,
      },
    };
    const sent: unknown[] = [];
    const replies: unknown[] = [];

    await ownerPage.route(
      (url) => url.pathname === '/api/tasks/submit',
      (route) =>
        route.fulfill({
          json: {
            buttons: [
              { to: 'admin', label: 'Admin' },
              { to: 'it', label: 'Helpdesk' },
            ],
          },
        }),
    );
    for (const t of [mine, copy]) {
      await ownerPage.route(
        (url) => url.pathname === `/api/tasks/${t.id}`,
        async (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          const res = await route.fetch();
          const body = (await res.json()) as { task: Record<string, unknown> };
          const submission = submissions[t.id];
          return route.fulfill({
            response: res,
            json: { task: submission ? { ...body.task, submission } : body.task },
          });
        },
      );
    }
    await ownerPage.route(
      (url) => url.pathname === `/api/tasks/${mine.id}/submit`,
      async (route) => {
        const body = route.request().postDataJSON() as { kind: string; to: string };
        sent.push(body);
        submissions[mine.id] = { side: 'sent', kind: body.kind, to: body.to, sentAt: at };
        const task = await readTask(ownerApi, mine.id);
        return route.fulfill({ json: { task: { ...task, submission: submissions[mine.id] } } });
      },
    );
    await ownerPage.route(
      (url) => url.pathname === `/api/tasks/${copy.id}/reply`,
      async (route) => {
        const body = route.request().postDataJSON() as { note: string; version?: string };
        replies.push(body);
        submissions[copy.id] = {
          ...submissions[copy.id],
          reply: { status: 'done', note: body.note, version: '9.9.9', by: 'Owner', at },
        };
        const task = await readTask(ownerApi, copy.id);
        return route.fulfill({ json: { task: { ...task, submission: submissions[copy.id] } } });
      },
    );

    try {
      await ownerPage.goto('/tasks');
      const detail = ownerPage.locator('[data-testid="detail"]');

      // Report opens the new-task form with a kind.
      await ownerPage.getByRole('button', { name: 'Report a bug or request' }).first().click();
      await expect(detail.getByRole('heading', { name: 'Report a bug or request' })).toBeVisible();

      // One button per entry; the kind picked goes with the send.
      await openFromTree(
        ownerPage,
        `${marker} mine`,
        detail.getByRole('heading', { name: `${marker} mine` }),
      );
      await expect(detail.getByRole('button', { name: 'Send to Admin' })).toBeVisible();
      await expect(detail.getByRole('button', { name: 'Send to Helpdesk' })).toBeVisible();
      await detail.getByRole('radio', { name: 'Request' }).click();
      await detail.getByRole('button', { name: 'Send to Helpdesk' }).click();
      await expect.poll(() => sent).toEqual([{ kind: 'request', to: 'it' }]);
      const card = detail.locator('[data-testid="task-submission"]');
      await expect(card).toContainText('Sent to Helpdesk');
      await expect(detail.getByRole('button', { name: 'Send to Admin' })).toHaveCount(0);

      // A received copy: who sent it, then the Reply form, then the reply.
      await openFromTree(
        ownerPage,
        `${marker} copy`,
        detail.getByRole('heading', { name: `${marker} copy` }),
      );
      await expect(card).toContainText('From Ann (ann@example.com) on Plant box');
      await detail.getByRole('textbox', { name: 'Reply' }).fill('Fixed in the next build.');
      await detail.getByRole('button', { name: 'Reply', exact: true }).click();
      await expect.poll(() => replies).toEqual([{ note: 'Fixed in the next build.' }]);
      const reply = card.locator('[data-testid="reply"]');
      await expect(reply).toContainText('Fixed in the next build.');
      await expect(reply).toContainText('Version 9.9.9');
      await expect(reply).toContainText('by Owner');
      await ownerPage.screenshot({ path: `${ARTIFACTS_DIR}tasks-submit.png` });
    } finally {
      for (const t of [mine, copy]) await ownerApi.delete(`/api/tasks/${t.id}`);
    }
  });

  test('ticking a blocked task and unticking it returns it to Blocked', async ({
    ownerApi,
    ownerPage,
  }) => {
    // The checkbox is binary over a four-state vocabulary, so unticking has to
    // be an UNDO, not a reset to `open`. The previous status lives in a `useRef`
    // map in the client — nothing renders from it, so a refactor can drop it
    // without any visible symptom until someone changes their mind mid-task.
    const marker = `E2E stuck toggle ${Date.now()}`;
    const title = `${marker} stuck`;
    const task = await createTask(ownerApi, { title, status: 'blocked' });

    try {
      // The tick is the detail header's now: the tree's done box shows state
      // only (a control inside the row would be a button in a button), and
      // both ticks call the same undo-aware toggle.
      await ownerPage.goto('/tasks');
      const detail = ownerPage.locator('[data-testid="detail"]');
      const status = detail.getByRole('combobox', { name: 'Status' });
      await openFromTree(ownerPage, marker, status);
      await expect(status).toHaveText('Blocked');

      await detail.getByRole('button', { name: 'Mark done' }).click();
      await expect(status).toHaveText('Done');
      await expect.poll(async () => (await readTask(ownerApi, task.id)).status).toBe('done');

      await detail.getByRole('button', { name: 'Mark not done' }).click();
      await expect(status, 'unticking should restore Blocked, not fall back to To do').toHaveText(
        'Blocked',
      );
      await expect.poll(async () => (await readTask(ownerApi, task.id)).status).toBe('blocked');
    } finally {
      await ownerApi.delete(`/api/tasks/${task.id}`);
    }
  });
});
