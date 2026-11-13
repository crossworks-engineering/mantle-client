'use client';

/**
 * A file's read-only database, seen by a person (docs/file-ingestion.md in the
 * mantle repo, "File databases"). Two views:
 *
 *  - FileDataView: one file's database in the whole content area, like a
 *    table in Tables: its tabs in the Tables tab bar (with row counts), each
 *    tab's rows in the Tables grid (read only, paged, sorted on the brain),
 *    and a Query tab with a highlighted SQL editor; or the words why it has
 *    no database. The tab is in the URL (`view=data&dbtab=`, or
 *    `view=query`), so a link opens it;
 *  - DataFilesView: every file with a database the login may read, in every
 *    folder, with its state.
 *
 * Both read the brain's answer of the `file_sql` tool, in the login's own
 * scope: a member sees exactly the files they can open by hand. Nothing here
 * writes. The shapes mirror @mantle/client-types (dto/file-databases.ts); the
 * pure parts are in file-data-model.ts.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { SortingState } from '@tanstack/react-table';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Database,
  Loader2,
  Play,
  Table2,
  TerminalSquare,
} from 'lucide-react';
import { ApiError, apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { CopyButton } from '@mantle/web-ui/ui/copy-button';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { KIND_TINT, describeFile } from '@mantle/web-ui/lib/mime-label';
import { cn } from '@mantle/web-ui/lib/utils';
import { TabBar, tabClass } from '@/components/table-grid/tab-bar';
import { fmtSize } from './files-shared';
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  QUERY_ROW_CAP,
  insertName,
  pageCount,
  pageSql,
  pageText,
  queryKey,
  quoted,
  readDbView,
  toGridDoc,
  withDbView,
  type Sort,
} from './file-data-model';

/** The Tables grid, loaded only when a database view opens: it carries
 *  TanStack Table and the grid's cell editors, too much for the Files screen
 *  to load up front. */
const TableGrid = dynamic(
  () => import('@/components/table-grid/table-grid').then((m) => m.TableGrid),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    ),
  },
);

/** The SQL editor (the Apps code editor, highlighted by the lowlight the
 *  client already ships), loaded only when the Query tab opens. */
const CodeEditor = dynamic(
  () => import('@mantle/web-ui/app-sandbox/code-editor').then((m) => m.CodeEditor),
  { ssr: false, loading: () => <div className="min-h-28 bg-card" aria-hidden /> },
);

/** The file types that get a database when they are read into the brain. */
const DATA_EXTS = new Set(['xlsx', 'xls', 'csv', 'xml', 'dwg', 'dxf', 'dgn', 'dwf']);

/** Whether a file of this extension can have a database. */
export function hasDataView(extension: string): boolean {
  return DATA_EXTS.has(extension.toLowerCase());
}

type Tab = {
  name: string;
  view: string;
  fts_table?: string;
  row_count: number;
  columns: { name: string; type: string }[];
};

type Answer =
  | {
      kind: 'describe';
      file_id: string;
      title: string;
      description?: string;
      tabs: Tab[];
      hint: string;
    }
  | {
      kind: 'rows';
      file_id: string;
      columns: string[];
      rows: unknown[][];
      row_count: number;
      duration_ms: number;
      truncated?: true;
      hint?: string;
    }
  | { kind: 'none'; file_id: string; reason: string };

type Rows = Extract<Answer, { kind: 'rows' }>;

type DataFileState = 'ready' | 'too-large' | 'no-rows' | 'unreadable' | 'not-built';

type DataFileRow = {
  id: string;
  parentPath: string;
  filename: string;
  extension: string;
  sizeBytes: number;
  updatedAt: string;
  database: { state: DataFileState; bytes: number | null };
};

const ask = (fileId: string, body: { sql?: string; max_rows?: number }) =>
  apiSend<Answer>(`/api/files/files/${fileId}/database`, 'POST', body);

const STATE_LABEL: Record<DataFileState, string> = {
  ready: 'Ready',
  'too-large': 'Too large',
  'no-rows': 'No rows',
  unreadable: 'Unreadable',
  'not-built': 'Not built yet',
};

