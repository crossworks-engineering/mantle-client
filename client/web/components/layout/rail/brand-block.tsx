'use client';

import Link from 'next/link';
import { cn } from '@mantle/web-ui/lib/utils';
import { AreaBackdrop } from '@mantle/web-ui/area-backdrop';
import { BrandLogo } from './brand-logo';
import { FALLBACK_NAME } from '@/lib/brand';
import { MantleBadge, MantleLogo } from './mantle-mark';

/**
 * Identity block at the head of the rail: the wordmark (or the uploaded brand
 * logo), with this brain's peer name set to its right.
 *
 * THE PEER NAME FLOATS RIGHT AND WRAPS AS A UNIT. It shares the logo's row when
 * the column is wide enough and drops to a row of its own when it is not,
 * staying flush right either way. That is a wrapping flex line plus `ml-auto`
 * on the name, and it needs both halves: `flex-wrap` decides the row, and the
 * auto left margin is what pushes the name right — including on the wrapped
 * row, where it is the only item and `justify-content` would otherwise leave it
 * hard left. The name keeps `whitespace-nowrap` so it wraps whole rather than
 * breaking mid-name.
 *
 * Its clipping margin is deliberately one-sided (`-mr-2 px-2`, not the
 * `-mx-2 px-2` the wordmark uses). `-mx-2` sets `margin-left` too, colliding
 * with `ml-auto` on the same property, and which one won would come down to
 * utility order in the generated sheet rather than intent. Pulling only the
 * right edge flush leaves `margin-left` free for the auto push, and the left
 * padding costs nothing on an element that margin has already positioned.
 *
 * This is the heir to the old fixed header, which is why it — and not only the
 * mobile bar — carries the `header` area backdrop. The Appearance setting keeps
 * decorating the same thing it always decorated, now that the thing has moved
 * into the rail; see @mantle/web-ui/backgrounds.
 *
 * BOTH LINES CLIP ON THE WIDTH ONLY (`overflow-x-clip` bounded by the column,
 * `overflow-y-visible`, with `-mx-2`/`px-2` giving the sides room). The
 * selectable faces are display faces whose swashes and descenders leave the em
 * box, and a plain `truncate` clips both axes — it shaves the ink off the top
 * and bottom of the letterforms rather than ending the line. Carried over from
 * the header verbatim; it was learned the hard way.
 *
 * Face AND size come from the `.wordmark` / `.peer-name` classes (Settings →
 * Appearance → Fonts), never from a local `text-*` step: each class pairs its
 * font var with its own size multiplier so the two halves of one choice cannot
 * be applied separately. Overriding the size here would silently defeat the
 * owner's size setting for these two lines only.
 *
 * Collapsed rail: the logo shrinks to a square, and a brain with no uploaded
 * logo gets a mark built from the first character of its name — in the same
 * wordmark face, so the icon rail still carries the brand. A 3.5rem column has
 * no room for a wordmark, and shrinking one until it fits reads as a bug.
 */
