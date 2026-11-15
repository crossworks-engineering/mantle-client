'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Bot, FileInput, Shuffle, Split, Workflow, type LucideIcon } from 'lucide-react';
import { ApiError, apiFetch } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import {
  ListCard,
  ListCardMeta,
  ListCardSnippet,
  ListCardTitle,
} from '@mantle/web-ui/ui/list-card';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { cn } from '@mantle/web-ui/lib/utils';
import { HeaderInfoButton, HeaderPill, ItemHeader } from '@/components/layout/item-header';
import { ListSearchBar, ListSearchEmpty, useListQuery } from '@/components/list-search';
import {
  COUNTS_PARTIAL,
  PIPELINE_STATE,
  PIPELINES_PATH,
  PIPELINES_TOO_OLD,
  canChange,
  countText,
  filterPipelines,
  hasState,
  offInOf,
  olderText,
  readsText,
  roleWord,
  statsOf,
  usedInText,
  type PipelineList,
  type PipelineRow,
  type PipelineRowV1,
} from '@/lib/pipelines';
import { PipelineDetail } from './pipeline-detail';

const tooOld = (err: unknown) => err instanceof ApiError && err.status === 404;

/** What a pipeline does, said once: the quiet first line of the plain detail. */
const PIPELINE_LINE = 'A pipeline reads a file into its database when the file is uploaded.';

/**
 * Settings > Pipelines: one GET for the list. A brain before pipelines
 * answers 404 and gets one calm line, not an error. The list is a card per
 * pipeline; the open card's detail sits on the right, where an Admin sets a
 * reader's or a Transformer's options, switches it off in a workspace, and
 * tests it on one file. A router, and a phase 1 brain's row (no `kind`),
 * show their facts only.
 */
export function PipelinesClient() {
  const query = useQuery({
    queryKey: [PIPELINES_PATH],
    queryFn: () => apiFetch<PipelineList>(PIPELINES_PATH),
    retry: (count, err) => !tooOld(err) && count < 2,
  });
  if (query.isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (query.isError) {
    const old = tooOld(query.error);
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
        <p>{old ? PIPELINES_TOO_OLD : 'Could not load the pipelines.'}</p>
        {!old && (
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            Retry
          </Button>
        )}
      </div>
    );
  }
  return <PipelinesScreen list={query.data} />;
}

/** The icon and the pill tone of each role; a kind with none is plain. */
const ROLE_ICON: Readonly<Record<string, LucideIcon>> = {
  router: Split,
  reader: FileInput,
  after: Shuffle,
  agent: Bot,
};
const ROLE_TONE: Readonly<Record<string, string>> = {
  router: 'border-info/50 text-info-ink',
  reader: 'border-primary/50 text-primary-ink',
  after: 'border-success/50 text-success-ink',
  agent: 'border-foreground/30 text-foreground',
};
const PLAIN_TONE = 'border-muted-foreground/40 text-muted-foreground';

const kindOf = (p: PipelineRowV1): string | undefined =>
  'kind' in p ? (p as { kind?: string }).kind : undefined;

function RoleIcon({ kind }: { kind: string | undefined }) {
  const Icon = (kind && Object.hasOwn(ROLE_ICON, kind) && ROLE_ICON[kind]) || Workflow;
  return <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
}

/** The role in a pill: Router, Reader, Transformer, Agent. None for a phase
 *  1 row, which has no `kind`. */
function RolePill({ kind, className }: { kind: string | undefined; className?: string }) {
  if (!kind) return null;
  return (
    <span
      data-role={kind}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4',
        (Object.hasOwn(ROLE_TONE, kind) && ROLE_TONE[kind]) || PLAIN_TONE,
        className,
      )}
    >
      {roleWord(kind)}
    </span>
  );
}

/** "12 files"; a dash alone when the count is not known, as the detail
 *  shows it; nothing for a row that has no files of its own (a router). */
function filesText(p: PipelineRowV1, row: PipelineRow | undefined): string | null {
  if (p.files === null) return row && !canChange(row) ? null : countText(null);
  return p.files === 1 ? '1 file' : `${countText(p.files)} files`;
}

