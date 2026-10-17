import { MantleLogo } from '@/components/layout/rail/mantle-mark';

/**
 * The small product marks at the foot of the sign-in screen: what this brain
 * is built on. The hero says whose brain this is; the credit says what runs
 * it. Both are true and they want different weights.
 *
 * ── One mark, never two ─────────────────────────────────────────────────────
 * The footer carries exactly ONE product mark. Two stacked marks under a card
 * read as clutter, not as a credit.
 *
 * - A brain that wears its OWN branding up top (`showJackdaw`, the
 *   `kind !== 'jackdaw'` test in `page.tsx`, for example a typed site name)
 *   credits Jackdaw here: the owner's name holds the hero, and the footer says
 *   which app this is.
 * - An UNBRANDED brain (a fresh install, no site name) already shows the
 *   Jackdaw lockup as its hero, so the footer credits Mantle instead: the app
 *   up top, the brain it runs on down here.
 *
 * Named `LoginCredit` rather than `JackdawCredit` to match the folder — every
 * component here is `Login*` in a `login-*.tsx`, and the Jackdaw-specific piece
 * stays an internal detail, exactly as `login-mark.tsx` keeps `JackdawLockup`
 * private to itself.
 *
 * One acknowledged edge: a brain with ONLY a dark logo uploaded and no site
 * name falls back to the lockup in LIGHT mode (that fallback is `BrandLogo`'s
 * and is correct), so that one theme of that one configuration shows the mark
 * twice. It cannot be resolved here — the light/dark swap is pure CSS with no
 * render-time answer — and the fix is for that owner to upload a light variant
 * or name the brain, which the screen is asking for anyway.
 *
 * ── The ROW lockup, not the stacked one ────────────────────────────────────
 * The house rule is that the stacked lockup is the hero and "everywhere in-app
 * wears the row lockup or the wordmark alone, so the bird stays an event rather
 * than chrome". A footer credit is chrome, so it takes the row (bird beside
 * wordmark, 338×96), which is also the shape that reads well in a footer. Two
 * imgs swapped by the `dark:` variant, a CSS swap, so flipping the theme never
 * waits on a fetch.
 *
 * `h-12` puts it at 48px tall, about a quarter of the hero. The source PNGs are
 * 96px tall, so 48px is exactly 2x and stays sharp on retina. The intrinsic
 * `width`/`height` are declared so the footer reserves its box and the form
 * above never shifts when the image decodes.
 *
 * The mantleOS wordmark is cut tight to its artwork while the Jackdaw PNG carries
 * some air, so Mantle runs one step shorter (`h-10` against `h-12`) to read at
 * the same weight. On a phone each steps down a size, so the mark stays a
 * footnote under the card rather than a second hero.
 */
export function LoginCredit({ showJackdaw }: { showJackdaw: boolean }) {
  return (
    // Softened so it stays a credit at this size: the marks are big enough to
    // read comfortably, and opacity is what keeps them from competing with the
    // owner's hero. Fixed opacity, no hover change: there is nothing to click
    // here, and a mark that reacts to the pointer claims to be a control.
    <footer className="flex flex-col items-center justify-center gap-3 pt-8 opacity-50">
      {showJackdaw ? (
        <span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/jackdaw-row-light.png"
            alt="Jackdaw"
            width={344}
            height={96}
            className="h-9 w-auto sm:h-12 dark:hidden"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/jackdaw-row-dark.png"
            alt="Jackdaw"
            width={338}
            height={96}
            className="hidden h-9 w-auto sm:h-12 dark:block"
          />
        </span>
      ) : (
        <MantleLogo className="h-8 sm:h-10" />
      )}
    </footer>
  );
}
