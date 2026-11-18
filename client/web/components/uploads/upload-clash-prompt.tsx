'use client';

import { FileWarning } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import { clashQuestion } from '@/lib/upload-clash';
import type { ClashAnswer, WaitingClash } from '@/lib/upload-clash';
import { formatBytes } from '@/lib/upload-progress';
import { useUploadWhere } from './use-upload-where';

/**
 * The one question of an upload whose name is taken by other bytes
 * (lib/upload-clash.ts): Override, Override all, Skip, Skip all. Asked once
 * per batch when the answer is an "...all"; the rest of the batch keeps
 * uploading while it is open. Escape or the corner X is Skip.
 */
export function UploadClashPrompt({
  clash,
  clashMore,
  answerClash,
}: {
  /** The clash asked about now, null for none. */
  clash: WaitingClash | null;
  /** How many more of its batch wait behind it. */
  clashMore: number;
  answerClash: (answer: ClashAnswer) => void;
}) {
  const whereOf = useUploadWhere();
  if (!clash) return null;
  const there = clash.existing;
  return (
    <Dialog open onOpenChange={(open) => !open && answerClash('skip')}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileWarning className="size-4 shrink-0 text-warning-ink" aria-hidden />
            This name is already taken
          </DialogTitle>
          <DialogDescription className="break-words">
            {clashQuestion(clash.name, whereOf(clash.parentPath))}
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
          <dt className="text-muted-foreground">In the folder</dt>
          <dd className="min-w-0 truncate tabular-nums" title={there.name || undefined}>
            {there.sizeBytes > 0 ? formatBytes(there.sizeBytes) : 'Unknown size'}
          </dd>
          <dt className="text-muted-foreground">Your file</dt>
          <dd className="tabular-nums">{formatBytes(clash.size)}</dd>
        </dl>

        <p className="text-xs text-muted-foreground">
          Override puts your file in its place and keeps the one there as an earlier version, so
          it can be restored from the file&apos;s History.
          {clashMore > 0 &&
            ` ${clashMore} more file${clashMore === 1 ? '' : 's'} in this upload ${clashMore === 1 ? 'has' : 'have'} a name already taken.`}
        </p>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => answerClash('skip-all')}>
              Skip all
            </Button>
            <Button variant="outline" size="sm" autoFocus onClick={() => answerClash('skip')}>
              Skip
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => answerClash('override-all')}>
              Override all
            </Button>
            <Button size="sm" onClick={() => answerClash('override')}>
              Override
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
