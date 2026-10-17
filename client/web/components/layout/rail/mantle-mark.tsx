import { cn } from '@mantle/web-ui/lib/utils';

/**
 * The mantleOS brand art: the brain this interface talks to. Jackdaw's own marks
 * live in `jackdaw-mark.tsx`; these sit beside them wherever both halves of an
 * install are named (the dashboard's Build card, the rail's version footer,
 * the sign-in credit).
 *
 * The files come from the mantle repo's `brand/`, the source of truth:
 * `mantleos-icon.svg` is `mantle-sun-icon.svg`, and `mantleos-logo.svg` is
 * `mantle-logo-os.svg` with its live "OS" text outlined to paths (the export
 * sets it in Impact, which a browser without that font would substitute).
 * When the mark changes there, copy them into `public/brand/` again.
 *
 * ONE file per mark, not a light/dark pair like Jackdaw's: the mantleOS art is
 * drawn in its own warm colours, with no ink that has to flip for the theme,
 * so the same SVG reads on both grounds.
 */

/** The sun icon alone, square. Decorative: always sits beside a text label. */
export function MantleBadge({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/mantleos-icon.svg"
      alt=""
      aria-hidden
      width={32}
      height={32}
      className={cn('object-contain', className)}
    />
  );
}

/** The mantleOS wordmark, one line. Supply the height (e.g. `h-10`). */
export function MantleLogo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/mantleos-logo.svg"
      alt="mantleOS"
      width={166}
      height={40}
      className={cn('w-auto object-contain', className)}
    />
  );
}
