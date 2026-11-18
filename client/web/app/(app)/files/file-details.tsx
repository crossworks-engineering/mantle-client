'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Brain,
  FileText,
  History,
  Image as ImageIcon,
  Loader2,
  NotebookPen,
  Shapes,
  Table2,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { apiFetch, ApiError } from '@mantle/web-ui/api-fetch';
import { describeFile, fileTypeLabel, KIND_TINT } from '@mantle/web-ui/lib/mime-label';
import { cn } from '@mantle/web-ui/lib/utils';
import { Button } from '@mantle/web-ui/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@mantle/web-ui/ui/sheet';
import { StatusIcon } from './file-status-badge';
import {
  derivedHref,
  derivedNoun,
  detailsView,
  type DetailRow,
  type DetailTone,
  type FileDerivedItem,
  type FileProcessing,
} from './file-status';

/** A row the caller already knows (Access, or the basic info an older brain
 *  without the processing route still shows). */
export type DetailsExtraRow = { label: string; value: ReactNode };

/** The rows the sheet shows on a brain without the processing route:
 *  where the file is and its type, from what the caller has of it. No
 *  Location row when the caller does not know the folder. */
export function detailsFallback(file: {
  filename: string;
  parentPath?: string | null;
  mimeType?: string | null;
}): DetailsExtraRow[] {
  const rows: DetailsExtraRow[] = [];
  if (typeof file.parentPath === 'string') {
    rows.push({
      label: 'Location',
      value: file.parentPath.split('.').filter(Boolean).join(' / ') || 'Top level',
    });
  }
  rows.push({ label: 'Type', value: fileTypeLabel(file.mimeType, file.filename) });
  return rows;
}

/**
 * GET /api/files/files/:id/processing. `gone`: the brain answered 404 (a
 * brain before P4, or a file this login cannot read): the panel falls back
 * to what the caller knows. While a job is queued or running it asks again
 * every few seconds (a plain read, no model run).
 */
export function useFileProcessing(fileId: string | null) {
  const q = useQuery({
    queryKey: ['files', 'processing', fileId],
    enabled: !!fileId,
    queryFn: () => apiFetch<FileProcessing>(`/api/files/files/${fileId}/processing`),
    retry: (n, err) => !(err instanceof ApiError && err.status === 404) && n < 2,
    refetchInterval: (query) => (query.state.data?.job ? 5_000 : false),
  });
  const gone = q.error instanceof ApiError && q.error.status === 404;
  return { ...q, gone };
}

const TONE: Record<DetailTone, string> = {
  ok: 'text-success-ink',
  warning: 'text-warning-ink',
  error: 'text-destructive-ink',
  muted: 'text-muted-foreground',
};

const KIND_ICON: Record<string, LucideIcon> = {
  file: ImageIcon,
  table: Table2,
  page: FileText,
  note: NotebookPen,
};

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: (DetailRow | DetailsExtraRow)[] }) {
  return (
    <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd
            className={cn(
              'min-w-0 break-words text-foreground',
              'tone' in r && r.tone ? TONE[r.tone] : null,
            )}
          >
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function DerivedList({
  items,
  more,
  onNavigate,
}: {
  items: FileDerivedItem[];
  more: boolean;
  onNavigate: () => void;
}) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">Nothing was made from this file.</p>;
  }
  return (
    <ul className="max-h-72 space-y-0.5 overflow-auto scrollbar-thin">
      {items.map((d) => {
        const Icon = KIND_ICON[d.kind] ?? Shapes;
        return (
          <li key={d.id}>
            <Link
              href={derivedHref(d)}
              onClick={onNavigate}
              className="flex min-w-0 items-center gap-2 rounded-sm px-1.5 py-1 text-xs hover:bg-muted"
              title={`${derivedNoun(d.kind)} in ${d.path.split('.').join(' / ') || 'the top level'}`}
            >
              <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{d.title || 'Untitled'}</span>
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                {derivedNoun(d.kind)}
              </span>
            </Link>
          </li>
        );
      })}
      {more ? <li className="px-1.5 py-1 text-xs text-muted-foreground">and more</li> : null}
    </ul>
  );
}

