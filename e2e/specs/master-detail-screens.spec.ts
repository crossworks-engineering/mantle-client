import { expect, test } from '../lib/fixtures';
import { ARTIFACTS_DIR } from '../lib/env';

/**
 * The scaffold half of phase 2, asserted once for every ported screen instead of
 * copy-pasted into seven files.
 *
 * `events`, `contacts`, `journal`, `secrets`, `formulas` and `apps` have their own specs
 * because the port changed real behaviour there (validation, saving, the
 * composer), and `notes`/`draw`/`pages` add `focus-mode.spec.ts` for the half a
 * screenshot cannot tell apart. `models`, `runs`, `sandboxes` and `tables` were pure
 * scaffold swaps — no form, no new validation — so what is worth holding is exactly what
 * this table holds: the panes exist, the width is remembered per screen, and the
 * pane owns the only scrollbar.
 *
 * Adding a screen to `SCREENS` is the whole cost of covering the next port.
 */

const SCREENS = [
  { path: '/tasks', id: 'tasks' },
  { path: '/events', id: 'events' },
  { path: '/contacts', id: 'contacts' },
  { path: '/journal', id: 'journal' },
  { path: '/secrets', id: 'secrets' },
  { path: '/models', id: 'models' },
  { path: '/runs', id: 'runs' },
  { path: '/formulas', id: 'formulas' },
  { path: '/apps', id: 'apps' },
  // Its detail is the table EDITOR — a sticky toolbar above a scrolling grid —
  // so the one-scrollbar row below is the interesting one here. (Put rows in
  // front of it before believing that check: it only counts elements that
  // actually overflow.)
  { path: '/tables', id: 'tables' },
  // Focus mode too, so their collapsed-but-mounted half is in `focus-mode.spec.ts`.
  { path: '/notes', id: 'notes' },
  { path: '/draw', id: 'draw' },
  { path: '/pages', id: 'pages' },
  // Left column is a nav TREE rather than a list of cards — a deliberate
  // exception. The scaffold contract this file holds is the same either way.
  { path: '/docs', id: 'docs' },
  // A layout, like /docs: the twelve debug tabs are the DETAIL, and the list is
  // a card per tab. `/debug` (Overview) is the one tab with no search box, so
  // unlike its siblings it never de-opts to client rendering — which makes the
  // server-render check below meaningful here. The cards themselves are in
  // `debug-nav.spec.ts`.
  { path: '/debug', id: 'debug' },
  // The only two screens whose grid declared a RANGE — `minmax(340px, 400px)`
  // — rather than a fixed width. They keep that floor and where they land, and
  // trade the 400px ceiling for a draggable one; the row below is what proves
  // the divider actually has somewhere to go.
  { path: '/traces', id: 'traces' },
  { path: '/runners', id: 'runners' },
  // NOT here: the thirteen single-panel settings screens (Profile, Appearance,
  // Backups…). They sit in a `MeasuredPane` — this scaffold minus the list —
  // and `settings-pane.spec.ts` holds them. `/settings` itself is a redirect
  // to Profile; the card hub that briefly lived there is undone.
  // The settings cluster, screen by screen as it is ported. Their FORMS are the
  // real work and get their own specs; this row is the scaffold half only.
  { path: '/settings/accounts', id: 'settings-accounts' },
  { path: '/settings/worker-groups', id: 'settings-worker-groups' },
  { path: '/settings/tool-groups', id: 'settings-tool-groups' },
  { path: '/settings/connectors', id: 'settings-connectors' },
  { path: '/settings/skills', id: 'settings-skills' },
  { path: '/settings/keys', id: 'settings-keys' },
  { path: '/settings/peers', id: 'settings-peers' },
  // No API behind it: the list is the browser's own (session-registry.ts).
  { path: '/settings/sessions', id: 'settings-sessions' },
  // `config` is the one screen in this cluster with NO form, so it takes
  // `detailFills` — its detail is a template-vs-live diff, not a measure of
  // form text. Nothing else about the row changes.
  { path: '/settings/config', id: 'settings-config' },
  { path: '/settings/tools', id: 'settings-tools' },
  // The two big ones. Their FORMS are the real work (their own specs below);
  // this row is the scaffold half only.
  { path: '/settings/agents', id: 'settings-agents' },
  { path: '/settings/ai-workers', id: 'settings-ai-workers' },
  { path: '/settings/users', id: 'settings-users' },
  { path: '/settings/heartbeats', id: 'settings-heartbeats' },
  // Folder TREE on the left, same deliberate exception as /docs. Its right pane
  // keeps its own header/toolbar/scroller structure, so the one-scrollbar check
  // below is the interesting one here.
  { path: '/files', id: 'files' },
  // A box with sandboxes off renders an explainer instead of the screen, so this
  // row SKIPS itself there rather than failing. Said out loud, because a
  // silently-skipped row is indistinguishable from a passing one. The copy is
  // "switched off on this box" since Service switches (Settings > Services);
  // older brains still say "not enabled", so both match.
  {
    path: '/sandboxes',
    id: 'sandboxes',
    needsFeature: /Sandboxes are (switched off on this box|not enabled)/,
  },
  // Team admin has no row: Review moved into the workspaces (part 2), and
  // the grids left (Requests, Shared links) show an empty state until they
  // have rows. Invites, Clients and the member chats moved into the
  // Settings > Logins row above.
] as const;

