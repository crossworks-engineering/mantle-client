import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { expect, test } from '../lib/fixtures';

/**
 * The item header contract (2026-10-21), on every kind: an item opened at its
 * own address shows ONE header row of the standard height above its content;
 * the fixed slots keep their order from the right (More, Edit, Delete, Focus,
 * Info, Access); the folders stay beside it, in read and edit mode alike; ⋯ is
 * never empty; maximise hides the folders and the one back link (or Esc)
 * brings them back with the item still open.
 *
 * One table of kinds, one set of checks: a screen that hand-rolls its header
 * again, grows a second row, or drops the tree on edit fails here by name.
 */

/** 44px at the browser's default text size; a second row would double it. */
const HEADER_MAX_PX = 56;
/** The fixed slots, left to right. A kind may leave one out, never reorder. */
const FIXED = ['access', 'info', 'focus', 'delete', 'edit', 'more'];

type Made = { id: string; title: string | null; cleanup: () => Promise<void> };

type Kind = {
  name: string;
  section: string;
  create: (api: APIRequestContext) => Promise<Made>;
  /** It has an edit address (`?edit=1`); an always-open form does not. */
  editAddress: boolean;
  /** The header's test hook, when the screen pins its own. */
  testId?: string;
};

const stamp = () => `E2E header ${Date.now()}`;

/** POST a row, hand back its id and a deleter; `key` names the row in the
 *  answer (`{ page: {...} }`). */
function creates(collection: string, key: string, data: (title: string) => object) {
  return async (api: APIRequestContext): Promise<Made> => {
    const title = stamp();
    const res = await api.post(`/api/${collection}`, { data: data(title) });
    expect(res.status(), `could not create the ${collection} fixture`).toBeLessThan(300);
    const body = (await res.json()) as Record<string, { id?: string } | string | undefined>;
    const row = body[key];
    const id =
      (typeof row === 'object' ? row?.id : undefined) ??
      ((body.id ?? body[`${key}Id`]) as string | undefined);
    expect(id, `no id in the ${collection} answer`).toBeTruthy();
    return {
      id: id!,
      title,
      cleanup: async () => {
        await api.delete(`/api/${collection}/${id}`);
      },
    };
  };
}

const soon = () => new Date(Date.now() + 3 * 86_400_000).toISOString();

const KINDS: Kind[] = [
  {
    name: 'page',
    section: 'pages',
    create: creates('pages', 'page', (title) => ({ title })),
    editAddress: true,
  },
  {
    name: 'note',
    section: 'notes',
    create: creates('notes', 'note', (title) => ({ title, content: 'x' })),
    editAddress: true,
  },
  {
    name: 'drawing',
    section: 'draw',
    create: creates('draws', 'draw', (title) => ({ title })),
    editAddress: true,
  },
  {
    name: 'table',
    section: 'tables',
    create: creates('tables', 'table', (title) => ({ title })),
    editAddress: false,
  },
  {
    name: 'task',
    section: 'tasks',
    create: creates('tasks', 'task', (title) => ({ title })),
    editAddress: true,
  },
  {
    name: 'event',
    section: 'events',
    create: creates('events', 'event', (title) => ({ title, startsAt: soon() })),
    editAddress: true,
  },
  {
    name: 'journal entry',
    section: 'journal',
    create: creates('journal', 'journal', (title) => ({ title, body: 'x' })),
    editAddress: true,
  },
  {
    name: 'contact',
    section: 'contacts',
    // A contact's title is its name; the check reads the last name in it.
    create: creates('contacts', 'contact', (title) => ({ first_name: 'E2E', last_name: title })),
    editAddress: false,
  },
  {
    name: 'Recall map',
    section: 'recall',
    create: creates('recall/maps', 'map', (title) => ({
      title,
      enterWhen: 'an e2e run checks the item header',
    })),
    editAddress: false,
  },
  {
    name: 'formula',
    section: 'formulas',
    create: async (api) => {
      // Formulas need a spec: the brain's examples carry them.
      expect((await api.post('/api/formulas/seed')).ok()).toBeTruthy();
      const res = await api.get('/api/formulas?q=Ideal%20gas%20density');
      const { formulas } = (await res.json()) as { formulas: { id: string }[] };
      expect(formulas[0], 'no example formula').toBeTruthy();
      return { id: formulas[0]!.id, title: 'Ideal gas density', cleanup: async () => {} };
    },
    editAddress: true,
  },
  {
    name: 'app',
    section: 'apps',
    create: async (api) => {
      const name = stamp();
      const res = await api.post('/api/apps', { data: { name } });
      expect(res.status(), 'could not create the fixture app').toBeLessThan(300);
      const { app } = (await res.json()) as { app: { id: string } };
      return {
        id: app.id,
        title: name,
        cleanup: async () => {
          await api.delete(`/api/apps/${app.id}`);
        },
      };
    },
    editAddress: true,
    testId: 'app-item-header',
  },
];

