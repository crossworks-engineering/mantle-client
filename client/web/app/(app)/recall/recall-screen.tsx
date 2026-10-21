'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'next/navigation';
import { Map as MapIcon } from 'lucide-react';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { recallScreenOf, recallV2Of } from '@/lib/recall-v2';
import { RecallV2Client, type RecallV2View } from './v2/recall-v2-client';

/**
 * The Recall screen, for a brain that says `features.recallV2` in /api/shell.
 * A brain older than that sends no `features` at all and gets a plain "needs
 * an update" state: the page-built (v1) screen it used to get was retired
 * with mantle R5. Branch on the capability, never on a version number.
 *
 * Reads the shell the app shell already fetched (same key; `staleTime:
 * Infinity` so this never adds a request of its own, but it still fetches if
 * the cache is somehow empty rather than spinning forever). It waits for the
 * answer rather than guessing, so the wrong state never flashes. A shell that
 * never answered reads as an older brain; a failed refetch keeps the answer it
 * had (see recallScreenOf).
 */
export function RecallScreen() {
  // The open map is the address (`/recall/<id>`); an old `?selected=` link
  // still opens it (and the pin moves it to the address). The rest are query
  // params: `view`, `card`, `q`, `page`.
  const routeId = useParams<{ id?: string }>().id;
  const sp = useSearchParams();
  const selected =
    (typeof routeId === 'string' ? decodeURIComponent(routeId) : null) ??
    (sp.get('selected')?.trim() || null);
  const view = sp.get('view')?.trim() || null;
  const card = sp.get('card')?.trim() || null;
  const q = sp.get('q')?.trim() || '';
  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1);
  const shell = useQuery({
    queryKey: ['shell'],
    queryFn: () => apiFetch<unknown>('/api/shell'),
    staleTime: Infinity,
    select: recallV2Of,
  });
  const v2 = recallScreenOf(shell);

  if (v2 === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (v2) {
    const v: RecallV2View = view === 'graph' || view === 'revisions' ? view : 'cards';
    return <RecallV2Client selected={selected} view={v} card={card} q={q} page={page} />;
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
      <MapIcon className="size-8 opacity-50" aria-hidden />
      <p className="font-medium text-foreground">This brain needs an update to use Recall</p>
      <p className="max-w-md">
        This version of the app edits Recall maps on brains with the current Recall. Update the
        brain, then open Recall again.
      </p>
    </div>
  );
}
