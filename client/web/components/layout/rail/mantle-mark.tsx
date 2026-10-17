import { cn } from '@mantle/web-ui/lib/utils';

/**
 * The MantleOS brand art. Since 2026-10-17 there is ONE brand: the old
 * Jackdaw marks (the bird badge, its row and stacked lockups) are gone, and
 * these two stand everywhere a product mark shows: the sign-in hero and
 * credit, the rail's brand block and version footer, the mobile bar, the
 * dashboard's Build card.
 *
 * The files come from the mantle repo's `brand/`, the source of truth:
 * `mantleos-icon.svg` is `mantle-sun-icon.svg`, and `mantleos-logo.svg` is
 * `mantle-logo-os.svg` (text as curves, so no font is needed). When the mark
 * changes there, copy them into `public/brand/` again. The stacked logo
 * (`mantle-logo-os-sun-icon.svg`) is not copied: it is for rare big square
 * placements and does not work small.
 *
 * ONE file per mark, not a light/dark pair like the old Jackdaw art: the
 * MantleOS art is drawn in its own warm colours, with no ink that has to flip
 * for the theme, so the same SVG reads on both grounds.
 *
 * WHY `visibility` RIDES A `contents` WRAPPER. Callers hide the whole mark
 * (the rail collapses; `BrandLogo` passes `dark:hidden` when the mark only
 * stands in for a missing LIGHT logo). `contents` keeps the wrapper out of
 * layout, so the img stays a direct flex child of the caller, while
 * `display:none` on it still takes the img with it.
 */

/** The sun icon alone, square. For columns too narrow for the wordmark (a
 *  3.5rem rail) and for small labels. Decorative: it always sits beside a text
 *  label or an `aria-label`ed link. */
export function MantleBadge({
  className,
  visibility,
}: {
  className?: string;
  /** Applied to a `contents` wrapper, above the img. */
  visibility?: string;
}) {
  return (
    <span className={cn('contents', visibility)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/mantleos-icon.svg"
        alt=""
        aria-hidden
        width={32}
        height={32}
        className={cn('object-contain', className)}
      />
    </span>
  );
}

/** The MantleOS wordmark, one line. Supply the height (e.g. `h-9`). */
export function MantleLogo({
  className,
  visibility,
}: {
  className?: string;
  /** Applied to a `contents` wrapper, above the img. */
  visibility?: string;
}) {
  return (
    <span className={cn('contents', visibility)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/mantleos-logo.svg"
        alt="MantleOS"
        width={166}
        height={40}
        className={cn('w-auto object-contain', className)}
      />
    </span>
  );
}
