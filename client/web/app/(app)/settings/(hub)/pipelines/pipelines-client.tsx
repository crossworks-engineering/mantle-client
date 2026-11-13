'use client';

import { useQuery } from '@tanstack/react-query';
import { ApiError, apiFetch } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@mantle/web-ui/ui/table';
import {
  COUNTS_PARTIAL,
  PIPELINE_STATE,
  PIPELINES_PATH,
  PIPELINES_TOO_OLD,
  countText,
  olderText,
  readsText,
  type PipelineList,
} from '@/lib/pipelines';

const tooOld = (err: unknown) => err instanceof ApiError && err.status === 404;

/**
 * Settings > Pipelines: one GET, no write. A brain before pipelines answers
 * 404 and gets one calm line, not an error.
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
  return <PipelinesList list={query.data} />;
}

/** The list itself, from one answer. Exported for its render test. */
export function PipelinesList({ list }: { list: PipelineList }) {
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
            <TableHead>State</TableHead>
            <TableHead className="text-right">Files</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.pipelines.map((p) => {
            const older = olderText(p.older);
            return (
              <TableRow key={p.id}>
                <TableCell>
                  <div className="font-medium">{p.name}</div>
                  {older && <div className="text-xs text-warning-ink">{older}</div>}
                </TableCell>
                <TableCell className="font-mono text-xs">{p.version}</TableCell>
                <TableCell className="text-muted-foreground">{readsText(p.reads)}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success-ink">
                    {PIPELINE_STATE}
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
