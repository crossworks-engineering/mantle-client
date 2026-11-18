'use client';

import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Clock,
  History,
  LoaderCircle,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@mantle/web-ui/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import type { FileExtraction } from './files-shared';
import { BADGE_LEGEND, statusBadge, type FileStatus, type StatusBadgeKind } from './file-status';

/** Each badge's icon and colour. Failed is the only loud one. */
export const BADGE_LOOK: Record<
  StatusBadgeKind,
  { icon: LucideIcon; tone: string; spin?: boolean }
> = {
  failed: { icon: CircleAlert, tone: 'text-destructive-ink' },
  running: { icon: LoaderCircle, tone: 'text-info-ink', spin: true },
  waiting: { icon: Clock, tone: 'text-muted-foreground' },
  partial: { icon: CircleDashed, tone: 'text-warning-ink' },
  stale: { icon: History, tone: 'text-warning-ink' },
  pipeline: { icon: Workflow, tone: 'text-primary-ink' },
  done: { icon: CircleCheck, tone: 'text-success-ink' },
};

/** The icon of one badge kind, as the legend and the Details panel draw it. */
export function StatusIcon({ kind, className }: { kind: StatusBadgeKind; className?: string }) {
  const look = BADGE_LOOK[kind];
  const Icon = look.icon;
  return (
    <Icon
      aria-hidden
      className={cn('shrink-0', look.tone, look.spin && 'animate-spin', className)}
    />
  );
}

/**
 * The status dot on a file icon's top-right corner (Files program P4): what
 * the brain did with the file, most urgent first. The tooltip says it in
 * plain words. Nothing for a file with nothing to say, or from an older
 * brain that sends no status. Put it inside a `relative` icon wrapper.
 */
export function FileStatusBadge({
  status,
  extraction,
  size = 'sm',
  className,
}: {
  status: FileStatus | undefined | null;
  extraction?: FileExtraction;
  /** 'sm' on a 16px icon (tree, list); 'lg' on a grid tile. */
  size?: 'sm' | 'lg';
  /** Placement override (a grid tile clips outside its box). */
  className?: string;
}) {
  const badge = statusBadge(status, extraction);
  if (!badge) return null;
  return (
    <span
      role="img"
      aria-label={`${badge.title}: ${badge.lines.join('. ')}`}
      title={[badge.title, ...badge.lines].join('\n')}
      data-file-status={badge.kind}
      className={cn(
        'absolute inline-flex items-center justify-center rounded-full bg-background',
        size === 'lg' ? '-right-1.5 -top-1.5 size-5 shadow-sm' : '-right-1 -top-1 size-3',
        className,
      )}
    >
      <StatusIcon kind={badge.kind} className={size === 'lg' ? 'size-4' : 'size-2.5'} />
    </span>
  );
}

/** What the status icons mean: a small dialog from the Files header's
 *  More menu ("Status icons"). */
export function FileStatusLegend({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Status icons</DialogTitle>
          <DialogDescription>
            The corner of a file&apos;s icon says what the brain did with it. Hover it for the
            words, or open Details on the file.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {/* 'stale' is reserved for a later part; no brain sends it yet. */}
          {BADGE_LEGEND.filter((b) => b.kind !== 'stale').map((b) => (
            <li key={b.kind} className="flex items-start gap-2 text-sm">
              <StatusIcon kind={b.kind} className="mt-0.5 size-4" />
              <span>
                <span className="font-medium text-foreground">{b.title}</span>
                <span className="text-muted-foreground">: {b.meaning}</span>
              </span>
            </li>
          ))}
          <li className="flex items-start gap-2 text-sm text-muted-foreground">
            <span className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>No icon: kept to its name, or nothing to read.</span>
          </li>
        </ul>
      </DialogContent>
    </Dialog>
  );
}
