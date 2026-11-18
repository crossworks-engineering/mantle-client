'use client';

/**
 * Read files again (Files program P5): the hook every Reindex entry uses
 * (row menu, selection bar, tree menu, open file, Details, Needs attention),
 * and the route probe that hides the entries on an older brain.
 *
 * One file goes at once with a toast; many ask first (it runs the whole
 * pipeline and may use model credits). The answer shows in plain words
 * (file-reindex.ts). Person-started only: nothing here runs on its own.
 */
import { useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { useToast } from '@mantle/web-ui/ui/toast';
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
  reindexConfirmText,
  reindexText,
  sendReindex,
  type FileReindexAnswer,
  type ReindexOutcome,
} from './file-reindex';

/** The query key of the route probe, and of the Needs attention lists.
 *  Outside ['files'] on purpose: a live update of the folder list does not
 *  ask the brain for the stale counts again. */
export const ATTENTION_KEY = 'files-attention';

/**
 * Whether the brain has the P5 routes (GET /api/files/stale and POST
 * /api/files/reindex ship together). One small ask per session (limit 1).
 * true: yes; false: an older brain (404); undefined: not known yet.
 */
export function useAttentionRoute(): boolean | undefined {
  const q = useQuery({
    queryKey: [ATTENTION_KEY, 'route'],
    queryFn: async () => {
      try {
        await apiFetch('/api/files/stale?state=stale&limit=1');
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return false;
        throw err;
      }
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  return q.data;
}

type Target = { id: string; filename: string };

/**
 * `start(files)` reads them again: one at once, many after the confirm.
 * It resolves to the outcome (null: cancelled or failed), so a caller can
 * keep the files the busy queue left picked. Render `confirm` once.
 * `gone`: an older brain; hide the entries.
 */
export function useReindex(): {
  gone: boolean;
  running: boolean;
  start: (files: readonly Target[]) => Promise<ReindexOutcome | null>;
  confirm: ReactNode;
} {
  const qc = useQueryClient();
  const toast = useToast();
  const route = useAttentionRoute();
  const [running, setRunning] = useState(false);
  const [ask, setAsk] = useState<Target[] | null>(null);
  const answer = useRef<((o: ReindexOutcome | null) => void) | null>(null);

  const run = async (files: readonly Target[]): Promise<ReindexOutcome | null> => {
    setRunning(true);
    try {
      const out = await sendReindex(
        files.map((f) => f.id),
        (path, body) => apiSend<FileReindexAnswer>(path, 'POST', body),
      );
      const t = reindexText(out, files.length === 1 ? files[0]!.filename : undefined);
      toast[t.tone](t.message);
      // Rows show the job (waiting) at once; the lists and counts follow.
      void qc.invalidateQueries({ queryKey: ['files'] });
      void qc.invalidateQueries({ queryKey: ['tree', 'files'] });
      void qc.invalidateQueries({ queryKey: [ATTENTION_KEY, 'list'] });
      void qc.invalidateQueries({ queryKey: [ATTENTION_KEY, 'count'] });
      return out;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        qc.setQueryData([ATTENTION_KEY, 'route'], false);
        toast.error('This brain cannot read files again yet. Update it first.');
      } else {
        toast.error(err instanceof ApiError ? err.message : 'Could not queue the files.');
      }
      return null;
    } finally {
      setRunning(false);
    }
  };

  const start = (files: readonly Target[]): Promise<ReindexOutcome | null> => {
    if (files.length === 0) return Promise.resolve(null);
    if (files.length === 1) return run(files);
    answer.current?.(null);
    return new Promise((resolve) => {
      answer.current = resolve;
      setAsk([...files]);
    });
  };

  const settle = (o: ReindexOutcome | null) => {
    const r = answer.current;
    answer.current = null;
    r?.(o);
  };

  const words = ask ? reindexConfirmText(ask.length) : null;
  const confirm = (
    <AlertDialog
      open={!!ask}
      onOpenChange={(open) => {
        if (open) return;
        setAsk(null);
        settle(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{words?.title}</AlertDialogTitle>
          <AlertDialogDescription>{words?.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const files = ask ?? [];
              const r = answer.current;
              answer.current = null;
              setAsk(null);
              void run(files).then((o) => r?.(o));
            }}
          >
            {words?.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { gone: route === false, running, start, confirm };
}
