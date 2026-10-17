'use client';

/**
 * The app's History tab (mantle apps snapshots, Phase 2): one numbered line
 * of versions (what each publish made live, code only) and snapshots (the
 * code AND a copy of the app's database). Take a snapshot, restore one in
 * three modes, download a snapshot's database, delete a snapshot.
 *
 * Every restore takes a snapshot of what it replaces first (the brain does
 * it), so the toast after a restore points at the undo entry.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Camera,
  Database,
  Download,
  EllipsisVertical,
  GitCommitHorizontal,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import type { AppRestoreMode, AppSnapshot } from '@mantle/client-types';
import { apiFetch, apiSend, apiUrl, withAuth, ApiError } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { Badge } from '@mantle/web-ui/ui/badge';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { Input } from '@mantle/web-ui/ui/input';
import { Field, FieldGroup, FieldLabel } from '@mantle/web-ui/ui/field';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { useToast } from '@mantle/web-ui/ui/toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@mantle/web-ui/ui/dropdown-menu';
import { formatDateTime } from '@mantle/web-ui/lib/format-datetime';
import { formatBytes } from '@/lib/upload-progress';
import { restoreBlockedReason, restoreErrorText } from '@/lib/apps-screen';

const TRIGGER_LABEL: Record<AppSnapshot['trigger'], string> = {
  publish: 'Published',
  manual: 'Snapshot',
  pre_restore: 'Before a restore',
  pre_schema: 'Before a schema change',
  pre_delete: 'Before delete',
  pre_import: 'Before an import',
  nightly: 'Nightly snapshot',
  pre_mcp_write: 'Before an MCP write',
};

const ACTOR_LABEL: Record<AppSnapshot['actor'], string> = {
  owner: 'you',
  agent: 'the assistant',
  mcp: 'an MCP client',
  system: 'MantleOS',
  member: 'a team member',
};

const MODE_COPY: Record<AppRestoreMode, { title: string; body: string; action: string }> = {
  code: {
    title: 'Restore the code to the draft?',
    body: 'The code from this entry goes into the draft. Nothing live changes until you preview and commit it.',
    action: 'Restore code',
  },
  data: {
    title: 'Restore the data?',
    body: "The app's live database is replaced with this snapshot's copy, at once. Everything written since is set aside in an undo snapshot. The app pauses for a few seconds while it swaps.",
    action: 'Restore data',
  },
  full: {
    title: 'Roll the whole app back?',
    body: 'The code from this snapshot goes live with its data, at once, as they were together. The current code and data are kept in an undo snapshot.',
    action: 'Roll back',
  },
};

type RestoreResult = {
  restored: AppSnapshot;
  undo: AppSnapshot | null;
  code: 'draft' | 'live' | null;
  mode: AppRestoreMode;
  /** A code restore leaves the app's tools alone: the restored code's
   *  declared tools, when they differ (mantle apps audit 2026-10-02). */
  declaredTools?: string[] | null;
};

const historyKey = (appId: string) => ['apps', appId, 'snapshots'] as const;