function Body({
  p,
  extra,
  onNavigate,
}: {
  p: FileProcessing;
  extra: DetailsExtraRow[];
  onNavigate: () => void;
}) {
  const v = detailsView(p);
  const location = p.file.parentPath.split('.').filter(Boolean).join(' / ') || 'Top level';
  return (
    <div className="space-y-5">
      {v.badge ? (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-2.5 text-xs">
          <StatusIcon kind={v.badge.kind} className="mt-0.5 size-4" />
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium text-foreground">{v.badge.title}</p>
            {v.badge.lines.map((l) => (
              <p key={l} className="text-muted-foreground">
                {l}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {v.problem ? (
        <div
          role="note"
          className="flex items-start gap-2 rounded-md bg-destructive/10 p-2.5 text-xs text-destructive-ink"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <div className="space-y-0.5">
            <p className="font-medium">{v.problem.reason}</p>
            {v.problem.hint ? <p>{v.problem.hint}</p> : null}
          </div>
        </div>
      ) : null}

      <Section title="File">
        <Rows
          rows={[
            { label: 'Location', value: location },
            { label: 'Type', value: fileTypeLabel(p.file.mimeType, p.file.filename) },
            ...v.file,
            ...extra,
          ]}
        />
      </Section>

      <Section title="In the brain" icon={Brain}>
        <Rows rows={v.brain} />
      </Section>

      {v.pipeline ? (
        <Section title="Pipeline" icon={Workflow}>
          <Rows rows={v.pipeline.rows} />
          {v.pipeline.tables.length > 0 ? (
            <ul className="space-y-0.5 pt-1 text-xs">
              {v.pipeline.tables.map((t) => (
                <li key={t.name} className="flex items-center gap-2">
                  <Table2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-mono">{t.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{t.rows}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
      ) : null}

      <Section
        title={`Where it went${v.derived.items.length ? ` (${v.derived.items.length}${v.derived.more ? '+' : ''})` : ''}`}
      >
        <DerivedList items={v.derived.items} more={v.derived.more} onNavigate={onNavigate} />
      </Section>
    </div>
  );
}

/**
 * The Details panel of one file (Files program P4): what it is, what the
 * brain holds of it, the pipeline that read it, and where its content went.
 * A side sheet, so the list, the tree and the open file share one panel.
 */
export function FileDetailsSheet({
  fileId,
  filename,
  fallback = [],
  extra = [],
  onHistory,
  onOpenChange,
}: {
  /** The file to show; null = closed. */
  fileId: string | null;
  /** Its name while the answer loads. */
  filename?: string;
  /** What to show when the brain has no processing route (404). */
  fallback?: DetailsExtraRow[];
  /** Rows only the caller knows (Access). */
  extra?: DetailsExtraRow[];
  /** Opens the file's History sheet; none from a brain before file history. */
  onHistory?: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const q = useFileProcessing(fileId);
  const name = q.data?.file.filename ?? filename ?? 'File';
  const d = describeFile(q.data?.file.mimeType ?? null, name);
  const TypeIcon = d.icon;
  const close = () => onOpenChange(false);

  let body: ReactNode;
  if (q.data) {
    body = <Body p={q.data} extra={extra} onNavigate={close} />;
  } else if (q.gone) {
    body = (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          This brain does not report how the file was processed yet.
        </p>
        {fallback.length + extra.length > 0 ? <Rows rows={[...fallback, ...extra]} /> : null}
      </div>
    );
  } else if (q.isError) {
    body = (
      <p className="flex items-start gap-2 text-xs text-destructive-ink">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Could not load the details.
        {q.error instanceof Error && q.error.message ? ` ${q.error.message}` : ''}
      </p>
    );
  } else {
    body = (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading the details…
      </p>
    );
  }

  return (
    <Sheet open={!!fileId} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-4 overflow-y-auto scrollbar-thin sm:max-w-md"
      >
        <div className="flex min-w-0 items-center gap-2 pr-8">
          <TypeIcon className={cn('size-5 shrink-0', KIND_TINT[d.kind])} aria-hidden />
          <div className="min-w-0">
            <SheetTitle className="truncate text-base">{name}</SheetTitle>
            <SheetDescription className="text-xs">Details</SheetDescription>
          </div>
          {onHistory ? (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto shrink-0"
              onClick={() => {
                close();
                onHistory();
              }}
            >
              <History /> History
            </Button>
          ) : null}
        </div>
        {body}
      </SheetContent>
    </Sheet>
  );
}
