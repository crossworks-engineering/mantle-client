import { expect, test } from '../lib/fixtures';
import { ARTIFACTS_DIR } from '../lib/env';

/**
 * Guards for the resizable shell, driven on `/tasks` because that screen uses
 * every mechanism at once.
 *
 * Two things are pinned here, and they are guards rather than behaviour:
 *
 *  1. WIDTHS PERSIST, through two different mechanisms that are easy to confuse
 *     for one another. The master-detail divider saves to `localStorage` (via
 *     `useDefaultLayout`, keyed per screen); the rails save to a COOKIE, because
 *     the server renders them and localStorage would make the rail jump on load.
 *
 *  2. NOTHING TRANSITIONS A PROPERTY IT READS FROM A SHELL WIDTH VARIABLE.
 *     An element that transitions the very property it reads from a custom
 *     property stops tracking that property: Chrome keeps the old computed value
 *     and the element sits frozen while the variable moves under it. Seven shell
 *     elements did exactly this and froze the moment the widths became
 *     draggable. The fix animates the VARIABLE (`.mantle-shell`, globals.css)
 *     and leaves the consumers alone — so the invariant to hold is a negative
 *     one, and a new screen offsetting against `--nav-w` can break it from a
 *     file nobody touching the shell will open.
 */

/** Where the shell publishes its chrome widths. Read from a length-valued
 *  property (`width`, `left`, `right`, `inset`…) by every framed region. */
const WIDTH_VARS = ['--nav-w', '--activity-w', '--assistant-w', '--help-w'];