export function BrandBlock({
  siteName,
  peerName,
  logoVersion,
  logoDarkVersion,
  href = '/',
  inDrawer = false,
  onNavigate,
  switcher,
}: {
  /** Custom wordmark from prefs; null ⇒ the "mantle" default. */
  siteName?: string | null;
  /** This brain's peer name, the second line; null ⇒ the line is not rendered. */
  peerName?: string | null;
  /** Brand logo version; set ⇒ an image replaces the wordmark TEXT. */
  logoVersion?: string | null;
  /** Optional dark-mode variant, shown while `.dark` is active; falls back to
   *  the base logo, then to the wordmark. */
  logoDarkVersion?: string | null;
  /** Where the brand links; `/`, the home, by default. (The retired /team
   *  member workspace pointed it at `/team`.) */
  href?: string;
  /** Rendered inside the mobile Sheet, which floats its own close button over
   *  the top-right corner. The identity lines reserve room for it there; in the
   *  aside there is nothing to dodge and the full column width is usable. */
  inDrawer?: boolean;
  onNavigate?: () => void;
  /** The workspace switcher (plan 7.1), under the identity line: where you
   *  are, beside who this brain is. */
  switcher?: React.ReactNode;
}) {
  // A brain that has never been named wears the BRAND rather than the brand's
  // name set in type: the wordmark expanded, the icon collapsed. The moment
  // an owner sets a site name it is theirs, and the text wordmark returns.
  const named = Boolean(siteName?.trim());
  const name = siteName?.trim() || FALLBACK_NAME;
  // Array.from, not charAt: a name starting with an emoji or any astral-plane
  // character would otherwise be cut mid-surrogate-pair and render as a tofu.
  const mark = Array.from(name)[0] ?? 'M';

  return (
    <div
      data-tour="brand"
      className={cn(
        // `isolate` is what makes the backdrop's `-z-10` mean what it says.
        // The old header owned a stacking context by being `fixed z-40`; this
        // block is a plain `relative` child of the aside, and without its own
        // context the negative-z artwork would escape to the ASIDE's context —
        // under this block's gradient and under the menu backdrop.
        'relative isolate shrink-0 border-b border-sidebar-border bg-gradient-to-b from-primary/[0.07] to-transparent px-3 py-3 group-data-[nav-collapsed=true]/shell:px-2',
        inDrawer && 'pr-12',
      )}
    >
      {/* `-z-10` paints the generated artwork above this block's own gradient
          but below its text. Renders nothing when the area is switched off. */}
      <AreaBackdrop area="header" className="-z-10" />

      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 group-data-[nav-collapsed=true]/shell:justify-center">
        <Link
          href={href}
          onClick={onNavigate}
          aria-label={`${name} home`}
          title={name}
          // `grow`, NOT `flex-1`. Both would let the logo fill its row, but
          // `flex-1` sets `flex-basis: 0`, and flex uses the BASE size to decide
          // where a line breaks — a zero-basis logo always leaves room for the
          // peer name, so the two would never wrap apart. `grow` keeps the
          // content-sized basis (so wrapping still triggers) and only fills the
          // slack afterwards. Without it the logo sizes to fit-content and the
          // wordmark loses ~16px it used to have, clipping the last glyph.
          className="flex min-w-0 grow items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[nav-collapsed=true]/shell:justify-center"
        >
          <BrandLogo
            name={name}
            logoVersion={logoVersion}
            logoDarkVersion={logoDarkVersion}
            imgClassName="h-9 w-auto max-w-full object-contain object-left group-data-[nav-collapsed=true]/shell:size-8 group-data-[nav-collapsed=true]/shell:object-center"
            renderWordmark={(visibility) =>
              named ? (
                <Wordmark name={name} mark={mark} className={visibility} />
              ) : (
                <ProductMark className={visibility} />
              )
            }
          />
        </Link>

        {peerName && (
          <p
            // Set beside the wordmark, flush right, in the user-selectable
            // page-title face (Settings → Appearance → Fonts; unset ⇒ inherits
            // the UI sans). Same width-only clipping as the wordmark, asymmetric
            // so it cannot fight `ml-auto` — see the block comment above.
            className="peer-name -mr-2 ml-auto max-w-full overflow-x-clip overflow-y-visible whitespace-nowrap px-2 font-semibold leading-snug tracking-tight text-muted-foreground group-data-[nav-collapsed=true]/shell:hidden"
            title={peerName}
          >
            {peerName}
          </p>
        )}
      </div>
      {switcher ? <div className="mt-2">{switcher}</div> : null}
    </div>
  );
}

/**
 * The MantleOS brand art, standing in for the text wordmark on a brain with no
 * site name of its own. Mirrors `Wordmark`'s structure exactly: BOTH the
 * expanded and collapsed forms render, and the shell's collapse state picks
 * one, so no width measurement or JS is involved in the swap.
 *
 * Expanded gets the wordmark (one line, which is what fits a rail); collapsed
 * gets the icon alone, because a 3.5rem column has no room for a wordmark and
 * shrinking one until it fits reads as a bug.
 */
function ProductMark({ className }: { className?: string }) {
  return (
    // Both forms render and the shell's collapse state picks one, exactly as
    // `Wordmark` does below — no width measurement, no JS. The outer `contents`
    // carries the caller's visibility class once, above both swaps.
    <span className={cn('contents', className)}>
      <MantleLogo
        className="h-9 max-w-full"
        visibility="group-data-[nav-collapsed=true]/shell:hidden"
      />
      <MantleBadge
        className="size-8 shrink-0"
        visibility="hidden group-data-[nav-collapsed=true]/shell:contents"
      />
    </span>
  );
}

/**
 * The text wordmark, in the user-selectable wordmark face, plus the
 * single-character mark that stands in for it in the collapsed rail. Both are
 * rendered; the shell's collapse state picks one, so no width measurement or JS
 * is involved in the swap.
 */
function Wordmark({ name, mark, className }: { name: string; mark: string; className?: string }) {
  return (
    <>
      <span
        className={cn(
          'wordmark -mx-2 max-w-full overflow-x-clip overflow-y-visible whitespace-nowrap px-2 py-1 leading-none text-primary-ink group-data-[nav-collapsed=true]/shell:hidden',
          className,
        )}
      >
        {name}
      </span>
      <span
        aria-hidden
        className={cn(
          'wordmark hidden size-9 shrink-0 select-none items-center justify-center rounded-lg bg-primary leading-none text-primary-foreground group-data-[nav-collapsed=true]/shell:flex',
          className,
        )}
      >
        {mark}
      </span>
    </>
  );
}
