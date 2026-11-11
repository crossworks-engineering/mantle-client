'use client';

/**
 * A file's read-only database, seen by a person (docs/file-ingestion.md in the
 * mantle repo, "File databases"). Two views:
 *
 *  - FileDataView: one file's tabs, columns, row counts and first rows, a
 *    read-only SQL box, or the words why it has no database;
 *  - DataFilesView: every file with a database the login may read, in every
 *    folder, with its state.
 *
 * Both read the brain's answer of the `file_sql` tool, in the login's own
 * scope: a member sees exactly the files they can open by hand. Nothing here
 * writes. The shapes mirror @mantle/client-types (dto/file-databases.ts).
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Database, Loader2, Play } from 'lucide-react';
import { ApiError, apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { CopyButton } from '@mantle/web-ui/ui/copy-button';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Textarea } from '@mantle/web-ui/ui/textarea';
import { KIND_TINT, describeFile } from '@mantle/web-ui/lib/mime-label';
import { cn } from '@mantle/web-ui/lib/utils';
import { fmtSize } from './files-shared';

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

const PAGE = 100;

const ask = (fileId: string, body: { sql?: string; max_rows?: number }) =>
  apiSend<Answer>(`/api/files/files/${fileId}/database`, 'POST', body);

/** A name in double quotes, as SQLite reads it. */
const quoted = (name: string) => `"${name.replace(/"/g, '""')}"`;

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

