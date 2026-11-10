'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiSend } from '@mantle/web-ui/api-fetch';
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
import { useToast } from '@mantle/web-ui/ui/toast';
import { formatDateTime } from '@mantle/web-ui/lib/format-datetime';
import { boxName, type FleetBox } from '@/lib/fleet';
import { FLEET_MATRIX_KEY } from '@/lib/fleet-matrix';
import {
  answerText,
  changeLabel,
  sentText,
  writeUpdatePending,
  type FleetWriteChange,
} from '@/lib/fleet-writes';
import { refusalText, Section } from './fleet-section';

const TONE = { ok: 'text-muted-foreground', bad: 'text-destructive-ink' } as const;

/** One fleet write send: the changes to the boxes picked, then a toast that
 *  says how many boxes were queued. True when it was sent. */
export function useFleetSend(path: string, onChanged: () => void) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const send = async (
    changes: FleetWriteChange[] | { slug: string; model: string }[],
    boxIds: string[],
    fallback: string,
  ): Promise<boolean> => {
    setPending(true);
    try {
      const r = await apiSend<{ queued?: number }>(path, 'POST', { changes, boxIds });
      toast.success(sentText(boxIds.length, r?.queued ?? boxIds.length));
      onChanged();
      return true;
    } catch (err) {
      toast.error(refusalText(err, fallback));
      return false;
    } finally {
      setPending(false);
    }
  };
  return { pending, send };
}

/** The one question before a fleet write goes. */
export function ConfirmSend({
  open,
  pending,
  title,
  children,
  action,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  pending: boolean;
  title: string;
  children: ReactNode;
  action: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !pending && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{children}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Each box's fleet writes: what waits, in the order asked, then the box's
 * last answers (at most 40), newest last. When the last change is answered, the matrix
 * is read again: it then shows the new models.
 */
export function WritesSection({ boxes }: { boxes: FleetBox[] }) {
  const queryClient = useQueryClient();
  const waiting = writeUpdatePending(boxes);
  const wasWaiting = useRef(waiting);
  useEffect(() => {
    if (wasWaiting.current && !waiting) {
      void queryClient.invalidateQueries({ queryKey: FLEET_MATRIX_KEY });
    }
    wasWaiting.current = waiting;
  }, [waiting, queryClient]);

  const rows = boxes.filter(
    (b) => (b.writeJob?.changes.length ?? 0) > 0 || (b.writeResult?.results.length ?? 0) > 0,
  );
  return (
    <Section title="Fleet changes">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No change was sent yet.</p>
      ) : (
        <ul
          className="scrollbar-thin max-h-[32rem] divide-y divide-border overflow-y-auto rounded-md border border-border"
          aria-label="Fleet changes"
        >
          {rows.map((b) => (
            <li key={b.id} className="space-y-1 p-3">
              <p className="text-sm font-medium">{boxName(b)}</p>
              {(b.writeJob?.changes ?? []).map((c, i) => (
                <p key={`wait-${i}`} className="text-xs">
                  <span className="font-mono">{changeLabel(c)}</span>:{' '}
                  <span className="text-muted-foreground">
                    Waiting for the next run. ({c.by}, {formatDateTime(c.at)})
                  </span>
                </p>
              ))}
              {(b.writeResult?.results ?? []).map((r, i) => {
                const said = answerText(r);
                return (
                  <p key={`done-${i}`} className="text-xs">
                    <span className="font-mono">{changeLabel(r)}</span>:{' '}
                    <span className={TONE[said.tone]}>{said.text}</span>{' '}
                    <span className="text-muted-foreground">
                      ({r.by}, {formatDateTime(r.done)})
                    </span>
                  </p>
                );
              })}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
