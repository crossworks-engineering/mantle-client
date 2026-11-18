'use client';

/**
 * A file's History (file history, brain contract P3): a side sheet with the
 * file as it is now on top and its kept versions under it, newest first.
 * Each version downloads; with `rights.mayRestore` (an Admin, or a
 * Moderator of the file's workspace or of one that holds it) it also
 * restores and deletes. A restore keeps the bytes it replaces as a new
 * version, so it is undone by restoring that one.
 *
 * The pattern is the app History tab's (components/app-nav/app-history.tsx):
 * one list, a confirm before a restore or a delete, a toast after.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, History, RotateCcw, Trash2 } from 'lucide-react';
import { apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { useAssetUrl } from '@mantle/web-ui/hooks/use-asset-url';
import { cn } from '@mantle/web-ui/lib/utils';
import { formatDateTime } from '@mantle/web-ui/lib/format-datetime';
import { Badge } from '@mantle/web-ui/ui/badge';
import { Button } from '@mantle/web-ui/ui/button';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { useToast } from '@mantle/web-ui/ui/toast';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@mantle/web-ui/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@mantle/web-ui/ui/alert-dialog';
import {
  HISTORY_EMPTY,
  announceFileRestored,
  historyKey,
  historyLoadError,
  historyPath,
  historyRows,
  restoreConfirm,
  versionActionError,
  versionDownloadPath,
  versionPath,
  type FileHistoryResponse,
  type FileVersion,
  type HistoryFile,
  type HistoryRow,
} from '@/lib/file-history';
import { play } from '@/lib/sounds/play';

export function FileHistorySheet({
  file,
  onOpenChange,
}: {
  /** The file whose history shows; null keeps the sheet shut. */
  file: HistoryFile | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={file !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        {file && <HistoryBody file={file} />}
      </SheetContent>
    </Sheet>
  );
}

