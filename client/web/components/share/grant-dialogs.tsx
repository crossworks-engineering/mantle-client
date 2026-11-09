'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
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
import { Checkbox } from '@mantle/web-ui/ui/checkbox';
import { useToast } from '@mantle/web-ui/ui/toast';
import { apiSend } from '@mantle/web-ui/api-fetch';
// Relative, not '@/': the node test runner renders these (grant-dialogs.test.ts).
import {
  alsoVisibleLine,
  appMoveLines,
  contentsLeftText,
  contentsLines,
  contentsUnfinishedText,
  keptLine,
  grantErrorText,
  keepReadableLabel,
  removedLine,
  withContentsLabel,
  type MovePreview,
  type MoveResult,
  type MoveTo,
} from '../../lib/grants';

/** A grant write that waits for a yes: a folder change (how many items gain
 *  or lose). */
export type PendingGrantConfirm = {
  title: string;
  lines: string[];
  note?: string;
  /** The button that goes ahead ("Share", "Remove"). */
  verb: string;
  /** Nothing to go ahead with (too many items): Cancel only. */
  blocked?: boolean;
  run: () => Promise<void>;
};

export function GrantConfirmDialog({
  pending,
  onClose,
}: {
  pending: PendingGrantConfirm | null;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog open={pending !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-1.5">
              {pending?.lines.map((l) => (
                <p key={l}>{l}</p>
              ))}
              {pending?.note && <p className="text-xs">{pending.note}</p>}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          {!pending?.blocked && (
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                // Stay open while it writes; close when it is done.
                e.preventDefault();
                if (!pending) return;
                setBusy(true);
                void pending.run().finally(() => {
                  setBusy(false);
                  onClose();
                });
              }}
            >
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              {pending?.verb}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** A move that may change who sees the items (21.8 rows 1 and 9). */
export type MoveTarget = {
  nodeIds: string[];
  /** "Move “Plan” to Sales." */
  action: string;
  to: MoveTo;
  /** The old home, on a move to another workspace: the dialog offers "Keep
   *  it readable in H" (contract change 12: only the old home). */
  oldHome?: { wsId: string; name: string };
  /** An app: the confirm also says its new workspaces see its data (S7). */
  app?: boolean;
  /** A folder's home move: the dialog offers "Also move the N items
   *  inside" (ticked), the items below it that share its home. */
  folder?: boolean;
  /** The dialog's title; a move by default. */
  title?: string;
  /** After the move is written. */
  onMoved?: () => void;
};

/** A folder's home move with the items inside it: the folder's home as
 *  the dialog saw it (the brain refuses once it has another). */
export type WithContents = { fromWorkspaceId: string };

const contentsBody = (c: WithContents | null) =>
  c ? { withContents: true, fromWorkspaceId: c.fromWorkspaceId } : {};

/** POST /api/grants/move/preview. With `contents` the answer counts the
 *  items inside the folder. */
export const fetchMovePreview = (
  nodeIds: string[],
  to: MoveTo,
  contents: WithContents | null = null,
) =>
  apiSend<MovePreview>('/api/grants/move/preview', 'POST', {
    nodeIds,
    ...to,
    ...contentsBody(contents),
  });

/** POST /api/grants/move: `{ moved, failed }`. The dialog showed what
 *  changes, so it goes with `confirm`. With `contents` the brain moves at
 *  most 200 items per call: it is called again while items remain and the
 *  last call moved some, and the answers are summed (an item that failed
 *  in two calls counted once, with its last error). */
export async function sendMove(
  nodeIds: string[],
  to: MoveTo,
  keepReadableIn: string | null,
  contents: WithContents | null = null,
): Promise<MoveResult> {
  const once = () =>
    apiSend<MoveResult>('/api/grants/move', 'POST', {
      nodeIds,
      ...to,
      confirm: true,
      ...(keepReadableIn ? { keepReadableIn } : {}),
      ...contentsBody(contents),
    });
  let res = await once();
  let moved = res.moved;
  const failed = new Map(res.failed.map((f) => [f.id, f]));
  while (contents && (res.contents?.remaining ?? 0) > 0 && res.moved > 0) {
    res = await once();
    moved += res.moved;
    for (const f of res.failed) failed.set(f.id, f);
  }
  return { moved, failed: [...failed.values()], contents: res.contents };
}

/**
 * The move dialog: what the item becomes visible to ("This will also be
 * visible to: ..."), where it stops being read, and for each of those "Keep
 * it readable in H" (a hand grant, Write off). `preview` may come from the
 * caller (the tree asks first, to skip the dialog when nothing changes).
 */
export function MoveGrantsDialog({
  target,
  preview: given,
  onClose,
}: {
  target: MoveTarget | null;
  preview?: MovePreview | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const [loaded, setLoaded] = useState<{
    target: MoveTarget;
    contents: boolean;
    preview: MovePreview;
  } | null>(null);
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);
  // A folder's home move: the tick, and the count of the items inside (kept
  // from the answer that had it while the tick is off).
  const offersContents = !!target?.folder && !!target.oldHome && 'toWorkspaceId' in target.to;
  const [withContents, setWithContents] = useState(true);
  const [inside, setInside] = useState<MovePreview['contents'] | null>(null);

  useEffect(() => {
    setKeep(false);
    setWithContents(true);
    setInside(null);
  }, [target]);

  const contents = offersContents && withContents;
  const fromHome = target?.oldHome?.wsId;
  const contentsArg = (): WithContents | null =>
    contents && fromHome ? { fromWorkspaceId: fromHome } : null;
  useEffect(() => {
    if (!target) return;
    if (given) {
      setLoaded({ target, contents, preview: given });
      return;
    }
    setLoaded(null);
    let live = true;
    const arg = contents && fromHome ? { fromWorkspaceId: fromHome } : null;
    fetchMovePreview(target.nodeIds, target.to, arg).then(
      (p) => {
        if (!live) return;
        if (p.contents) setInside(p.contents);
        setLoaded({ target, contents, preview: p });
      },
      (e) => {
        if (!live) return;
        toast.error(grantErrorText(e, 'Could not check who would see it'));
        onClose();
      },
    );
    return () => {
      live = false;
    };
  }, [target, given, contents, fromHome, toast, onClose]);

  const preview = loaded?.target === target && loaded.contents === contents ? loaded.preview : null;

  const move = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const res = await sendMove(
        target.nodeIds,
        target.to,
        keep && target.oldHome ? target.oldHome.wsId : null,
        contentsArg(),
      );
      if (res?.failed?.length) {
        toast.error(
          `Could not move ${res.failed.length === 1 ? 'one item' : `${res.failed.length} items`}: ${res.failed[0]!.error}`,
        );
      }
      const left = contentsLeftText(res);
      if (left) toast.info(left);
      const unfinished = contentsUnfinishedText(res);
      if (unfinished) toast.error(unfinished);
      target.onMoved?.();
      onClose();
    } catch (e) {
      toast.error(grantErrorText(e, 'Could not move it'));
      // A folder's move with its contents may have moved some before.
      if (contents) target.onMoved?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={target !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{target?.title ?? MOVE_TITLE}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-1.5">
              <p>{target?.action}</p>
              {offersContents && inside && inside.move > 0 && (
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <Checkbox
                    checked={withContents}
                    disabled={busy}
                    onCheckedChange={(v) => setWithContents(v === true)}
                  />
                  {withContentsLabel(inside.move)}
                </label>
              )}
              {!preview ? (
                <p className="flex items-center gap-1 text-xs">
                  <Loader2 className="size-3 animate-spin" aria-hidden /> Checking…
                </p>
              ) : (
                <>
                  <MovePreviewLines
                    preview={preview}
                    oldHome={target?.oldHome}
                    app={target?.app}
                    keep={keep}
                    onKeep={setKeep}
                    busy={busy}
                  />
                  {preview.contents && <ContentsLines contents={preview.contents} />}
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy || !preview}
            onClick={(e) => {
              e.preventDefault();
              void move();
            }}
          >
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            Move
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** What a folder's move with its contents leaves where it is. */
export function ContentsLines({ contents }: { contents: NonNullable<MovePreview['contents']> }) {
  return (
    <>
      {contentsLines(contents).map((l) => (
        <p key={l} className="text-xs">
          {l}
        </p>
      ))}
    </>
  );
}

export const MOVE_TITLE = 'Move and change who can see it?';
export const CREATE_HERE_TITLE = 'Create here and change who can see it?';

/** The preview's lines and, on a move from the old home, the "Keep it
 *  readable in H" tick (a hand grant there, Write off). An app adds that
 *  its new workspaces see its data. */
export function MovePreviewLines({
  preview,
  oldHome,
  app,
  keep,
  onKeep,
  busy = false,
}: {
  preview: MovePreview;
  oldHome?: { wsId: string; name: string };
  app?: boolean;
  keep: boolean;
  onKeep: (next: boolean) => void;
  busy?: boolean;
}) {
  const offerKeep = !!oldHome && preview.removedFrom.some((w) => w.wsId === oldHome.wsId);
  const kept = offerKeep && keep ? oldHome.wsId : null;
  const also = alsoVisibleLine(preview);
  const gone = removedLine(preview, kept);
  const appLines =
    app && preview.alsoVisibleTo.length > 0
      ? appMoveLines(preview.alsoVisibleTo.map((w) => w.name))
      : [];
  return (
    <>
      {also && <p className="text-foreground">{also}</p>}
      {appLines.map((l) => (
        <p key={l} className="text-foreground">
          {l}
        </p>
      ))}
      {gone && <p>{gone}</p>}
      {kept && <p>{keptLine(oldHome!.name)}</p>}
      {!also && !gone && !kept && <p>Who can see it does not change.</p>}
      {offerKeep && (
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Checkbox checked={keep} disabled={busy} onCheckedChange={(v) => onKeep(v === true)} />
          {keepReadableLabel(oldHome.name)}
        </label>
      )}
    </>
  );
}
