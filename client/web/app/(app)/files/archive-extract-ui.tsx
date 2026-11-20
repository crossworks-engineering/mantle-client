'use client';

/**
 * "Extract contents" in a file's Details (archive-extract.ts has the words).
 * The state is asked only for a name that may be an archive; a 404 is an
 * older brain (or a file this login cannot read) and nothing shows. While an
 * extraction is queued or running it asks again every few seconds (a plain
 * read). Person-started only: the button is the one way in.
 */
import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, PackageOpen } from 'lucide-react';
import { ApiError, apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { cn } from '@mantle/web-ui/lib/utils';
import { Button } from '@mantle/web-ui/ui/button';
import { useToast } from '@mantle/web-ui/ui/toast';
import {
  extractBusy,
  extractLine,
  extractPath,
  mayBeArchive,
  refusalWords,
  type ArchiveExtractAnswer,
} from './archive-extract';

const TONE = {
  ok: 'text-success-ink',
  warning: 'text-warning-ink',
  error: 'text-destructive-ink',
  muted: 'text-muted-foreground',
} as const;

export function useArchiveExtract(fileId: string | null, filename: string | undefined) {
  const on = !!fileId && mayBeArchive(filename);
  return useQuery({
    queryKey: ['files', 'extract', fileId],
    enabled: on,
    queryFn: async (): Promise<ArchiveExtractAnswer | null> => {
      try {
        return await apiFetch<ArchiveExtractAnswer>(extractPath(fileId!));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    retry: false,
    refetchInterval: (query) => (extractBusy(query.state.data?.extract) ? 3_000 : false),
  });
}

/** The Archive section of Details: the button, the progress, and the
 *  folder the contents went to. Nothing for a file that is no archive. */
export function ArchiveExtractSection({
  fileId,
  filename,
  canEdit,
  onNavigate,
}: {
  fileId: string;
  filename: string;
  /** The login may change the file (its edit right): the button shows. */
  canEdit: boolean;
  onNavigate: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useArchiveExtract(fileId, filename);
  const [asking, setAsking] = useState(false);
  const a = q.data;
  if (!a || !a.extractable) return null;

  const x = a.extract;
  const busy = extractBusy(x);
  const line = extractLine(x);
  const folderHref = x?.folder?.path ? `/files?path=${encodeURIComponent(x.folder.path)}` : null;

  const ask = async () => {
    setAsking(true);
    try {
      const answer = await apiSend<ArchiveExtractAnswer>(extractPath(fileId), 'POST', {});
      qc.setQueryData(['files', 'extract', fileId], answer);
      toast.success(`Extracting ${filename}. Its files go into a new folder beside it.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not start the extraction.');
    } finally {
      setAsking(false);
      // The new folder shows in the tree and the list ('files' holds the
      // Files page's tree, list and this extract state).
      void qc.invalidateQueries({ queryKey: ['files'] });
      void qc.invalidateQueries({ queryKey: ['tree', 'files'] });
    }
  };

  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <PackageOpen className="size-3.5" aria-hidden />
        Archive
      </h3>
      <p className="text-xs text-muted-foreground">
        Its contents are not read. Extract them to read each file as its own upload.
      </p>
      {line ? (
        <div className="space-y-0.5 text-xs" aria-live="polite">
          <p className={cn(TONE[line.tone])}>{line.text}</p>
          {line.more.map((m) => (
            <p key={m} className="text-muted-foreground">
              {m}
            </p>
          ))}
          {x && x.state === 'done' && x.refused.length > 0 ? (
            <ul className="max-h-32 space-y-0.5 overflow-auto scrollbar-thin text-muted-foreground">
              {x.refused.map((r) => (
                <li key={r.name} className="truncate" title={r.name}>
                  <span className="font-mono">{r.name}</span>: {refusalWords(r.reason)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {canEdit ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || asking}
            title="Unpack it into a new folder beside it; each file is read as an upload"
            onClick={() => void ask()}
          >
            <PackageOpen /> {x?.state === 'done' ? 'Extract again' : 'Extract contents'}
          </Button>
        ) : null}
        {folderHref && x?.state === 'done' ? (
          <Button size="sm" variant="ghost" asChild>
            <Link href={folderHref} onClick={onNavigate}>
              <FolderOpen /> Open folder
            </Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}
