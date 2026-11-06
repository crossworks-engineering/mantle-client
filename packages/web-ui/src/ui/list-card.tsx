import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../lib/utils';

/**
 * List card — THE selectable list item for master-detail listing screens
 * (style guide §8). One source of truth for the card chrome; screens compose
 * their own anatomy inside (icon, title row, snippet, tags).
 *
 * Selection uses the RadioGroupCard checked idiom (the Appearance galleries):
 * a primary border thickened by a matching ring, over the theme's `selected`
 * surface: a soft accent tint the theme generator solves so the card's own
 * `foreground` and `muted-foreground` text keep 4.5:1 on it, in every theme
 * and mode (a half `bg-accent` did not: Starry Night dark read at 1.3:1).
 * Until the contract package carries `--selected`, the old half accent
 * stands in. `data-dimmed`
 * fades disabled/past/off records.
 *
 * The idle fill is `bg-card/70`, not solid: the list panes sit directly on the
 * workspace's Neat backdrop, and hover/selected were already translucent — a
 * solid idle card was the one state that blocked the background. 70% keeps it
 * the LEAST see-through of the three, so the state order still reads.
 *
 * `accent` marks a card that wants ATTENTION — the slim `border-l-[3px]` bar
 * the compact nav rows use, in a semantic status token. It is deliberately not
 * a full border: selection owns that idiom, and a second full border would be
 * ambiguous the moment a card is both marked and selected. The two compose —
 * the side-specific `border-l-*` colour utilities cascade after the general
 * `border-*` ones, so an accent bar stays its own colour on a selected card
 * while the ring and tint keep saying "selected". One marker per card, most
 * urgent wins; two accent bars is not a marker, it is a gradient.
 */
export const listCardClass =
  'block w-full rounded-lg border border-border bg-card/70 p-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[selected=true]:border-primary data-[selected=true]:ring-1 data-[selected=true]:ring-primary data-[selected=true]:bg-[color:var(--selected,color-mix(in_oklab,var(--accent)_50%,transparent))] data-[dimmed=true]:opacity-60 data-[accent]:border-l-[3px] data-[accent=primary]:border-l-primary data-[accent=info]:border-l-info data-[accent=warning]:border-l-warning data-[accent=success]:border-l-success';

/** Semantic accent-bar tones. Status tokens only — never `chart-*` (DATA ink)
 *  and never a literal colour. What each means is the caller's contract; the
 *  Forum uses `primary` = pinned/announcement, `info` = unread, `warning` =
 *  open bug. */
export type ListCardAccent = 'primary' | 'info' | 'warning' | 'success';

export interface ListCardProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Render the child element (a `<Link>`, `<div>`, …) instead of a `<button>`. */
  asChild?: boolean;
  /** Primary border + ring with a soft accent tint (the checked-card idiom). */
  selected?: boolean;
  /** Fades the card — disabled agents, past events, drafts, … */
  dimmed?: boolean;
  /** Attention marker: a 3px left bar in a semantic status token. */
  accent?: ListCardAccent;
}

export const ListCard = React.forwardRef<HTMLButtonElement, ListCardProps>(
  ({ className, asChild = false, selected, dimmed, accent, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        data-selected={selected || undefined}
        data-dimmed={dimmed || undefined}
        data-accent={accent}
        type={asChild ? type : (type ?? 'button')}
        className={cn(listCardClass, className)}
        {...props}
      />
    );
  },
);
ListCard.displayName = 'ListCard';

/**
 * Card title — pair with a leading icon in a flex row where the screen has one.
 *
 * `wrap` writes the title out in full over as many lines as it needs, instead
 * of clipping it. For a list whose whole job is FINDING a record by name — the
 * `/pages` and `/team/pages` columns — where two records that differ only past
 * the ellipsis are indistinguishable. It is a prop and not a class the caller
 * passes, because `truncate` is three declarations (`overflow`, `text-overflow`
 * and `white-space`) under one name and `tailwind-merge` does not unpick it:
 * `cn('truncate', 'whitespace-normal')` keeps BOTH and the winner is whichever
 * Tailwind happened to emit last.
 */
export function ListCardTitle({
  className,
  wrap = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { wrap?: boolean }) {
  return (
    <div
      className={cn('text-sm font-medium', wrap ? 'break-words leading-5' : 'truncate', className)}
      {...props}
    />
  );
}

/** Two-line body/summary preview under the title. */
export function ListCardSnippet({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('mt-0.5 line-clamp-2 text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}

/** One-line metadata (dates, counts, model ids). */
export function ListCardMeta({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('mt-0.5 truncate text-xs text-muted-foreground', className)} {...props} />
  );
}

/** Wrapping row of `TagPill`s / chips at the card's foot. */
export function ListCardTags({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-1.5 flex flex-wrap gap-1', className)} {...props} />;
}
