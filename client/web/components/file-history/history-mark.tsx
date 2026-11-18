import { History } from 'lucide-react';
import { cn } from '@mantle/web-ui/lib/utils';
import { hasHistory, historyMarkLabel } from '@/lib/file-history';

/**
 * The small mark of a file that has earlier versions (file history): a muted
 * clock with the count, by the name or on the meta line. Nothing for none,
 * and nothing from a brain before file history (no count on its rows). It
 * stays off the file icon, where the status badge sits.
 */
export function HistoryMark({
  versions,
  count = true,
  className,
}: {
  versions: number | undefined;
  /** Show the number beside the clock (the tree shows the clock only). */
  count?: boolean;
  className?: string;
}) {
  if (!hasHistory(versions)) return null;
  const label = historyMarkLabel(versions);
  return (
    <span
      role="img"
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 text-[10px] tabular-nums text-muted-foreground',
        className,
      )}
    >
      <History className="size-3 shrink-0" aria-hidden />
      {count && versions}
    </span>
  );
}