test.describe('shell layout', () => {
  test.skip(({ topology }) => topology === 'same-origin', 'owner UI lives on the client app');

  test.use({ viewport: { width: 1600, height: 900 } });

  test('a dragged detail width survives a reload (localStorage, per screen)', async ({
    ownerPage,
  }) => {
    await ownerPage.goto('/tasks');
    const detail = ownerPage.locator('[data-testid="detail"]');
    await expect(detail).toBeVisible();
    const before = (await detail.boundingBox())!;

    // The SECOND divider is the detail pane's outer edge (the third panel is an
    // empty spacer that exists only to give it something to drag against), so
    // dragging it right widens the detail without touching the list.
    const handles = ownerPage.locator('[data-slot="resizable-handle"]');
    await expect(handles).toHaveCount(2);
    const grip = (await handles.nth(1).boundingBox())!;
    await ownerPage.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await ownerPage.mouse.down();
    await ownerPage.mouse.move(grip.x + grip.width / 2 + 120, grip.y + grip.height / 2, {
      steps: 10,
    });
    await ownerPage.mouse.up();

    const dragged = (await detail.boundingBox())!;
    expect(dragged.width, 'the drag did not resize the detail pane').toBeGreaterThan(
      before.width + 60,
    );

    await ownerPage.reload();
    await expect(detail).toBeVisible();
    // Within a pixel or two: the saved layout is fractional, the pane is not.
    await expect
      .poll(async () => Math.abs((await detail.boundingBox())!.width - dragged.width), {
        message: 'the detail width was not restored after a reload',
      })
      .toBeLessThan(3);

    // Keyed per screen: the board is a different layout (`tasks-board`) and must
    // NOT inherit the width just set on the list.
    await ownerPage.goto('/tasks?view=board');
    const boardDetail = ownerPage.locator('[data-testid="detail"]');
    if (await boardDetail.isVisible()) {
      expect(Math.abs((await boardDetail.boundingBox())!.width - dragged.width)).toBeGreaterThan(3);
    }
  });

  test('a resized nav rail survives a reload (cookie, server-rendered)', async ({ ownerPage }) => {
    await ownerPage.goto('/tasks');
    const shell = ownerPage.locator('.mantle-shell');
    const navWidth = () =>
      shell.evaluate((el) => getComputedStyle(el).getPropertyValue('--nav-w').trim());
    expect(await navWidth()).toBe('256px');

    // Let `/tasks` finish loading BEFORE reaching for the handle. Its paged
    // list used to open an autofocusing composer a beat after the screen
    // looked ready, which moved focus mid-sequence and put arrow presses two,
    // three and four into a text field (the widths it reported, 280px and
    // 272px, were three presses landing, then two). The item tree that replaced
    // the list opens nothing by itself, so no composer takes focus now; what is
    // left to wait for is the tree itself.
    await expect(ownerPage.getByRole('tree', { name: 'Tasks and folders' })).toBeVisible();

    // Keyboard, not a drag: the handle is arrow-operable on purpose (a
    // drag-only control is unusable without a mouse), and it writes the same
    // pref either way. Four nudges of 8px = 288px.
    const handle = ownerPage.getByRole('separator', { name: 'Resize navigation' });
    await handle.focus();
    for (let i = 0; i < 4; i++) await ownerPage.keyboard.press('ArrowRight');
    await expect.poll(navWidth).toBe('288px');

    // The rail itself follows the variable, and so does <main>'s left edge —
    // that lockstep is the whole point of publishing a variable.
    const rail = ownerPage.locator('aside.fixed.inset-y-0.left-0');
    expect(Math.round((await rail.boundingBox())!.width)).toBe(288);
    expect(Math.round((await ownerPage.locator('main').boundingBox())!.x)).toBe(288);

    // Kept in ui-prefs, so the value comes back with the first paint.
    const kept = await ownerPage.evaluate(() => localStorage.getItem('mantle_pref:mantle_nav_w'));
    expect(JSON.parse(kept ?? '{}').v).toBe('288');
    await ownerPage.reload();
    await expect.poll(navWidth).toBe('288px');
    await ownerPage.screenshot({ path: `${ARTIFACTS_DIR}shell-nav-resized.png` });

    // Leave the rail as found — the browser context is per-test, but the
    // pref is written on the client origin and a stray 288 would make the
    // "starts at 256px" assertion above order-dependent if that ever changes.
    await handle.focus();
    for (let i = 0; i < 4; i++) await ownerPage.keyboard.press('ArrowLeft');
    await expect.poll(navWidth).toBe('256px');
  });

  test('no element transitions a property it reads from a shell width variable', async ({
    ownerPage,
  }) => {
    // Repo-wide in effect, not per-screen: the scan walks every CSS rule the
    // page loaded (Tailwind emits one stylesheet for the whole app), pairs the
    // rules that size something FROM one of these variables with the rules that
    // declare a transition, and reports any element matching both.
    //
    // AUTHORED css, not `getComputedStyle`. Playwright injects
    // `*, ::before, ::after { transition: none !important }` into the page, so
    // every computed `transition-property` reads `none` under test and a
    // computed-style version of this guard passes no matter what the app does —
    // it was written that way first, and it was silently vacuous.
    await ownerPage.goto('/tasks');
    await expect(ownerPage.locator('.mantle-shell')).toBeVisible();

    const report = await ownerPage.evaluate((vars: string[]) => {
      const styleRules: CSSStyleRule[] = [];
      const walk = (list: CSSRuleList) => {
        for (const rule of Array.from(list)) {
          if (rule instanceof CSSStyleRule) styleRules.push(rule);
          // Grouping rules — @media, @supports, @layer — hold the rest.
          const nested = (rule as CSSGroupingRule).cssRules;
          if (nested) walk(nested);
        }
      };
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          walk(sheet.cssRules);
        } catch {
          // A cross-origin sheet cannot be read; the app ships its own.
        }
      }

      const matches = (el: Element, selector: string) => {
        try {
          return el.matches(selector);
        } catch {
          return false; // a selector this browser cannot parse matches nothing
        }
      };

      /** Rules that ENABLE a transition. A universal selector is skipped and so
       *  is `transition: none` — neither can start one, and the universal reset
       *  is the test harness's, not the app's. */
      const enablers = styleRules
        .map((rule) => ({
          selector: rule.selectorText,
          props: (rule.style.getPropertyValue('transition-property') || '')
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s && s !== 'none'),
        }))
        .filter((r) => r.props.length > 0 && !r.selector.includes('*'));

      const bad: string[] = [];
      const seen = new Set<string>();
      for (const rule of styleRules) {
        // Which properties this rule derives from one of the variables.
        const derived = Array.from(rule.style).filter((prop) => {
          const value = rule.style.getPropertyValue(prop);
          return vars.some((name) => value.includes(`var(${name}`));
        });
        if (derived.length === 0) continue;

        let readers: Element[];
        try {
          readers = Array.from(document.querySelectorAll(rule.selectorText));
        } catch {
          continue;
        }
        for (const el of readers) {
          for (const enabler of enablers) {
            if (!matches(el, enabler.selector)) continue;
            for (const prop of derived) {
              if (!enabler.props.includes(prop) && !enabler.props.includes('all')) continue;
              const key = `${rule.selectorText}|${prop}|${enabler.selector}`;
              if (seen.has(key)) continue;
              seen.add(key);
              bad.push(
                `<${el.tagName.toLowerCase()}> takes ${prop} from a shell width var ` +
                  `(${rule.selectorText}) and transitions it (${enabler.selector})`,
              );
            }
          }
        }
      }

      // The positive half, from the same authored css: the shell IS what
      // transitions the variables.
      const shell = document.querySelector('.mantle-shell')!;
      const shellTransitions = styleRules
        .filter((r) => matches(shell, r.selectorText))
        .flatMap((r) =>
          (r.style.getPropertyValue('transition-property') || '').split(',').map((s) => s.trim()),
        );
      // And they are REGISTERED lengths — an `@property` whose `initial-value`
      // is in rem is invalid and dropped silently, which leaves the var
      // unregistered and the transition above a no-op. A registered `<length>`
      // computes to px; an unregistered one keeps whatever token was written.
      const computedVars = vars.map((name) =>
        getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
      );
      return { bad, shellTransitions, computedVars };
    }, WIDTH_VARS);

    expect(
      report.bad,
      'animate the VARIABLE on .mantle-shell, never the consumers — see globals.css',
    ).toEqual([]);
    for (const name of WIDTH_VARS) expect(report.shellTransitions).toContain(name);
    for (const value of report.computedVars) expect(value).toMatch(/^-?[\d.]+px$/);
  });

  test('both shell rails show a drag grip at rest, the same one every divider shows', async ({
    ownerPage,
  }) => {
    // Style guide §8: "every draggable edge shows a grip, at rest, without
    // hovering it". `RailHandle` used to render `after:bg-transparent` and
    // nothing else, so the nav and activity rails — the two edges a user meets
    // on EVERY screen — read as fixed furniture until the pointer happened to
    // cross an 8px strip.
    //
    // Deliberately NOT a class-name assertion: the bug was a missing element
    // and the regression would be a hover-gated one, neither of which a class
    // check distinguishes. So this measures the painted box with the pointer
    // parked far away, and reads the properties that would hide it.
    await ownerPage.goto('/tasks');
    await expect(ownerPage.locator('.mantle-shell')).toBeVisible();
    // The activity column starts COLLAPSED (its cookie defaults that way), and
    // a collapsed rail correctly has no handle — so expand it before asking
    // whether the expanded rail advertises one.
    await ownerPage.getByRole('button', { name: 'Expand activity' }).click();
    await expect(ownerPage.getByRole('button', { name: 'Collapse activity' })).toBeVisible();
    // …and let it FINISH expanding. `--activity-w` animates on `.mantle-shell`,
    // so the rail's edge is still travelling for a few frames after the button
    // flips; measuring the grip against a moving edge is a real flake.
    await expect
      .poll(async () =>
        ownerPage
          .locator('.mantle-shell')
          .evaluate((el) => getComputedStyle(el).getPropertyValue('--activity-w').trim()),
      )
      .toBe('320px'); // ACTIVITY_W_DEFAULT, as the nav test hardcodes 256px

    // Park the pointer in the middle of the content, AFTER that click: a click
    // leaves the mouse where it landed, and "at rest" would otherwise be a lie.
    await ownerPage.mouse.move(800, 450);

    // The reference affordance: the chip `ResizableHandle withHandle` draws on
    // the master-detail divider. Comparing against it — rather than against
    // hardcoded 12×16 — is what holds "one affordance means one thing": restyle
    // one and this fails until the other follows.
    const reference = ownerPage.locator('[data-slot="resizable-handle"] > div').first();
    await expect(reference).toBeVisible();
    const referenceBox = (await reference.boundingBox())!;

    for (const [name, railSelector] of [
      ['Resize navigation', 'aside.fixed.inset-y-0.left-0'],
      ['Resize activity column', 'aside.fixed.inset-y-0.right-0'],
    ] as const) {
      const handle = ownerPage.getByRole('separator', { name });
      await expect(handle, `${name}: no handle on the expanded rail`).toBeVisible();

      const grip = handle.locator('[data-slot="rail-handle-grip"]');
      await expect(grip, `${name}: the rail has no grip element at all`).toHaveCount(1);

      const box = (await grip.boundingBox())!;
      expect(box.width, `${name}: grip is a different size to the divider's`).toBeCloseTo(
        referenceBox.width,
        1,
      );
      expect(box.height, `${name}: grip is a different size to the divider's`).toBeCloseTo(
        referenceBox.height,
        1,
      );

      // Painted, not merely present. A grip revealed by `group-hover:opacity-100`
      // or `after:`-style transparency would satisfy every assertion above and
      // still be exactly the hidden affordance this test exists to forbid.
      const paint = await grip.evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          opacity: Number(s.opacity),
          visibility: s.visibility,
          display: s.display,
          background: s.backgroundColor,
        };
      });
      expect(paint.opacity, `${name}: the grip is transparent until hovered`).toBe(1);
      expect(paint.visibility).toBe('visible');
      expect(paint.display).not.toBe('none');
      expect(paint.background, `${name}: the grip has no fill at rest`).not.toMatch(
        /rgba\(.*,\s*0\)$/,
      );

      // It straddles the rail's edge, the way the divider's chip straddles the
      // divider — on it, not floating in the middle of the rail's content.
      const rail = (await ownerPage.locator(railSelector).boundingBox())!;
      const edge = name === 'Resize navigation' ? rail.x + rail.width : rail.x;
      expect(
        Math.abs(box.x + box.width / 2 - edge),
        `${name}: the grip is not sitting on the rail's draggable edge`,
      ).toBeLessThan(2);
    }

    await ownerPage.screenshot({ path: `${ARTIFACTS_DIR}shell-rail-grips.png` });

    // The other half of §8's rule, which the grip must not quietly undo: a
    // COLLAPSED rail has no handle, because the toggle owns that width.
    // ⌘B rather than the toolbar button: the button sits in the bottom-left
    // corner, which is exactly where `next dev` parks its overlay portal, and
    // that portal swallows the click in this environment only.
    // Take focus OUT of the composer first. `/tasks` autofocuses its new-task
    // title field, and the shortcut handler deliberately stands down while
    // focus is in an input — so ⌘B still bolds in the page editor and the shell
    // does not steal keystrokes from a form. That is correct behaviour, and it
    // meant this press did nothing at all: the rail stayed expanded, its
    // separator stayed on screen, and the assertion below read as a missing
    // feature rather than as a test typing into a text box.
    await ownerPage.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await ownerPage.keyboard.press('ControlOrMeta+b');
    await expect(ownerPage.getByRole('separator', { name: 'Resize navigation' })).toHaveCount(0);
  });
});