export function AppHistory({
  appId,
  appTitle,
  hasDraft,
  dirty,
  codeWhy,
  copy,
  onRestored,
}: {
  appId: string;
  appTitle: string;
  /** Why the login may not change the app's code (appCodeWhy), null when it
   *  may: set, the code and full restores are dimmed with it (the copy's
   *  note on a snapshot copy, else the Moderator sentence); a data restore
   *  stays. */
  codeWhy: string | null;
  /** The app is a read-only snapshot copy: a refused code or full restore
   *  says the copy's note, not the Moderator sentence. */
  copy: boolean;
  /** The app has an unpublished draft: a code restore replaces it. */
  hasDraft: boolean;
  /** The editor holds unsaved code edits: a code restore drops them. */
  dirty: boolean;
  /** After a restore: the editor reloads the app and its files. */
  onRestored: (result: RestoreResult) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [taking, setTaking] = useState(false);
  const [restoring, setRestoring] = useState<{ entry: AppSnapshot; mode: AppRestoreMode } | null>(
    null,
  );
  const [deleting, setDeleting] = useState<AppSnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: historyKey(appId),
    queryFn: () => apiFetch<{ snapshots: AppSnapshot[] }>(`/api/apps/${appId}/snapshots`),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['apps'] });

  async function restore(entry: AppSnapshot, mode: AppRestoreMode) {
    setBusy(true);
    try {
      // The draft is dropped only when the dialog said so: a code restore
      // over a draft the owner saw. A data restore never touches the draft,
      // and a draft that appeared since the dialog opened is refused (409)
      // rather than dropped unseen (mantle apps audit 2026-10-02, low).
      const res = await apiSend<RestoreResult>(
        `/api/apps/${appId}/snapshots/${entry.id}/restore`,
        'POST',
        { mode, discardDraft: mode !== 'data' && hasDraft },
      );
      await refresh();
      onRestored(res);
      const undo = res.undo ? ` To undo, restore v${res.undo.seq}.` : '';
      const tools = res.declaredTools?.length
        ? ` That version used the tools ${res.declaredTools.join(', ')}; the app keeps its current tools until you grant those.`
        : '';
      toast.success(
        res.code === 'draft'
          ? `v${entry.seq}'s code is in the draft: preview it, then commit.${tools}${undo}`
          : `Restored v${entry.seq}.${undo}`,
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.body?.reason === 'draft') {
        toast.error(
          'The app got a draft after you opened this (the assistant, or another window). Look at it first, then restore again.',
        );
      } else {
        toast.error(restoreErrorText(err, mode, { copy }));
      }
    } finally {
      setBusy(false);
      setRestoring(null);
    }
  }

  async function remove(entry: AppSnapshot) {
    setBusy(true);
    try {
      await apiSend(`/api/apps/${appId}/snapshots/${entry.id}`, 'DELETE');
      await refresh();
      toast.success(`Deleted v${entry.seq}.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete the snapshot.');
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }

  async function download(entry: AppSnapshot) {
    try {
      // A plain link carries no credential on the split client: fetch it.
      const res = await fetch(
        apiUrl(`/api/apps/${appId}/snapshots/${entry.id}/download`),
        withAuth(),
      );
      if (!res.ok) throw new Error(`download failed (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${appTitle.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'app'}-v${entry.seq}.sqlite`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      toast.error('Could not download the snapshot.');
    }
  }

  const replacesWork =
    restoring && restoring.mode !== 'data' && (hasDraft || dirty)
      ? dirty
        ? ' Your unsaved code edits and the unpublished draft are replaced.'
        : ' The unpublished draft is replaced.'
      : '';

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Every commit adds a version. A snapshot also keeps a copy of the app&apos;s data, so you
          can put both back.
        </p>
        <Button size="sm" variant="outline" onClick={() => setTaking(true)} disabled={busy}>
          <Camera />
          Take snapshot
        </Button>
      </div>

      {q.isPending ? (
        <div className="flex justify-center p-8">
          <Spinner />
        </div>
      ) : q.isError ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          Couldn&apos;t load the history.
        </div>
      ) : q.data.snapshots.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          No history yet. Commit the app, or take a snapshot, to start it.
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {q.data.snapshots.map((e) => (
            <HistoryRow
              key={e.id}
              entry={e}
              busy={busy}
              codeWhy={codeWhy}
              onRestore={(mode) => setRestoring({ entry: e, mode })}
              onDownload={() => void download(e)}
              onDelete={() => setDeleting(e)}
            />
          ))}
        </ul>
      )}

      <Dialog open={taking} onOpenChange={setTaking}>
        {taking && (
          <TakeSnapshotDialog
            appId={appId}
            onDone={async (snap) => {
              setTaking(false);
              await refresh();
              toast.success(`Snapshot v${snap.seq} taken.`);
            }}
          />
        )}
      </Dialog>

      <AlertDialog
        open={restoring !== null}
        onOpenChange={(o) => !o && !busy && setRestoring(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {restoring ? `${MODE_COPY[restoring.mode].title} (v${restoring.entry.seq})` : ''}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {restoring ? MODE_COPY[restoring.mode].body + replacesWork : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {busy && restoring && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Spinner />
              {restoring.mode === 'code'
                ? 'Restoring the code…'
                : 'Restoring. The app pauses for a few seconds while its data is swapped…'}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className={
                restoring?.mode === 'code'
                  ? undefined
                  : 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
              }
              onClick={(ev) => {
                // The dialog stays open, with the progress, until it is done.
                ev.preventDefault();
                if (restoring) void restore(restoring.entry, restoring.mode);
              }}
            >
              {busy ? 'Restoring…' : restoring ? MODE_COPY[restoring.mode].action : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete snapshot v{deleting?.seq}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its copy of the data goes too. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleting && void remove(deleting)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function HistoryRow({
  entry: e,
  busy,
  codeWhy,
  onRestore,
  onDownload,
  onDelete,
}: {
  entry: AppSnapshot;
  busy: boolean;
  codeWhy: string | null;
  onRestore: (mode: AppRestoreMode) => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const Icon = e.kind === 'version' ? GitCommitHorizontal : Camera;
  const codeBlocked = restoreBlockedReason('code', codeWhy);
  const facts = [
    formatDateTime(e.createdAt),
    `by ${ACTOR_LABEL[e.actor] ?? e.actor}`,
    `${e.fileCount} file${e.fileCount === 1 ? '' : 's'}, ${formatBytes(e.sourceBytes)}`,
    e.hasData && e.dbBytes !== null ? `data ${formatBytes(e.dbBytes)}` : null,
    e.restoredFrom !== null ? `restored from v${e.restoredFrom}` : null,
  ].filter(Boolean);
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 text-sm">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="outline" className="shrink-0 font-mono">
            v{e.seq}
          </Badge>
          <span className="truncate">{e.note ?? TRIGGER_LABEL[e.trigger]}</span>
          {e.hasData && (
            <Database
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-label="Holds a copy of the data"
            />
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {e.note ? `${TRIGGER_LABEL[e.trigger]} · ` : ''}
          {facts.join(' · ')}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-xs"
            variant="ghost"
            disabled={busy}
            aria-label={`Actions for v${e.seq}`}
          >
            <EllipsisVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {codeBlocked ? (
            // Why the code restores are dimmed: a disabled item takes no
            // pointer, so the reason is said in the menu itself.
            <DropdownMenuLabel className="max-w-64 text-xs font-normal text-muted-foreground">
              {codeBlocked}
            </DropdownMenuLabel>
          ) : null}
          <DropdownMenuItem disabled={codeBlocked !== null} onSelect={() => onRestore('code')}>
            <RotateCcw />
            Restore code to the draft
          </DropdownMenuItem>
          {e.hasData && (
            <>
              <DropdownMenuItem onSelect={() => onRestore('data')}>
                <Database />
                Restore data
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={restoreBlockedReason('full', codeWhy) !== null}
                onSelect={() => onRestore('full')}
              >
                <RotateCcw />
                Roll back code and data
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onDownload}>
                <Download />
                Download data (.sqlite)
              </DropdownMenuItem>
            </>
          )}
          {e.kind === 'snapshot' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onDelete} className="text-destructive-ink">
                <Trash2 />
                Delete snapshot
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function TakeSnapshotDialog({
  appId,
  onDone,
}: {
  appId: string;
  onDone: (snap: AppSnapshot) => void | Promise<void>;
}) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setSaving(true);
    try {
      const { snapshot } = await apiSend<{ snapshot: AppSnapshot }>(
        `/api/apps/${appId}/snapshots`,
        'POST',
        { note: note.trim() || null },
      );
      await onDone(snapshot);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not take the snapshot.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Take a snapshot</DialogTitle>
        <DialogDescription>
          Keeps the code and a copy of the app&apos;s data as they are now.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} noValidate>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="snapshot-note">Note (optional)</FieldLabel>
            <Input
              id="snapshot-note"
              value={note}
              maxLength={500}
              onChange={(ev) => setNote(ev.target.value)}
              placeholder="Before the price import"
              autoFocus
            />
          </Field>
          <div className="flex justify-end">
            <SubmitButton pending={saving}>Take snapshot</SubmitButton>
          </div>
        </FieldGroup>
      </form>
    </DialogContent>
  );
}
