import { MantleLogo } from '@/components/layout/rail/mantle-mark';

/**
 * The small product mark at the foot of the sign-in screen: what this brain is
 * built on. The hero says whose brain this is; the credit says what runs it.
 * Both are true and they want different weights.
 *
 * ── Only under the owner's branding ────────────────────────────────────────
 * Since the one-brand MantleOS rename (2026-10-17) there is a single product
 * mark, so the footer shows it only when the hero is NOT already that mark:
 *
 * - A brain that wears its OWN branding up top (`show`, the
 *   `kind !== 'product'` test in `page.tsx`, for example a typed site name)
 *   credits MantleOS here: the owner's name holds the hero, and the footer says
 *   which product this is.
 * - An UNBRANDED brain already shows the MantleOS wordmark as its hero, so the
 *   footer stays empty rather than repeating it. (Before the rename the footer
 *   credited Mantle under a Jackdaw hero: two brands, one each.)
 *
 * One acknowledged edge: a brain with ONLY a dark logo uploaded and no site
 * name falls back to the wordmark in LIGHT mode (that fallback is `BrandLogo`'s
 * and is correct), so that one theme of that one configuration shows the mark
 * twice. It cannot be resolved here — the light/dark swap is pure CSS with no
 * render-time answer — and the fix is for that owner to upload a light variant
 * or name the brain, which the screen is asking for anyway.
 *
 * `h-8`/`sm:h-10` puts it at about a fifth of the hero's slot. The intrinsic
 * `width`/`height` on the img are declared so the footer reserves its box and
 * the form above never shifts when the image decodes.
 */
export function LoginCredit({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    // Softened so it stays a credit at this size: the mark is big enough to
    // read comfortably, and opacity is what keeps it from competing with the
    // owner's hero. Fixed opacity, no hover change: there is nothing to click
    // here, and a mark that reacts to the pointer claims to be a control.
    <footer className="flex flex-col items-center justify-center gap-3 pt-8 opacity-50">
      <MantleLogo className="h-8 sm:h-10" />
    </footer>
  );
}
