'use client';

import { AlertTriangle, FileWarning } from 'lucide-react';
import { cn } from '@mantle/web-ui/lib/utils';
import { extractionBadge, type FileExtraction } from './files-shared';

const TONE = {
  error: 'bg-destructive/10 text-destructive-ink',
  warning: 'bg-warning/10 text-warning-ink',
  muted: 'bg-muted text-muted-foreground',
} as const;

/** A file whose content was not read, or read in part, says so beside its
 *  name (task 8d40932a); the hint is its title. Nothing for a whole read. */
export function ExtractionBadge({
  x,
  compact = false,
}: {
  x: FileExtraction | undefined;
  compact?: boolean;
}) {
  const b = extractionBadge(x);
  if (!b) return null;
  const Icon = b.tone === 'error' ? AlertTriangle : FileWarning;
  return (
    <span
      title={x?.hint ?? b.label}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-sm px-1 text-[10px]',
        compact ? '' : 'shrink-0',
        TONE[b.tone],
      )}
    >
      <Icon className={compact ? 'size-2.5 shrink-0' : 'size-3 shrink-0'} aria-hidden /> {b.label}
    </span>
  );
}

/** The line a file's page shows above its content when it was not read
 *  whole: the badge words and the hint. */
export function ExtractionNote({ x }: { x: FileExtraction | undefined }) {
  const b = extractionBadge(x);
  if (!b || !x?.hint) return null;
  return (
    <p
      role="note"
      className={cn(
        'flex items-start gap-2 border-b border-border px-4 py-2 text-xs',
        TONE[b.tone],
      )}
    >
      {b.tone === 'error' ? (
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      ) : (
        <FileWarning className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      )}
      <span>{x.hint}</span>
    </p>
  );
}
