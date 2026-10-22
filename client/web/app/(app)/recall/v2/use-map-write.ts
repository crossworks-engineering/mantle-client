'use client';

import { useCallback, useState } from 'react';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import type {
  RecallCardDetailDTO,
  RecallMapDetailDTO,
  RecallRevisionDTO,
  RecallWarningDTO,
  RecallWriteResultDTO,
} from '@mantle/web-ui/types/recall-v2';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import { useToast } from '@mantle/web-ui/ui/toast';
import { treeKey } from '@/components/item-tree/tree-api';
import { isStale, recallKeys, writeErrorText } from '@/lib/recall-v2';

/** One map's detail, as every v2 view reads it. */
export function mapQuery(mapId: string) {
  return queryOptions({
    queryKey: recallKeys.map(mapId),
    queryFn: () =>
      apiFetch<{ map: RecallMapDetailDTO }>(`/api/recall/maps/${mapId}`).then((r) => r.map),
  });
}

/** The map's write log, newest first: the Revisions view, and each card's
 *  history in the inspector (the same query, so they never disagree). */
export function revisionsQuery(mapId: string) {
  return queryOptions({
    queryKey: recallKeys.revisions(mapId),
    queryFn: () =>
      apiFetch<{ revisions: RecallRevisionDTO[] }>(`/api/recall/maps/${mapId}/revisions`).then(
        (r) => r.revisions,
      ),
  });
}

/** One card with its body. */
export function cardQuery(mapId: string, slug: string) {
  return queryOptions({
    queryKey: recallKeys.card(mapId, slug),
    queryFn: () =>
      apiFetch<{ card: RecallCardDetailDTO }>(`/api/recall/maps/${mapId}/cards/${slug}`).then(
        (r) => r.card,
      ),
  });
}

export type RunOptions = {
  /** Send this version instead of the map's cached one. The card editor
   *  sends the version its edit started from, so a change made under it is
   *  refused rather than overwritten. */
  version?: number;
  /** Handle a refusal here instead of the default toast. The map is still
   *  refreshed on a stale version. */
  onError?: (err: unknown) => void;
  /** Record the write in `chain` (default true). Off for a write that does
   *  not send the version it was given (a restore reads the map's own). */
  track?: boolean;
};

/**
 * Every write to a native map goes through here, because every write has the
 * same obligations:
 *
 * 1. Send a version. By default the map's CURRENT one, read from the cache at
 *    call time rather than captured at render, so two quick writes in a row
 *    do not send the same version twice and refuse each other.
 * 2. Carry the version the brain answers with into the cache straight away,
 *    for the same reason, then refresh the catalog, the map and its log.
 * 3. On a stale version (another tab, or an agent: v2 serves an agent's card
 *    edit at once), reload the map and say so. Never retry: the owner has to
 *    see what changed before re-applying.
 *
 * `chain` records each of this tab's own writes (the version sent, and the
 * one it got back), so the card editor can tell the owner's own publish or
 * reorder apart from an agent's write. `warnings` holds the last write's
 * advisory warnings (an orphan card, an entry card with no options); they
 * never block, and the workbench shows them.
 */
export function useMapWrite(mapId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [warnings, setWarnings] = useState<RecallWarningDTO[]>([]);
  const [chain, setChain] = useState<Readonly<Record<number, number>>>({});

  // The catalog, the map, its cards and log, and the item tree (a publish
  // changes a row's draft pill, a rename its title).
  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: recallKeys.maps });
    void qc.invalidateQueries({ queryKey: treeKey('recall') });
  }, [qc]);

  /** Run one write. Resolves to the result, or null when it was refused (the
   *  refusal has already been shown, or handed to `onError`). `failText` is
   *  the fallback line when the brain sent no sentence of its own. */
  const run = useCallback(
    async <R extends Partial<RecallWriteResultDTO>>(
      write: (version: number) => Promise<R>,
      failText: string,
      opts: RunOptions = {},
    ): Promise<R | null> => {
      const version =
        opts.version ?? qc.getQueryData<RecallMapDetailDTO>(recallKeys.map(mapId))?.version ?? null;
      if (version === null) {
        toast.error('This map has not loaded yet.');
        return null;
      }
      setPending(true);
      try {
        const result = await write(version);
        if (typeof result.version === 'number') {
          const v = result.version;
          qc.setQueryData<RecallMapDetailDTO>(recallKeys.map(mapId), (m) =>
            m && m.version < v ? { ...m, version: v } : m,
          );
          if (opts.track !== false) setChain((c) => ({ ...c, [version]: v }));
        }
        setWarnings(result.warnings ?? []);
        refresh();
        return result;
      } catch (err) {
        if (opts.onError) opts.onError(err);
        else toast.error(writeErrorText(err, failText));
        if (isStale(err)) refresh();
        return null;
      } finally {
        setPending(false);
      }
    },
    [qc, mapId, refresh, toast],
  );

  const clearWarnings = useCallback(() => setWarnings([]), []);

  return { run, pending, warnings, clearWarnings, chain };
}

export type MapWrite = ReturnType<typeof useMapWrite>;
