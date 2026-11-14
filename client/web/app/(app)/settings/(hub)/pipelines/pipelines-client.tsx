'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiFetch } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@mantle/web-ui/ui/table';
import { cn } from '@mantle/web-ui/lib/utils';
import {
  COUNTS_PARTIAL,
  PIPELINE_STATE,
  PIPELINES_PATH,
  PIPELINES_TOO_OLD,
  attachText,
  countText,
  hasState,
  olderText,
  readsText,
  type PipelineList,
  type PipelineRow,
} from '@/lib/pipelines';
import { PipelineDetail } from './pipeline-detail';

const tooOld = (err: unknown) => err instanceof ApiError && err.status === 404;

/**
 * Settings > Pipelines: one GET for the list. A brain before pipelines
 * answers 404 and gets one calm line, not an error. A phase 1 brain (rows
 * with no `kind`) gets the list read only; a phase 2 brain's row opens its
 * detail under the list, where an Admin sets its options and workspaces and
 * tests it on one file.
 */
export function PipelinesClient() {
  const query = useQuery({
    queryKey: [PIPELINES_PATH],
    queryFn: () => apiFetch<PipelineList>(PIPELINES_PATH),
    retry: (count, err) => !tooOld(err) && count < 2,
  });
  if (query.isPending) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner />
      </div>
    );
  }
  if (query.isError) {
    const old = tooOld(query.error);
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center text-sm text-muted-foreground">
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

/** The list, and the open pipeline's detail under it. */
export function PipelinesScreen({ list }: { list: PipelineList }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = hasState(list);
  const open = rows?.find((r) => r.id === openId) ?? null;
  return (
    <div className="space-y-6">
      <PipelinesList list={list} openId={open?.id ?? null} onOpen={setOpenId} />
      {open && <PipelineDetail key={open.id} row={open} />}
    </div>
  );
}

/**
 * The list itself, from one answer. A phase 1 row is read only (State "On",
 * nothing to press); a phase 2 row's name opens its detail, and State says
 * where it is used. Exported for its render test.
 */
export function PipelinesList({
  list,
  openId = null,
  onOpen,
}: {
  list: PipelineList;
  openId?: string | null;
  onOpen?: (id: string | null) => void;
}) {
  const rows = hasState(list);
  const byId = new Map<string, PipelineRow>(rows?.map((r) => [r.id, r]) ?? []);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        A pipeline reads a file into its database when the file is uploaded.
      </p>
      {list.countsPartial && (
        <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          {COUNTS_PARTIAL}
        </p>
      )}
      <Table aria-label="Pipelines">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Reads</TableHead>
            <TableHead>{rows ? 'Used in' : 'State'}</TableHead>
            <TableHead className="text-right">Files</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.pipelines.map((p) => {
            const older = olderText(p.older);
            const row = byId.get(p.id);
            const isOpen = openId === p.id;
            return (
              <TableRow key={p.id} data-state={isOpen ? 'selected' : undefined}>
                <TableCell>
                  {row && onOpen ? (
                    <RowButton
                      className="rounded-sm font-medium hover:underline"
                      aria-expanded={isOpen}
                      onClick={() => onOpen(isOpen ? null : p.id)}
                    >
                      {p.name}
                    </RowButton>
                  ) : (
                    <div className="font-medium">{p.name}</div>
                  )}
                  {older && <div className="text-xs text-warning-ink">{older}</div>}
                </TableCell>
                <TableCell className="font-mono text-xs">{p.version}</TableCell>
                <TableCell className="text-muted-foreground">{readsText(p.reads)}</TableCell>
                <TableCell>
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                      row && row.workspaces !== 'all' && row.workspaces.length === 0
                        ? 'bg-muted text-muted-foreground'
                        : 'bg-success/15 text-success-ink',
                    )}
                  >
                    {row ? attachText(row) : PIPELINE_STATE}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{countText(p.files)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