function HistoryBody({ file }: { file: HistoryFile }) {
  const toast = useToast();
  const toAsset = useAssetUrl();
  const queryClient = useQueryClient();
  const [restoring, setRestoring] = useState<FileVersion | null>(null);
  const [deleting, setDeleting] = useState<FileVersion | null>(null);
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: historyKey(file.id),
    queryFn: () => apiFetch<FileHistoryResponse>(historyPath(file.id)),
    retry: false,
  });

  /** The Files views (every list, this history) and the tree rail. */
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['files'] }),
      queryClient.invalidateQueries({ queryKey: ['tree', 'files'] }),
    ]);
  };

  async function restore(v: FileVersion) {
    setBusy(true);
    try {
      await apiSend(`${versionPath(file.id, v.id)}/restore`, 'POST');
      announceFileRestored(file.id);
      await refresh();
      play('success');
      toast.success(
        `Restored v${v.seq}. The version it replaced is kept at the top of the history.`,
      );
    } catch (err) {
      play('danger');
      toast.error(versionActionError(err, 'restore'));
      void refresh();
    } finally {
      setBusy(false);
      setRestoring(null);
    }
  }

  async function remove(v: FileVersion) {
    setBusy(true);
    try {
      await apiSend(versionPath(file.id, v.id), 'DELETE');
      await refresh();
      toast.success(`Deleted v${v.seq}.`);
    } catch (err) {
      toast.error(versionActionError(err, 'delete'));
      void refresh();
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }

  const mayRestore = q.data?.rights.mayRestore === true;
  const versions = q.data?.versions ?? [];
  const rows = historyRows(file, versions);

  return (
    <>
      <SheetHeader className="border-b border-border px-5 pb-3 pt-5 text-left">
        <SheetTitle className="flex items-center gap-2 text-base">
          <History className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          History
        </SheetTitle>
        <SheetDescription className="truncate" title={file.filename}>
          {file.filename}
        </SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-5 py-4">
        {q.isPending ? (
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        ) : q.isError ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {historyLoadError(q.error)}
          </p>
        ) : (
          <>
            <ol className="relative flex flex-col">
              {rows.map((row, i) => (
                <HistoryLine
                  key={row.key}
                  row={row}
                  last={i === rows.length - 1}
                  busy={busy}
                  mayRestore={mayRestore}
                  downloadHref={toAsset(
                    row.version
                      ? versionDownloadPath(file.id, row.version.id)
                      : `/api/files/files/${file.id}?raw=1`,
                  )}
                  downloadName={row.version ? undefined : file.filename}
                  onRestore={() => row.version && setRestoring(row.version)}
                  onDelete={() => row.version && setDeleting(row.version)}
                />
              ))}
            </ol>
            {versions.length === 0 ? (
              <p className="mt-4 rounded-md border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
                {HISTORY_EMPTY}
              </p>
            ) : (
              <p className="mt-4 text-xs text-muted-foreground">
                {mayRestore
                  ? 'A restore keeps the current file as a new version, so it can be undone.'
                  : 'You can download any version. An Admin or a Moderator of the workspace can restore or delete one.'}{' '}
                The oldest versions go first when the file has many.
              </p>
            )}
          </>
        )}
      </div>

      <AlertDialog
        open={restoring !== null}
        onOpenChange={(o) => !o && !busy && setRestoring(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {restoring ? restoreConfirm(restoring.seq).title : ''}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {restoring ? restoreConfirm(restoring.seq).body : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(ev) => {
                // Open, with the progress, until it is done.
                ev.preventDefault();
                if (restoring) void restore(restoring);
              }}
            >
              {busy ? 'Restoring…' : 'Restore'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && !busy && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete v{deleting?.seq}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its bytes are removed from the server. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(ev) => {
                ev.preventDefault();
                if (deleting) void remove(deleting);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** One version on the line: its tag, what happened, when, the size, and
 *  its actions. The current file is the filled dot at the top. */
function HistoryLine({
  row,
  last,
  busy,
  mayRestore,
  downloadHref,
  downloadName,
  onRestore,
  onDelete,
}: {
  row: HistoryRow;
  last: boolean;
  busy: boolean;
  mayRestore: boolean;
  downloadHref: string;
  downloadName?: string;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const current = row.version === null;
  const meta = [row.at ? formatDateTime(row.at) : null, row.size].filter(Boolean).join(' · ');
  return (
    <li className="relative flex gap-3 pb-4">
      {/* The line joining the versions, and this one's dot on it. */}
      {!last && <span aria-hidden className="absolute left-[5px] top-4 bottom-0 w-px bg-border" />}
      <span
        aria-hidden
        className={cn(
          'relative mt-1.5 size-[11px] shrink-0 rounded-full border-2',
          current ? 'border-primary bg-primary' : 'border-muted-foreground/50 bg-background',
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <Badge
            variant={current ? 'default' : 'outline'}
            className={cn('shrink-0', !current && 'font-mono')}
          >
            {row.label}
          </Badge>
          <span className="min-w-0 truncate text-sm">{row.title}</span>
        </div>
        {meta && <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p>}
        {row.formerName && (
          <p className="truncate text-xs text-muted-foreground" title={row.formerName}>
            Named {row.formerName} then
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <Button asChild variant="ghost" size="2xs" className="text-muted-foreground">
            <a href={downloadHref} download={downloadName ?? ''}>
              <Download className="size-3.5" aria-hidden />
              Download
            </a>
          </Button>
          {!current && mayRestore && (
            <>
              <Button
                variant="outline"
                size="2xs"
                disabled={busy}
                onClick={onRestore}
                aria-label={`Restore ${row.label}`}
              >
                <RotateCcw className="size-3.5" aria-hidden />
                Restore
              </Button>
              <Button
                variant="ghost"
                size="2xs"
                disabled={busy}
                onClick={onDelete}
                className="text-muted-foreground hover:text-destructive-ink"
                aria-label={`Delete ${row.label}`}
              >
                <Trash2 className="size-3.5" aria-hidden />
                Delete
              </Button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}