/** A cell as text: null stays visible as an empty mark. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Columns and rows, read only, with a sticky header. */
function ResultTable({ columns, rows }: { columns: string[]; rows: unknown[][] }) {
  if (columns.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No columns.</p>;
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
      <table className="w-max min-w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-muted">
          <tr>
            {columns.map((c, i) => (
              <th
                key={`${i}-${c}`}
                className="border-b border-r border-border px-2 py-1.5 text-left font-medium"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="hover:bg-muted/30">
              {columns.map((_, c) => (
                <td
                  key={c}
                  className="max-w-80 truncate border-b border-r border-border px-2 py-1 font-mono"
                  title={cellText(row[c])}
                >
                  {cellText(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="p-4 text-sm text-muted-foreground">No rows.</p>}
    </div>
  );
}

/** One tab's first rows, with Load more. */
function TabPreview({ fileId, tab }: { fileId: string; tab: Tab }) {
  const [rows, setRows] = useState<unknown[][]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (offset: number) => {
    setLoading(true);
    try {
      // The tab's own columns, not the view's row keys (_rid, _pos).
      const cols = tab.columns.length ? tab.columns.map((c) => quoted(c.name)).join(', ') : '*';
      const got = await ask(fileId, {
        sql: `SELECT ${cols} FROM ${quoted(tab.view)} ORDER BY "_pos" LIMIT ${PAGE} OFFSET ${offset}`,
        max_rows: PAGE,
      });
      if (got.kind !== 'rows') throw new Error(got.kind === 'none' ? got.reason : 'No rows.');
      setColumns(got.columns);
      setRows((prev) => (offset === 0 ? got.rows : [...prev, ...got.rows]));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setRows([]);
    void load(0);
    // One tab per mount: the parent keys this by tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, tab.view]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
        {tab.columns.map((c) => (
          <span
            key={c.name}
            className="rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[11px]"
            title={c.type}
          >
            {c.name} <span className="text-muted-foreground">{c.type}</span>
          </span>
        ))}
      </div>
      {error ? (
        <p className="p-4 text-sm text-destructive-ink">{error}</p>
      ) : (
        <ResultTable columns={columns} rows={rows} />
      )}
      <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
        <span>
          {rows.length.toLocaleString()} of {tab.row_count.toLocaleString()} rows shown
        </span>
        {rows.length < tab.row_count && (
          <Button
            size="xs"
            variant="outline"
            disabled={loading}
            onClick={() => void load(rows.length)}
          >
            {loading && <Loader2 className="animate-spin" />}
            Load more
          </Button>
        )}
      </div>
    </div>
  );
}

/** A read-only SELECT over the file's database. */
function QueryBox({ fileId, firstView }: { fileId: string; firstView: string | null }) {
  const [text, setText] = useState(
    firstView ? `SELECT * FROM ${quoted(firstView)} LIMIT 50` : 'SELECT 1',
  );
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Rows | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    try {
      const got = await ask(fileId, { sql: text, max_rows: 1000 });
      if (got.kind === 'rows') {
        setResult(got);
        setError(null);
      } else {
        setResult(null);
        setError(got.kind === 'none' ? got.reason : 'No rows.');
      }
    } catch (err) {
      setResult(null);
      setError(err instanceof ApiError ? err.message : 'The query failed.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-border p-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void run();
            }
          }}
          aria-label="SQL query"
          spellCheck={false}
          className="min-h-20 font-mono text-xs"
        />
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={() => void run()} disabled={running || !text.trim()}>
            {running ? <Loader2 className="animate-spin" /> : <Play />}
            Run
          </Button>
          <span className="text-xs text-muted-foreground">
            One SELECT, read only. Put names in double quotes. In a MATCH, put the words in double
            quotes too.
          </span>
        </div>
      </div>
      {error ? (
        <p className="p-4 text-sm text-destructive-ink">{error}</p>
      ) : result ? (
        <>
          <ResultTable columns={result.columns} rows={result.rows} />
          <div className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
            {result.row_count.toLocaleString()} rows in {result.duration_ms} ms
            {result.truncated ? '. Cut at the row limit: narrow it with WHERE.' : ''}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** The file a database was made from: its name and folder. A click opens it. */
function SourceLine({
  filename,
  folder,
  onOpenFile,
}: {
  filename: string;
  folder: string;
  onOpenFile: () => void;
}) {
  const d = describeFile('', filename);
  const Icon = d.icon;
  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-2 text-xs">
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
    </div>
  );
}

/** One file's database: its tabs and rows, a query box, or why it has none.
 *  The file it was made from is named on top, in every state. */
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
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SourceLine filename={filename} folder={folder} onOpenFile={onOpenFile} />
      <DatabaseBody fileId={fileId} />
    </div>
  );
}

function DatabaseBody({ fileId }: { fileId: string }) {
  const described = useQuery({
    queryKey: ['files', 'database', fileId],
    queryFn: () => ask(fileId, {}),
    // New bytes give a new database: read it again each time the view opens.
    gcTime: 0,
  });
  const [tabName, setTabName] = useState<string | null>(null);
  const [querying, setQuerying] = useState(false);

  if (described.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Reading the database…
      </div>
    );
  }
  if (described.isError) {
    const message =
      described.error instanceof ApiError ? described.error.message : 'Could not read it.';
    return <p className="p-6 text-sm text-destructive-ink">{message}</p>;
  }
  const answer = described.data;
  if (answer.kind === 'none') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <Database className="size-6 text-muted-foreground" aria-hidden />
        <p className="max-w-md text-sm">This file has no database.</p>
        <p className="max-w-md text-xs text-muted-foreground">{answer.reason}</p>
      </div>
    );
  }
  if (answer.kind !== 'describe') return null;

  const tab = answer.tabs.find((t) => t.name === tabName) ?? answer.tabs[0] ?? null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <StatePill state="ready" />
        <span className="text-muted-foreground">
          {answer.tabs.length} tab{answer.tabs.length === 1 ? '' : 's'}, read only
        </span>
        <span className="ml-auto flex items-center gap-1 text-muted-foreground">
          An app reads this with file_sql and this id
          <CopyButton value={fileId} label="Copy id" ariaLabel="Copy the file id" />
        </span>
      </div>
      {answer.description && (
        <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
          {answer.description}
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Tabs"
          className="w-48 shrink-0 overflow-y-auto scrollbar-thin border-r border-border"
        >
          <ul className="py-1 text-sm">
            {answer.tabs.map((t) => (
              <li key={t.name}>
                <RowButton
                  onClick={() => {
                    setTabName(t.name);
                    setQuerying(false);
                  }}
                  aria-current={!querying && tab?.name === t.name ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/40',
                    !querying && tab?.name === t.name && 'bg-accent text-accent-foreground',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {t.row_count.toLocaleString()}
                  </span>
                </RowButton>
              </li>
            ))}
            <li className="mt-1 border-t border-border pt-1">
              <RowButton
                onClick={() => setQuerying(true)}
                aria-current={querying ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/40',
                  querying && 'bg-accent text-accent-foreground',
                )}
              >
                <Play className="size-3.5" aria-hidden /> Query
              </RowButton>
            </li>
          </ul>
        </nav>
        {querying ? (
          <QueryBox fileId={fileId} firstView={tab?.view ?? null} />
        ) : tab ? (
          <TabPreview key={tab.view} fileId={fileId} tab={tab} />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">This database has no tabs.</p>
        )}
      </div>
    </div>
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