/** The list on the left, the open pipeline on the right. */
export function PipelinesScreen({ list }: { list: PipelineList }) {
  const rows = hasState(list);
  const byId = useMemo(
    () => new Map<string, PipelineRow>(rows?.map((r) => [r.id, r]) ?? []),
    [rows],
  );
  const search = useListQuery();
  const shown = useMemo(
    () => filterPipelines(list.pipelines, search.query),
    [list.pipelines, search.query],
  );
  // Deep link: ?selected=<id> preselects that pipeline (initial state only,
  // as Peers does); else the first one is open from the start, so a search
  // never moves the open pipeline (and its unsaved edits), as Tools does.
  // `shown[0]` only covers a picked row that has gone from the list.
  const searchParams = useSearchParams();
  const [pickedId, setPickedId] = useState<string | null>(() => {
    const want = searchParams.get('selected')?.trim();
    return want && list.pipelines.some((p) => p.id === want)
      ? want
      : (list.pipelines[0]?.id ?? null);
  });
  const open = list.pipelines.find((p) => p.id === pickedId) ?? shown[0] ?? null;

  return (
    <MasterDetail
      id="settings-pipelines"
      // No `detailFills`: the detail is a form, and the 672px default measure
      // keeps it off 1200px line lengths (§8).
      list={
        <>
          <ListSearchBar
            query={search.query}
            onQuery={search.setQuery}
            inputRef={search.inputRef}
            placeholder="Search pipelines…"
            shown={shown.length}
            total={list.pipelines.length}
            noun={['pipeline', 'pipelines']}
          />
          {list.countsPartial && (
            <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
              {COUNTS_PARTIAL}
            </p>
          )}
          <div className="space-y-2 p-3 md:min-h-0 md:flex-1 md:overflow-y-auto md:scrollbar-thin">
            {list.pipelines.length === 0 ? (
              <p className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
                No pipelines on this box.
              </p>
            ) : shown.length === 0 ? (
              <ListSearchEmpty noun="pipelines" onClear={search.clear} />
            ) : (
              shown.map((p) => (
                <PipelineCard
                  key={p.id}
                  p={p}
                  row={byId.get(p.id)}
                  selected={open?.id === p.id}
                  onClick={() => setPickedId(p.id)}
                />
              ))
            )}
          </div>
        </>
      }
      detail={
        open ? (
          <div>
            <ItemHeader
              sticky
              visual={<RoleIcon kind={kindOf(open)} />}
              title={open.name}
              badges={<RolePill kind={kindOf(open)} />}
              iconActions={
                <HeaderInfoButton label="About this pipeline">
                  <p className="break-all font-mono text-xs">{open.id}</p>
                  <p className="text-xs text-muted-foreground">{PIPELINE_LINE}</p>
                </HeaderInfoButton>
              }
            />
            <div className="space-y-6 p-6">
              {byId.get(open.id) ? (
                <PipelineDetail key={open.id} row={byId.get(open.id)!} />
              ) : (
                <PlainDetail p={open} />
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-10 text-center text-sm text-muted-foreground">
            {PIPELINE_LINE}
          </div>
        )
      }
    />
  );
}

/**
 * One pipeline's card: its role icon, name and role pill; the version, what
 * it reads and its files; "Off in N" and the older line when they hold; the
 * description.
 */
function PipelineCard({
  p,
  row,
  selected = false,
  onClick,
}: {
  p: PipelineRowV1;
  /** The phase 2 row; undefined on a phase 1 brain. */
  row?: PipelineRow;
  selected?: boolean;
  onClick?: () => void;
}) {
  const kind = kindOf(p);
  const files = filesText(p, row);
  const older = olderText(p.older);
  const off = row && canChange(row) && offInOf(row).length > 0 ? usedInText(row) : null;
  const description = statsOf(p)?.description;
  return (
    <ListCard selected={selected} onClick={onClick}>
      <div className="flex items-center gap-2">
        <RoleIcon kind={kind} />
        <ListCardTitle>{p.name}</ListCardTitle>
        <RolePill kind={kind} className="ml-auto" />
      </div>
      <ListCardMeta>
        <span className="font-mono">{p.version}</span>
        {' · '}
        {readsText(p.reads)}
        {files && ` · ${files}`}
      </ListCardMeta>
      {description && <ListCardSnippet>{description}</ListCardSnippet>}
      {(off || older) && (
        <div className="mt-1.5 flex items-center gap-2 text-xs">
          {off && <HeaderPill>{off}</HeaderPill>}
          {older && <span className="min-w-0 truncate text-warning-ink">{older}</span>}
        </div>
      )}
    </ListCard>
  );
}

/** A phase 1 brain's row: its plain facts, read only. */
function PlainDetail({ p }: { p: PipelineRowV1 }) {
  const older = olderText(p.older);
  return (
    <section aria-label="Overview" className="space-y-4 text-sm">
      <p className="text-muted-foreground">{PIPELINE_LINE}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="text-muted-foreground">Version</dt>
        <dd className="font-mono text-xs leading-5">{p.version}</dd>
        <dt className="text-muted-foreground">Reads</dt>
        <dd>{readsText(p.reads)}</dd>
        <dt className="text-muted-foreground">Files</dt>
        <dd className="tabular-nums">{countText(p.files)}</dd>
        <dt className="text-muted-foreground">State</dt>
        <dd>{PIPELINE_STATE}</dd>
      </dl>
      {older && <p className="text-warning-ink">{older}</p>}
    </section>
  );
}
