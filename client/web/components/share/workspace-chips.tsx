import { Globe } from 'lucide-react';
import { Badge } from '@mantle/web-ui/ui/badge';
import { cn } from '@mantle/web-ui/lib/utils';
// Relative, not '@/': the node test runner renders this (workspace-chips.test.ts).
import { chipsOf, workspacesOf } from '../../lib/grants';
import { resolveWorkspaceLook } from '../../lib/workspace-look';
import { TINT_CLASSES } from '../app-nav/app-tile';
import { WorkspaceTile } from '../workspaces/workspace-tile';

/** How the share marks show: `pills` names each workspace in its colour;
 *  `icons` shows only each workspace's icon in its colour (a tree row
 *  whose shares are hidden, task ca907a89). */
export type ShareMarksVariant = 'pills' | 'icons';

const LINK_TITLE = 'It has an open link: anyone with the link can open it';

/**
 * The workspaces an item is shared with: THE share marks of every list, card,
 * detail title and tree row (plan 7.1; replaces AudienceBadge). Each
 * workspace in its own colour and icon (task 5edc9149, lib/workspace-look.ts).
 * At most three pills (four icons), then "+N"; the title names them all.
 * Nothing for a row that carries no workspaces (a brain before W5b). `hub`
 * (apps only) adds the home app tag, as before, and `hasLink` the public
 * mark (plan 8.1).
 */
export function WorkspaceChips({
  item,
  hub = false,
  compact = false,
  variant = 'pills',
  className,
}: {
  /** Any list row: its `workspaces` are read when present. */
  item: unknown;
  hub?: boolean;
  /** Smaller chips, for a tree row. */
  compact?: boolean;
  variant?: ShareMarksVariant;
  className?: string;
}) {
  const icons = variant === 'icons';
  const { shown, more, title } = chipsOf(workspacesOf(item), icons ? 4 : 3);
  const size = compact ? 'px-1.5 py-0 text-[10px]' : undefined;
  // A live open link (plan 8.1: the "Public" pill, as before).
  const open = (item as { hasLink?: unknown } | null)?.hasLink === true;
  if (!hub && !open && shown.length === 0) return null;
  return (
    <span
      className={cn(
        'inline-flex min-w-0 shrink-0 items-center',
        icons ? 'gap-0.5' : 'gap-1',
        className,
      )}
      title={title || undefined}
    >
      {hub && (
        <Badge className={cn('shrink-0', size)} title="Home app: members see it as their home">
          hub
        </Badge>
      )}
      {icons && title && <span className="sr-only">{title}</span>}
      {shown.map((w) => {
        if (icons) return <WorkspaceTile key={w.id} workspace={w} size="xs" />;
        const look = resolveWorkspaceLook(w);
        return look.color ? (
          <Badge
            key={w.id}
            variant="outline"
            className={cn(
              'max-w-28 shrink-0 truncate border-transparent',
              // The tint's fill, but the page's own text: the tint's ink is a
              // fixed-lightness hue that falls under 4.5:1 in most light themes.
              TINT_CLASSES[look.color],
              'text-foreground',
              size,
            )}
          >
            {w.name}
          </Badge>
        ) : (
          <Badge key={w.id} variant="secondary" className={cn('max-w-28 shrink-0 truncate', size)}>
            {w.name}
          </Badge>
        );
      })}
      {open &&
        (icons ? (
          <span title={LINK_TITLE} className="inline-flex shrink-0 text-muted-foreground">
            <Globe className="size-3" aria-hidden />
            <span className="sr-only">Open link</span>
          </span>
        ) : (
          <Badge variant="outline" className={cn('shrink-0', size)} title={LINK_TITLE}>
            public
          </Badge>
        ))}
      {more > 0 &&
        (icons ? (
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
            +{more}
            <span className="sr-only"> more workspaces</span>
          </span>
        ) : (
          <Badge variant="outline" className={cn('shrink-0', size)}>
            +{more}
            <span className="sr-only"> more workspaces</span>
          </Badge>
        ))}
    </span>
  );
}
