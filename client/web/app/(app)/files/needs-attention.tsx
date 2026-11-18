'use client';

/**
 * Needs attention (Files program P5): the files to read again, across every
 * folder. Three lists: an older read (a newer reader or Reader pipeline is
 * here), failed, and read in part, each with its total. Pick some, or take
 * every row shown, and Reindex runs the whole pipeline on them again.
 * GET /api/files/stale, 50 a page, "Load more" for the next.
 */
import { useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import { KIND_TINT, describeFile } from '@mantle/web-ui/lib/mime-label';
import { cn } from '@mantle/web-ui/lib/utils';
import { Button } from '@mantle/web-ui/ui/button';
import { Checkbox } from '@mantle/web-ui/ui/checkbox';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@mantle/web-ui/ui/tabs';
import { SetPageTitle } from '@/components/layout/page-title';
import { FileStatusBadge } from './file-status-badge';
import { ATTENTION_KEY, useReindex } from './file-reindex-ui';
import { ATTENTION_TABS, attentionHint, stalePath, type FileStaleState } from './file-reindex';
import { fmtRelative, fmtSize, type FileRow } from './files-shared';

type StaleAnswer = { files: FileRow[]; next: string | null; total: number };

const n = (x: number) => x.toLocaleString('en-GB');
const where = (path: string) => path.split('.').filter(Boolean).join(' / ');

/** One list's total, for a tab not shown (one row asked, the total comes
 *  with it). The tab shown takes the total from its own list. */
function useStaleTotal(state: FileStaleState, shown: FileStaleState): number | undefined {
  const q = useQuery({
    queryKey: [ATTENTION_KEY, 'count', state],
    queryFn: () => apiFetch<StaleAnswer>(stalePath(state, null, 1)),
    enabled: state !== shown,
    staleTime: 30_000,
    retry: false,
  });
  return q.data?.total;
}

/** The rows of every page, each file once (a file that moved between two
 *  pages while they loaded would come twice). */
function onceById(pages: readonly StaleAnswer[] | undefined): FileRow[] {
  const seen = new Set<string>();
  return (pages ?? [])
    .flatMap((p) => p.files)
    .filter((f) => {
      if (seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    });
}

export function NeedsAttentionView({
  initial = 'stale',
  onOpen,
}: {
  /** The list first shown (a "could not be read" push opens Failed). Read
   *  once: the caller keys the view on it, so a new push opens it anew. */
  initial?: FileStaleState;
  onOpen: (f: FileRow) => void;
}) {
  const qc = useQueryClient();
  const reindex = useReindex();
  const [state, setState] = useState<FileStaleState>(initial);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const totals: Record<FileStaleState, number | undefined> = {
    stale: useStaleTotal('stale', state),
    failed: useStaleTotal('failed', state),
    partial: useStaleTotal('partial', state),
  };
  const list = useInfiniteQuery({
    queryKey: [ATTENTION_KEY, 'list', state],
    queryFn: ({ pageParam }) => apiFetch<StaleAnswer>(stalePath(state, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
    staleTime: 30_000,
    retry: false,
  });
  const rows = onceById(list.data?.pages);
  totals[state] = list.data?.pages[0]?.total ?? totals[state];
  const tab = ATTENTION_TABS.find((t) => t.state === state)!;
  const pickedRows = rows.filter((f) => picked.has(f.id));

  const go = async (files: readonly FileRow[]) => {
    const out = await reindex.start(files);
    // A busy queue left some: keep them picked for a try again.
    if (out) setPicked(new Set(out.left.filter((id) => rows.some((f) => f.id === id))));
  };
  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SetPageTitle title="Needs attention" />
      <header className="space-y-3 border-b border-border px-6 py-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-medium">Needs attention</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Files to read again: read by an older reader, not read, or read in part. Reindex runs
              the whole pipeline on them again: text, embedding, facts and file database.
            </p>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Refresh the lists"
            title="Refresh the lists"
            onClick={() => {
              void qc.invalidateQueries({ queryKey: [ATTENTION_KEY, 'list'] });
              void qc.invalidateQueries({ queryKey: [ATTENTION_KEY, 'count'] });
            }}
          >
            <RefreshCw className={cn(list.isFetching && 'animate-spin')} />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            value={state}
            onValueChange={(v) => {
              setState(v as FileStaleState);
              setPicked(new Set());
            }}
          >
            <TabsList>
              {ATTENTION_TABS.map((t) => (
                <TabsTrigger key={t.state} value={t.state} className="gap-1.5">
                  {t.label}
                  {totals[t.state] !== undefined && (
                    <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
                      {n(totals[t.state]!)}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="ml-auto flex items-center gap-2">
            {pickedRows.length > 0 && (
              <Button size="sm" disabled={reindex.running} onClick={() => void go(pickedRows)}>
                <RefreshCw /> Reindex {n(pickedRows.length)} picked
              </Button>
            )}
            {rows.length > 0 && (
              <Button
                size="sm"
                variant={pickedRows.length > 0 ? 'outline' : 'default'}
                disabled={reindex.running}
                onClick={() => void go(rows)}
              >
                <RefreshCw /> Reindex all {n(rows.length)} shown
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <ul className="divide-y divide-border">
          {rows.map((f) => {
            const d = describeFile(f.mimeType, f.filename);
            const Icon = d.icon;
            const hint = attentionHint(f, state);
            return (
              <li key={f.id} className="flex items-center gap-3 px-6 hover:bg-muted/30">
                <Checkbox
                  checked={picked.has(f.id)}
                  onCheckedChange={(on) => toggle(f.id, on === true)}
                  aria-label={`Pick ${f.filename}`}
                />
                <RowButton
                  onClick={() => onOpen(f)}
                  className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left"
                >
                  <span className="relative inline-flex size-5 shrink-0 items-center justify-center">
                    <Icon aria-hidden className={cn('size-4', KIND_TINT[d.kind])} />
                    <FileStatusBadge status={f.status} extraction={f.extraction} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{f.filename}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {where(f.parentPath)}
                      {hint ? ` · ${hint}` : ''}
                    </span>
                  </span>
                  <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline">
                    {fmtSize(f.sizeBytes)}
                  </span>
                  <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">
                    {fmtRelative(f.updatedAt)}
                  </span>
                </RowButton>
              </li>
            );
          })}
        </ul>
        {list.isLoading && (
          <p className="flex items-center justify-center gap-2 px-6 py-10 text-sm text-muted-foreground">
            <Spinner size={14} /> Loading…
          </p>
        )}
        {list.isError && (
          <p className="px-6 py-10 text-center text-sm text-destructive-ink">
            Could not load the list. Try the refresh button.
          </p>
        )}
        {list.isSuccess && rows.length === 0 && (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">{tab.empty}</p>
        )}
        {list.hasNextPage && (
          <div className="flex justify-center px-6 py-3">
            <Button
              size="sm"
              variant="outline"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? <Spinner size={14} /> : null}
              Load more
              {totals[state] !== undefined ? ` (${n(rows.length)} of ${n(totals[state]!)})` : ''}
            </Button>
          </div>
        )}
      </div>
      {reindex.confirm}
    </div>
  );
}