function StatePill({ state }: { state: DataFileState }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-2 py-0.5 text-[11px]',
        state === 'ready'
          ? 'border-success-ink/40 bg-success/15 text-success-ink'
          : state === 'not-built'
            ? 'border-border bg-muted text-muted-foreground'
            : 'border-warning/40 bg-warning/10 text-warning-ink',
      )}
    >
      {STATE_LABEL[state]}
    </span>
  );
}

/** The grid never edits here: the viewer is read only. */
const noChange = () => {};

/** A finished empty, loading or error state in the middle of the area. */
function Notice({
  icon,
  title,
  body,
  error = false,
}: {
  icon: ReactNode;
  title: string;
  body?: string;
  error?: boolean;
}) {
  return (
    <div
      role={error ? 'alert' : undefined}
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
    >
      {icon}
      <p className={cn('max-w-md text-sm font-medium', error && 'text-destructive-ink')}>{title}</p>
      {body && <p className="max-w-md text-xs text-muted-foreground">{body}</p>}
    </div>
  );
}

const loadingIcon = <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />;
const errorIcon = <AlertTriangle className="size-5 text-destructive-ink" aria-hidden />;

/** The file a database was made from (its name and folder; a click opens
 *  it), what the database holds, and its id for an app. One thin row. */
function SourceBar({
  fileId,
  filename,
  folder,
  onOpenFile,
  tabCount,
  description,
}: {
  fileId: string;
  filename: string;
  folder: string;
  onOpenFile: () => void;
  tabCount: number | null;
  description?: string;
}) {
  const d = describeFile('', filename);
  const Icon = d.icon;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-1 text-xs">
      <span className="shrink-0 text-muted-foreground">Made from</span>
      <RowButton
        onClick={onOpenFile}
        title="Open the file"
        className="flex min-w-0 items-center gap-1.5 rounded px-1 hover:bg-muted/40"
      >
        <Icon aria-hidden className={`size-3.5 shrink-0 ${KIND_TINT[d.kind]}`} />
        <span className="truncate font-medium underline-offset-2 hover:underline">{filename}</span>
      </RowButton>
      <span className="shrink-0 text-muted-foreground">in</span>
      <span className="truncate font-mono text-muted-foreground" title={folder}>
        {folder}
      </span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground" title={description}>
        {description ? `· ${description}` : ''}
      </span>
      <span
        className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground"
        title="Apps read this database with file_sql and the file id."
      >
        {tabCount != null && (
          <span>
            {tabCount} tab{tabCount === 1 ? '' : 's'}, read only.
          </span>
        )}
        <CopyButton value={fileId} label="Copy id" ariaLabel="Copy the file id" />
      </span>
    </div>
  );
}

/** One file's database: its tabs and rows, a query tab, or why it has none.
 *  The file it was made from is named on top, in every state. It fills the
 *  content area beside the folder tree, as a table fills it in Tables. */