/**
 * The scaffold's OWN divider.
 *
 * `[data-slot="resizable-handle"]` alone is not specific enough: the app shell
 * has one (the nav rail), and a detail pane may bring its own (Team admin's
 * member chats once split a transcript from an access log with a second,
 * HORIZONTAL group), and a plain `.last()` grabs that instead and drags it
 * sideways for no effect. Scope to the innermost group that actually holds the
 * list panel, and take only its DIRECT children.
 */
function scaffoldHandles(page: import('@playwright/test').Page) {
  return page
    .locator('[data-slot="resizable-panel-group"]:has([data-testid="list"])')
    .last()
    .locator(':scope > [data-slot="resizable-handle"]');
}

test.describe('ported master-detail screens', () => {
  test.skip(({ topology }) => topology === 'same-origin', 'owner UI lives on the client app');

  for (const screen of SCREENS) {
    test(`${screen.path} is a real MasterDetail with a persisted width`, async ({ ownerPage }) => {
      // Explicit, not `test.use`: `ownerPage` comes from a hand-built context
      // (the split topology seeds a bearer into it), which does not read the
      // fixture's viewport option. Wide enough that widening the detail has
      // somewhere to come from.
      await ownerPage.setViewportSize({ width: 1600, height: 900 });

      // The scaffold has to survive a SERVER render. `MasterDetail` used to
      // hand `useDefaultLayout` an explicit `storage: undefined`, which trips
      // that hook's `storage = localStorage` default — a global Node does not
      // have — and throws out of its server snapshot, taking the whole route
      // down to client-only rendering. It went unseen for nine screens because
      // every one of them reads `useSearchParams` without a Suspense boundary,
      // which already de-opts the subtree; `/docs` is a layout that genuinely
      // server-renders, and it found this immediately.
      const bailouts: string[] = [];
      ownerPage.on('pageerror', (err) => {
        if (/Switched to client rendering/.test(err.message)) bailouts.push(err.message);
      });

      await ownerPage.goto(screen.path);

      const list = ownerPage.locator('[data-testid="list"]');

      const off = 'needsFeature' in screen ? screen.needsFeature : null;
      if (off) {
        // Wait for the screen to SETTLE before deciding: it renders a spinner
        // first, and checking immediately after `goto` finds neither the panes
        // nor the explainer and falls through to a confusing failure.
        const explainer = ownerPage.getByText(off);
        await expect(list.or(explainer).first()).toBeVisible();
        if ((await explainer.count()) > 0) {
          test.skip(true, `${screen.path} is disabled on this box — nothing to port-check`);
        }
      }
      const detail = ownerPage.locator('[data-testid="detail"]');
      await expect(list, 'no list panel — still a hand-written grid?').toBeVisible();
      await expect(detail).toBeVisible();
      expect(bailouts, 'the server render threw and the route fell back to the client').toEqual([]);

      // Exactly one scrollbar in the detail pane: MasterDetail's own. A pane
      // that keeps its old `h-full overflow-y-auto` nests a second.
      // Only PANE-HEIGHT scrollers count. The failure this guards is a screen
      // that kept its old `h-full overflow-y-auto` and nested a second full
      // pane inside the scaffold's own — two scrollbars down the same edge. A
      // child that deliberately CAPS itself is a bounded region the design
      // asked for: `/models` renders a raw payload in a `max-h-[480px]
      // overflow-auto` <pre>, 478px tall inside a 900px pane, and counting it
      // failed a screen that is doing exactly what it should.
      const scrollers = await detail.evaluate((pane) => {
        const full = (pane as HTMLElement).clientHeight;
        return Array.from(pane.querySelectorAll('*')).filter((el) => {
          const node = el as HTMLElement;
          const s = getComputedStyle(node);
          return (
            (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
            node.scrollHeight > node.clientHeight &&
            node.clientHeight >= full - 8
          );
        }).length;
      });
      expect(scrollers, 'the detail pane should have at most one scrollbar').toBeLessThanOrEqual(1);

      // The layout is saved under this screen's OWN key, so two screens cannot
      // share a width. Written only after a real interaction, hence the drag.
      // Drag the last handle, in whichever direction THIS screen has room.
      // Neither is universally available, and assuming one is how this read as
      // a scaffold failure twice: rightwards needs the SPACER to have width to
      // give up, and `/notes` opens its detail at 900px and leaves it SIX
      // pixels; leftwards needs the DETAIL to sit above its own minimum, and
      // `/files` does not. A screen that cannot move its divider EITHER way is
      // the real failure this line is for.
      const before = (await detail.boundingBox())!;
      const handle = scaffoldHandles(ownerPage).last();
      const nudge = async (dx: number) => {
        const grip = (await handle.boundingBox())!;
        const y = grip.y + grip.height / 2;
        await ownerPage.mouse.move(grip.x + grip.width / 2, y);
        await ownerPage.mouse.down();
        await ownerPage.mouse.move(grip.x + grip.width / 2 + dx, y, { steps: 8 });
        await ownerPage.mouse.up();
        return (await detail.boundingBox())!;
      };
      let moved = await nudge(-100);
      if (Math.abs(moved.width - before.width) <= 20) moved = await nudge(100);
      expect(Math.abs(moved.width - before.width), 'the divider did not move').toBeGreaterThan(20);

      const key = await ownerPage.evaluate(
        (id) =>
          Object.keys(window.localStorage).find(
            (k) => k.includes('master-detail') && k.includes(id),
          ) ?? null,
        screen.id,
      );
      expect(key, `no saved layout under a key naming "${screen.id}"`).toBeTruthy();

      await ownerPage.reload();
      await expect
        .poll(async () => Math.abs((await detail.boundingBox())!.width - moved.width))
        .toBeLessThan(3);
    });
  }

  test('every screen keeps its own width, not a shared one', async ({ ownerPage }) => {
    // The persistence key is per-screen on purpose: a Kanban board wants far
    // more room than a 340px contact list, so one shared width would be wrong
    // on both. Two screens dragged differently must stay different.
    await ownerPage.setViewportSize({ width: 1600, height: 900 });
    await ownerPage.goto('/contacts');
    const detail = ownerPage.locator('[data-testid="detail"]');
    await expect(detail).toBeVisible();
    const contactsWidth = (await detail.boundingBox())!.width;

    const handle = scaffoldHandles(ownerPage).last();
    const grip = (await handle.boundingBox())!;
    await ownerPage.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await ownerPage.mouse.down();
    await ownerPage.mouse.move(grip.x + grip.width / 2 + 140, grip.y + grip.height / 2, {
      steps: 8,
    });
    await ownerPage.mouse.up();
    const widened = (await detail.boundingBox())!.width;
    expect(widened).toBeGreaterThan(contactsWidth + 60);

    await ownerPage.goto('/models');
    await expect(detail).toBeVisible();
    expect(
      Math.abs((await detail.boundingBox())!.width - widened),
      'models inherited the width dragged on contacts — shared key?',
    ).toBeGreaterThan(3);
    await ownerPage.screenshot({ path: `${ARTIFACTS_DIR}master-detail-per-screen.png` });
  });

  test('a screen that did not opt into collapsing cannot be dragged to zero', async ({
    ownerPage,
  }) => {
    // `MasterDetail`'s list panel is `collapsible` ONLY for screens that pass
    // `listCollapsed` (the item screens, for focus mode). Setting it for
    // everyone would be a one-word change with a real cost: `collapsible` also
    // means "collapse when dragged below minSize", so every list could be
    // dragged out of existence. /models never opts in, so its drag must stop
    // at the minimum instead.
    await ownerPage.setViewportSize({ width: 1600, height: 900 });
    await ownerPage.goto('/models');
    const list = ownerPage.locator('[data-testid="list"]');
    await expect(list).toBeVisible();

    const handle = scaffoldHandles(ownerPage).first();
    const grip = (await handle.boundingBox())!;
    await ownerPage.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await ownerPage.mouse.down();
    // Far past the 260px minimum, and past the left edge of the window.
    await ownerPage.mouse.move(0, grip.y + grip.height / 2, { steps: 12 });
    await ownerPage.mouse.up();

    const width = await list.evaluate((el) => (el as HTMLElement).offsetWidth);
    expect(
      width,
      'the list collapsed on a screen that never asked to be collapsible',
    ).toBeGreaterThan(100);
  });
});
