'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { KIND_TINT, describeFile } from '@mantle/web-ui/lib/mime-label';
import { SetPageTitle } from '@/components/layout/page-title';
import { ExtractionBadge } from './extraction-badge';
import { fmtRelative, fmtSize, type FileRow } from './files-shared';

type ListAnswer = { files: FileRow[]; truncated?: boolean };

/** The files whose content was not read, or read in part, across every
 *  folder (task 8d40932a): the brain's `?extraction=` lists. Where an admin's
 *  "a file could not be read" push lands. */
export function UnreadFilesView({ onOpen }: { onOpen: (f: FileRow) => void }) {
  const failed = useQuery({
    queryKey: ['files', 'extraction', 'failed'],
    queryFn: () => apiFetch<ListAnswer>('/api/files/files?extraction=failed'),
  });
  const partial = useQuery({
    queryKey: ['files', 'extraction', 'partial'],
    queryFn: () => apiFetch<ListAnswer>('/api/files/files?extraction=partial'),
  });
  const rows = [...(failed.data?.files ?? []), ...(partial.data?.files ?? [])];
  const done = !failed.isLoading && !partial.isLoading;
  const gone = failed.isError || partial.isError;
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SetPageTitle title="Not read" />
      <header className="border-b border-border px-6 py-3">
        <h2 className="text-sm font-medium">Not read</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Files whose content the brain could not read, or read in part. Their missing content is
          not in search. Hover a badge for what to do.
        </p>
      </header>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <ul className="divide-y divide-border">
          {rows.map((f) => {
            const d = describeFile(f.mimeType, f.filename);
            const Icon = d.icon;
            return (
              <li key={f.id}>
                <RowButton
                  onClick={() => onOpen(f)}
                  className="flex w-full items-center gap-3 px-6 py-2 text-left hover:bg-muted/30"
                >
                  <Icon aria-hidden className={`size-4 shrink-0 ${KIND_TINT[d.kind]}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium">{f.filename}</span>
                      <ExtractionBadge x={f.extraction} />
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {f.extraction?.hint ?? f.parentPath}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
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
        {done && rows.length === 0 && (
          <div className="px-6 py-10 text-center text-sm text-muted-foreground">
            {gone
              ? 'This brain cannot list them yet: update it to see which files were not read.'
              : 'Every file was read.'}
          </div>
        )}
        {(failed.data?.truncated || partial.data?.truncated) && (
          <p className="px-6 py-3 text-xs text-muted-foreground">
            The list shows the newest files only.
          </p>
        )}
      </div>
    </div>
  );
}
