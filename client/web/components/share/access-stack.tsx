import { Globe, Share2 } from 'lucide-react';
import { cn } from '@mantle/web-ui/lib/utils';
// Relative, not '@/': the node test runner renders this (access-stack.test.ts).
import { chipsOf, workspacesOf } from '../../lib/grants';
import { WorkspaceTile } from '../workspaces/workspace-tile';

/** The row whose workspaces and open link Access shows: the item's own
 *  when it carries them, else the tree row it was opened from (an item
 *  opened from the folder tree loads from its detail route, which answers
 *  no share marks). */
export function shareMarksOf(row: object, opened: unknown): unknown {
  if ('workspaces' in row) return row;
  const o = opened as { id?: unknown } | null;
  return o && o.id === (row as { id?: unknown }).id ? o : row;
}

/** How many faces the stack shows before "+N". */
export const ACCESS_STACK_MAX = 3;

/** The words for the Access slot: who it is shared with, or that it is not. */
export function accessStackLabel(item: unknown): string {
  const names = workspacesOf(item)
    .map((w) => w.name)
    .sort((a, b) => a.localeCompare(b));
  if ((item as { hasLink?: unknown } | null)?.hasLink === true) names.push('anyone with the link');
  return names.length ? `Access: shared with ${names.join(', ')}` : 'Access: not shared';
}

/**
 * The Access slot's face (item header contract, 2026-10-21): the share icon,
 * then who the item is shared with, so the header says it before anyone
 * opens the panel. Each workspace as its own tile, overlapping, at most
 * three, then "+N"; a globe when it has an open link. The icon alone when it
 * is shared with no one. It grows to the LEFT of the fixed slots, so Info,
 * Focus and More never move.
 */
export function AccessStack({ item, max = ACCESS_STACK_MAX }: { item: unknown; max?: number }) {
  const { shown, more } = chipsOf(workspacesOf(item), max);
  const open = (item as { hasLink?: unknown } | null)?.hasLink === true;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Share2 aria-hidden />
      {shown.length > 0 || open ? (
        <span className="inline-flex items-center" aria-hidden>
          {shown.map((w, i) => (
            <WorkspaceTile
              key={w.id}
              workspace={w}
              size="xs"
              className={cn('ring-2 ring-background', i > 0 && '-ml-1.5')}
            />
          ))}
          {open ? (
            <span
              className={cn(
                'inline-flex size-4 items-center justify-center rounded-full bg-muted text-muted-foreground ring-2 ring-background',
                shown.length > 0 && '-ml-1.5',
              )}
            >
              <Globe className="size-3" />
            </span>
          ) : null}
          {more > 0 ? (
            <span className="ml-1 text-[11px] font-medium tabular-nums text-muted-foreground">
              +{more}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