export function FileDataView({
  fileId,
  filename,
  folder,
  onOpenFile,
}: {
  fileId: string;
  filename: string;
  folder: string;
  onOpenFile: () => void;
}) {
  const described = useQuery({
    queryKey: ['files', 'database', fileId],
    queryFn: () => ask(fileId, {}),
    // New bytes give a new database: read it again each time the view opens.
    gcTime: 0,
  });
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const url = readDbView(params);
  const show = (query: boolean, tab: string | null) =>
    router.replace(`${pathname}?${withDbView(params, { on: true, query, tab })}`, {
      scroll: false,
    });

  const answer = described.data;
  const tabs = answer?.kind === 'describe' ? answer.tabs : [];
  const querying = url.on && url.query;
  const tab = tabs.find((t) => url.on && t.name === url.tab) ?? tabs[0] ?? null;

  let body: ReactNode;
  if (described.isPending) {
    body = <Notice icon={loadingIcon} title="Reading the database…" />;
  } else if (described.isError) {
    body = (
      <Notice
        error
        icon={errorIcon}
        title="Could not read the database."
        body={described.error instanceof ApiError ? described.error.message : undefined}
      />
    );
  } else if (answer?.kind === 'none') {
    body = (
      <Notice
        icon={<Database className="size-6 text-muted-foreground" aria-hidden />}
        title="This file has no database."
        body={answer.reason}
      />
    );
  } else if (answer?.kind === 'describe') {
    body = (
      <>
        <TabBar
          label="Database tabs"
          tabs={tabs.map((t) => ({ id: t.name, name: t.name, rows: t.row_count }))}
          activeTab={querying ? undefined : tab?.name}
          switching={false}
          readOnly
          counts
          onSwitch={(name) => show(false, name)}
          trailing={
            <RowButton
              role="tab"
              aria-selected={querying}
              onClick={() => show(true, tab?.name ?? null)}
              className={tabClass(querying)}
              title="Ask the database with one SELECT"
            >
              <TerminalSquare className="size-3.5" aria-hidden />
              Query
            </RowButton>
          }
        />
        {querying ? (
          <QueryPane key={fileId} fileId={fileId} tabs={tabs} firstView={tab?.view ?? null} />
        ) : tab ? (
          <TabPane key={tab.view} fileId={fileId} tab={tab} />
        ) : (
          <Notice
            icon={<Database className="size-6 text-muted-foreground" aria-hidden />}
            title="This database has no tabs."
          />
        )}
      </>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <SourceBar
        fileId={fileId}
        filename={filename}
        folder={folder}
        onOpenFile={onOpenFile}
        tabCount={answer?.kind === 'describe' ? tabs.length : null}
        description={answer?.kind === 'describe' ? answer.description : undefined}
      />
      {body}
    </div>
  );
}

/** One tab's rows, a page at a time, in the Tables grid. A sort asks the
 *  brain, so it orders every row of the tab, not just this page. */
function TabPane({ fileId, tab }: { fileId: string; tab: Tab }) {
  const [size, setSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(0);
  const [sorting, setSorting] = useState<SortingState>([]);
  const first = sorting[0];
  const sortName = first ? tab.columns[Number(first.id.slice(1))]?.name : undefined;
  const sort: Sort = first && sortName ? { column: sortName, desc: first.desc } : null;
  const pages = pageCount(tab.row_count, size);
  const offset = page * size;

  const got = useQuery({
    queryKey: ['files', 'database', fileId, 'page', tab.view, offset, size, sort],
    queryFn: async () => {
      const answer = await ask(fileId, {
        sql: pageSql(tab, { offset, size, sort }),
        max_rows: size,
      });
      if (answer.kind !== 'rows')
        throw new Error(answer.kind === 'none' ? answer.reason : 'No rows.');
      return answer;
    },
    placeholderData: keepPreviousData,
    gcTime: 0,
  });
  const types = useMemo(
    () => Object.fromEntries(tab.columns.map((c) => [c.name, c.type])),
    [tab.columns],
  );
  const doc = useMemo(
    () => (got.data ? toGridDoc(got.data.columns, got.data.rows, types) : null),
    [got.data, types],
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {got.isError ? (
        <Notice
          error
          icon={errorIcon}
          title="Could not read the rows."
          body={got.error instanceof Error ? got.error.message : undefined}
        />
      ) : !doc ? (
        <Notice icon={loadingIcon} title="Reading the rows…" />
      ) : (
        <div
          className={cn(
            'min-h-0 flex-1 overflow-hidden transition-opacity',
            got.isPlaceholderData && 'opacity-60',
          )}
        >
          <TableGrid
            doc={doc}
            onChange={noChange}
            readOnly
            viewer={{
              label: `${tab.name}: rows`,
              firstRowNumber: offset + 1,
              sorting,
              onSortingChange: (next) => {
                setSorting(next);
                setPage(0);
              },
            }}
          />
        </div>
      )}
      <Pager
        text={pageText(offset, got.data?.rows.length ?? 0, tab.row_count)}
        busy={got.isFetching}
        page={page}
        pages={pages}
        size={size}
        onPage={setPage}
        onSize={(next) => {
          setSize(next);
          setPage(0);
        }}
      />
    </div>
  );
}

/** "Rows 1 to 100 of 1,234", the page size, and first, back, next, last. */
function Pager({
  text,
  busy,
  page,
  pages,
  size,
  onPage,
  onSize,
}: {
  text: string;
  busy: boolean;
  page: number;
  pages: number;
  size: number;
  onPage: (page: number) => void;
  onSize: (size: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
      <span className="tabular-nums" aria-live="polite" data-testid="db-page-text">
        {text}
      </span>
      {busy && <Loader2 className="size-3.5 animate-spin" aria-label="Loading" />}
      <div className="ml-auto flex items-center gap-1">
        <span className="mr-1 hidden sm:inline">Rows per page</span>
        <Select value={String(size)} onValueChange={(v) => onSize(Number(v))}>
          <SelectTrigger size="xs" className="mr-2 w-20" aria-label="Rows per page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n.toLocaleString()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="First page"
          disabled={page === 0}
          onClick={() => onPage(0)}
        >
          <ChevronsLeft />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Previous page"
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft />
        </Button>
        <span className="px-1 tabular-nums">
          Page {(page + 1).toLocaleString()} of {pages.toLocaleString()}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Next page"
          disabled={page >= pages - 1}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Last page"
          disabled={page >= pages - 1}
          onClick={() => onPage(pages - 1)}
        >
          <ChevronsRight />
        </Button>
      </div>
    </div>
  );
}

/** This file's last query, kept for the browser session only. */
function savedQuery(fileId: string): string | null {
  try {
    return sessionStorage.getItem(queryKey(fileId));
  } catch {
    return null;
  }
}
function keepQuery(fileId: string, text: string) {
  try {
    sessionStorage.setItem(queryKey(fileId), text);
  } catch {
    // No storage (a private window): the query is simply not kept.
  }
}

/** A read-only SELECT over the file's database: a highlighted editor, the
 *  tabs and columns to click into it, and the result in the same grid. */
function QueryPane({
  fileId,
  tabs,
  firstView,
}: {
  fileId: string;
  tabs: Tab[];
  firstView: string | null;
}) {
  const [text, setText] = useState(
    () =>
      savedQuery(fileId) ??
      (firstView ? `SELECT *\nFROM ${quoted(firstView)}\nLIMIT 50` : 'SELECT 1'),
  );
  useEffect(() => keepQuery(fileId, text), [fileId, text]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Rows | null>(null);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  // A result column named as a tab's column takes its type (numbers sort as
  // numbers); any other is text.
  const types = useMemo(
    () => Object.fromEntries(tabs.flatMap((t) => t.columns.map((c) => [c.name, c.type]))),
    [tabs],
  );
  const doc = useMemo(
    () => (result ? toGridDoc(result.columns, result.rows, types) : null),
    [result, types],
  );

  const run = async () => {
    if (!text.trim() || running) return;
    setRunning(true);
    try {
      const got = await ask(fileId, { sql: text, max_rows: QUERY_ROW_CAP });
      if (got.kind === 'rows') {
        setResult(got);
        setError(null);
      } else {
        setResult(null);
        setError(got.kind === 'none' ? got.reason : 'The answer had no rows.');
      }
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : 'The query failed.');
    } finally {
      setRunning(false);
    }
  };

  /** Put a table or column name in the query at the caret. */
  const put = (name: string) => {
    const el = field.current;
    const next = insertName(
      text,
      el?.selectionStart ?? text.length,
      el?.selectionEnd ?? text.length,
      name,
    );
    setText(next.text);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = next.caret;
    });
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
      <nav
        aria-label="Tabs and columns"
        className="max-h-40 shrink-0 overflow-y-auto scrollbar-thin border-b border-border bg-muted/20 py-1 md:max-h-none md:w-60 md:border-r md:border-b-0"
      >
        <p className="px-3 pt-1 pb-1.5 text-xs text-muted-foreground">
          Click a name to put it in the query.
        </p>
        <ul>
          {tabs.map((t) => (
            <li key={t.view}>
              <RowButton
                onClick={() => put(t.view)}
                title={`Put ${quoted(t.view)} in the query`}
                className="flex w-full items-center gap-2 px-3 py-1 text-left text-sm font-medium hover:bg-muted/50"
              >
                <Table2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground">
                  {t.row_count.toLocaleString()}
                </span>
              </RowButton>
              <ul className="mb-1">
                {t.columns.map((c) => (
                  <li key={c.name}>
                    <RowButton
                      onClick={() => put(c.name)}
                      title={`Put ${quoted(c.name)} in the query`}
                      className="flex w-full items-center gap-2 py-0.5 pr-3 pl-8 text-left font-mono text-xs hover:bg-muted/50"
                    >
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{c.type}</span>
                    </RowButton>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border">
          <div
            className="max-h-[40vh] overflow-y-auto scrollbar-thin"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void run();
              }
            }}
            // Tab moves the focus out of the field, as in any form field: the
            // Apps editor's Tab-to-indent would trap a keyboard user here.
            onKeyDownCapture={(e) => {
              if (e.key === 'Tab') e.stopPropagation();
            }}
          >
            <CodeEditor
              path="query.sql"
              value={text}
              onChange={setText}
              ariaLabel="SQL query"
              textareaRef={field}
              className="min-h-28 overflow-visible"
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
            <Button size="xs" onClick={() => void run()} disabled={running || !text.trim()}>
              {running ? <Loader2 className="animate-spin" /> : <Play />}
              Run
            </Button>
            <span className="hidden sm:inline">
              <Kbd>Ctrl</Kbd> or <Kbd>⌘</Kbd> + <Kbd>Enter</Kbd>
            </span>
            <span>One SELECT, read only. Up to {QUERY_ROW_CAP.toLocaleString()} rows.</span>
            <span className="ml-auto tabular-nums" aria-live="polite" data-testid="db-query-meta">
              {result
                ? `${result.row_count.toLocaleString()} row${result.row_count === 1 ? '' : 's'} in ${result.duration_ms} ms`
                : ''}
            </span>
          </div>
        </div>
        {error ? (
          <div
            role="alert"
            className="m-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive-ink" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium text-destructive-ink">The query did not run.</p>
              <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">{error}</p>
            </div>
          </div>
        ) : doc && result ? (
          <>
            <div className="min-h-0 flex-1 overflow-hidden">
              <TableGrid
                doc={doc}
                onChange={noChange}
                readOnly
                viewer={{ label: 'Query result', firstRowNumber: 1 }}
              />
            </div>
            {result.truncated && (
              <p className="border-t border-border bg-warning/10 px-3 py-1.5 text-xs text-warning-ink">
                Cut at {result.row_count.toLocaleString()} rows. Narrow it with WHERE, or count with
                GROUP BY.
              </p>
            )}
          </>
        ) : (
          <Notice
            icon={<TerminalSquare className="size-6 text-muted-foreground" aria-hidden />}
            title="Run a query to see its rows here."
            body="Put names in double quotes. In a MATCH, put the words in double quotes too."
          />
        )}
      </div>
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-background px-1 font-sans text-[11px] text-foreground">
      {children}
    </kbd>
  );
}

/** Every file with a database the login may read: in every folder, or in
 *  `under` and its sub-folders. Each row names the file and its folder. */
export function DataFilesView({
  under,
  onOpen,
}: {
  under: string | null;
  onOpen: (file: DataFileRow) => void;
}) {
  const list = useQuery({
    queryKey: ['files', 'data-files', under ?? ''],
    queryFn: () =>
      apiFetch<{ files: DataFileRow[]; truncated: boolean }>(
        `/api/files/files?data=1${under ? `&under=${encodeURIComponent(under)}` : ''}`,
      ),
  });
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-border px-6 py-3">
        <h2 className="text-sm font-medium">Data files</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Spreadsheets, CSVs, plans and drawings that have a read-only database,{' '}
          {under ? (
            <>
              in <span className="font-mono">{under}</span> and its sub-folders
            </>
          ) : (
            'in every folder you can read'
          )}
          . Open one to see its tabs and rows.
        </p>
      </header>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {list.isPending ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : list.isError ? (
          <p className="px-6 py-10 text-center text-sm text-destructive-ink">
            {list.error instanceof ApiError ? list.error.message : 'Could not load the list.'}
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {list.data.files.map((f) => {
                const d = describeFile('', f.filename);
                const Icon = d.icon;
                return (
                  <li key={f.id}>
                    <RowButton
                      onClick={() => onOpen(f)}
                      className="flex w-full items-center gap-3 px-6 py-2 text-left hover:bg-muted/30"
                    >
                      <Icon aria-hidden className={`size-4 shrink-0 ${KIND_TINT[d.kind]}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{f.filename}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {f.parentPath}
                        </span>
                      </span>
                      <StatePill state={f.database.state} />
                      <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {f.database.bytes != null ? fmtSize(f.database.bytes) : ''}
                      </span>
                    </RowButton>
                  </li>
                );
              })}
            </ul>
            {list.data.files.length === 0 && (
              <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                No data files yet. Upload a spreadsheet, CSV or drawing.
              </div>
            )}
            {list.data.truncated && (
              <p className="px-6 py-3 text-xs text-muted-foreground">
                The list stopped at its limit. Open a folder, then Data files, to see the files in
                that folder.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
