/**
 * The pure parts of the file database viewer (file-data.tsx): the grid's
 * document from a page of rows, the paging words, the SQL a page asks, a
 * name put into the query at the caret, and the view in the URL. No React,
 * so each is tested on its own (file-data-model.test.ts).
 */
import type { CellValue, Column, ColumnType, TableDoc } from '@mantle/content-core/table-model';

/** A name in double quotes, as SQLite reads it. */
export const quoted = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** The page sizes the pager offers. The brain sends 1,000 rows at most. */
export const PAGE_SIZES = [50, 100, 250, 500, 1000] as const;
export const DEFAULT_PAGE_SIZE = 100;
/** The row cap of a query (the brain's own maximum). */
export const QUERY_ROW_CAP = 1000;

/** A SQLite declared type as the grid's column type: numbers sort as numbers. */
export function columnType(sqliteType: string | undefined): ColumnType {
  return /INT|REAL|FLOA|DOUB|NUM|DEC/i.test(sqliteType ?? '') ? 'number' : 'text';
}

/** A cell as the grid shows it: an object as JSON, nothing as empty. */
function cellValue(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}

/**
 * A read-only grid document from columns and rows. Column ids are by place
 * (`c0`, `c1`…), so a result that names a column twice still has one id per
 * column; `types` gives a column's SQLite type by name where it is known.
 */
export function toGridDoc(
  columns: string[],
  rows: unknown[][],
  types: Record<string, string> = {},
): TableDoc {
  const cols: Column[] = columns.map((name, i) => ({
    id: `c${i}`,
    name,
    type: columnType(types[name]),
  }));
  return {
    columns: cols,
    rows: rows.map((row, r) => ({
      id: `r${r}`,
      cells: Object.fromEntries(cols.map((c, i) => [c.id, cellValue(row[i])])),
    })),
  };
}

/** "Rows 101 to 200 of 1,234", or "No rows". */
export function pageText(offset: number, shown: number, total: number): string {
  if (total <= 0 || shown <= 0) return 'No rows';
  const f = (n: number) => n.toLocaleString('en-US');
  return `Rows ${f(offset + 1)} to ${f(offset + shown)} of ${f(total)}`;
}

/** How many pages `total` rows make at `size` a page (at least one). */
export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size));
}

export type Sort = { column: string; desc: boolean } | null;

/** The SQL for one page of a tab: its own columns, in file order unless a
 *  sort is chosen (file order breaks ties, so pages never overlap). */
export function pageSql(
  tab: { view: string; columns: { name: string }[] },
  page: { offset: number; size: number; sort: Sort },
): string {
  const cols = tab.columns.length ? tab.columns.map((c) => quoted(c.name)).join(', ') : '*';
  const order = page.sort
    ? `${quoted(page.sort.column)} ${page.sort.desc ? 'DESC' : 'ASC'}, "_pos"`
    : '"_pos"';
  return `SELECT ${cols} FROM ${quoted(tab.view)} ORDER BY ${order} LIMIT ${page.size} OFFSET ${page.offset}`;
}

/**
 * Put a quoted name into the query at the caret (over the selection), with a
 * space before it when it would touch the word before. Gives the new text and
 * where the caret goes.
 */
export function insertName(
  text: string,
  start: number,
  end: number,
  name: string,
): { text: string; caret: number } {
  const before = text.slice(0, start);
  const gap = before && !/[\s(,.]$/.test(before) ? ' ' : '';
  const piece = gap + quoted(name);
  return { text: before + piece + text.slice(end), caret: start + piece.length };
}

/** What the URL says about the database view: off, a tab, or the query. */
export type DbView = { on: false } | { on: true; query: boolean; tab: string | null };

export function readDbView(params: URLSearchParams): DbView {
  const view = params.get('view');
  if (view !== 'data' && view !== 'query') return { on: false };
  return { on: true, query: view === 'query', tab: params.get('dbtab') };
}

/** The query string with the database view set (or cleared, for `off`). */
export function withDbView(params: URLSearchParams, next: DbView): string {
  const sp = new URLSearchParams(params.toString());
  if (!next.on) {
    sp.delete('view');
    sp.delete('dbtab');
  } else {
    sp.set('view', next.query ? 'query' : 'data');
    if (next.tab) sp.set('dbtab', next.tab);
    else sp.delete('dbtab');
  }
  return sp.toString();
}

/** Where a file's last query is kept for this browser session. */
export const queryKey = (fileId: string) => `mantle:file-sql:${fileId}`;