/** The header in the detail pane, once. */
function headerOf(page: Page, kind: Kind): Locator {
  return page
    .locator('[data-testid="detail"]')
    .getByTestId(kind.testId ?? 'item-header')
    .first();
}

async function slotsOf(header: Locator): Promise<string[]> {
  return header
    .locator('[data-slot]')
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.slot ?? ''));
}

async function checkHeader(page: Page, kind: Kind, title: string | null) {
  const detail = page.locator('[data-testid="detail"]');
  await expect(detail.getByTestId(kind.testId ?? 'item-header')).toHaveCount(1, {
    timeout: 30_000,
  });
  const header = headerOf(page, kind);
  // The accessible name, not the text: a kind whose title is a rename box
  // (a table) holds it as the box's value.
  if (title) await expect(header.getByRole('heading')).toHaveAccessibleName(new RegExp(title));

  const box = await header.boundingBox();
  expect(box, 'the header has no box').not.toBeNull();
  expect(box!.height, `${kind.name}: the header is taller than one row`).toBeLessThan(
    HEADER_MAX_PX,
  );

  // The fixed slots keep their order; one may be absent, none may move.
  const slots = await slotsOf(header);
  expect(slots.at(-1), `${kind.name}: More is not last`).toBe('more');
  expect(
    slots.every((s, i) => i === 0 || FIXED.indexOf(s) > FIXED.indexOf(slots[i - 1]!)),
    `${kind.name}: the fixed slots are out of order: ${slots.join(', ')}`,
  ).toBe(true);

  // ⋯ is never empty: it always holds Copy link.
  const more = header.locator('[data-slot="more"] button');
  await expect(more).toBeEnabled();
  await more.click();
  await expect(page.getByRole('menuitem', { name: 'Copy link' })).toBeVisible();
  await page.keyboard.press('Escape');
}

async function checkTree(page: Page, kind: Kind, when: string) {
  await expect(
    page.locator('[data-testid="list"]').first(),
    `${kind.name}: the folders went away ${when}`,
  ).toBeVisible();
}

test.describe('item header on every kind', () => {
  test.skip(({ topology }) => topology === 'same-origin', 'owner UI lives on the client app');

  for (const kind of KINDS) {
    test(`${kind.name}: one row, fixed slots, folders stay, maximise and back`, async ({
      ownerApi,
      ownerPage,
    }) => {
      test.setTimeout(120_000);
      await ownerPage.setViewportSize({ width: 1600, height: 900 });
      const made = await kind.create(ownerApi);
      try {
        // Read: its own address.
        await ownerPage.goto(`/${kind.section}/${made.id}`);
        await checkHeader(ownerPage, kind, made.title);
        await checkTree(ownerPage, kind, 'when reading');

        // Maximise hides the folders; the one back link brings them back.
        const header = headerOf(ownerPage, kind);
        await header.locator('[data-slot="focus"] button').click();
        const back = header.getByTestId('item-header-back');
        await expect(back).toBeVisible();
        await back.click();
        await checkTree(ownerPage, kind, 'after the back link');
        await expect(back).toHaveCount(0);

        // Edit: its edit address, the folders still beside it, the pencil on.
        if (kind.editAddress) {
          await ownerPage.goto(`/${kind.section}/${made.id}?edit=1`);
          const editHeader = headerOf(ownerPage, kind);
          await expect(editHeader.locator('[data-slot="edit"] [aria-pressed="true"]')).toBeVisible({
            timeout: 30_000,
          });
          const box = await editHeader.boundingBox();
          expect(box!.height, `${kind.name}: the editor's header is taller`).toBeLessThan(
            HEADER_MAX_PX,
          );
          await checkTree(ownerPage, kind, 'when editing');
        }
      } finally {
        await made.cleanup();
      }
    });
  }
});
