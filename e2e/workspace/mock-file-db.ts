import type { Page, Route } from '@playwright/test';
import { FILE } from './mock-workspace-api';

/**
 * A made-up data file and its read-only database, for the Files screen's
 * database viewer (file-data.tsx). Every name and value here is invented.
 * The routes are the browser's own (page.route), so the shared mock brain
 * stays as it is for every other spec.
 */
export const DATA_FILE = {
  id: '68686868-6868-4686-8686-686868686868',
  filename: 'survey-points.csv',
  parentPath: FILE.parentPath,
} as const;

/** A wide tab of 40 columns, a narrow one, and one with long text. */
const POINT_COLUMNS = Array.from({ length: 40 }, (_, i) =>
  i === 0 ? 'Point id' : i === 39 ? 'Last remark' : `Field ${String(i + 1).padStart(2, '0')}`,
);
export const TABS = [
  {
    name: 'Points',
    view: 'Points',
    row_count: 1234,
    columns: POINT_COLUMNS.map((name, i) => ({ name, type: i % 3 === 1 ? 'REAL' : 'TEXT' })),
  },
  {
    name: 'Lines',
    view: 'Lines',
    row_count: 87,
    columns: ['Line id', 'From', 'To', 'Length', 'Kind', 'Layer'].map((name) => ({
      name,
      type: name === 'Length' ? 'REAL' : 'TEXT',
    })),
  },
  {
    name: 'Notes',
    view: 'Notes',
    row_count: 12,
    columns: [
      { name: 'Note id', type: 'INTEGER' },
      { name: 'Body', type: 'TEXT' },
      { name: 'Author', type: 'TEXT' },
    ],
  },
] as const;

const LONG =
  'A long made-up remark about a survey point that goes on for a while, so the cell has to cut it and show the rest on hover.';

/** One cell of a tab, made up from its row and column number. */
function cell(tab: (typeof TABS)[number], row: number, col: number): unknown {
  const c = tab.columns[col]!;
  if (col === 0) return `${tab.name.slice(0, 1)}-${String(row + 1).padStart(4, '0')}`;
  if (tab.name === 'Notes' && c.name === 'Body') return `${LONG} (${row + 1})`;
  if (c.type === 'REAL') return Math.round(((row * 7 + col * 13) % 1000) * 10) / 100;
  if (c.type === 'INTEGER') return row + 1;
  if (tab.name === 'Points' && col === 39) return `End of row ${row + 1}`;
  return `v${row + 1}.${col + 1}`;
}

/** The SQL each request carried, in order. */
export type FileDbMock = { sql: string[] };

/** Answer the data file's list row, detail and database in the browser. */
export async function routeFileDb(page: Page): Promise<FileDbMock> {
  const seen: FileDbMock = { sql: [] };
  const now = new Date().toISOString();
  const row = {
    id: DATA_FILE.id,
    parentPath: DATA_FILE.parentPath,
    filename: DATA_FILE.filename,
    extension: 'csv',
    mimeType: 'text/csv',
    sizeBytes: 4096,
    isText: false,
    summary: null,
    indexing: null,
    indexingApplied: null,
    createdAt: now,
    updatedAt: now,
    mayEdit: false,
    mayManage: false,
  };
  await page.route(
    (u) => u.pathname === '/api/files/files',
    async (route: Route) => {
      const req = route.request();
      const u = new URL(req.url());
      if (req.method() !== 'GET' || u.searchParams.get('parent') !== DATA_FILE.parentPath) {
        return route.fallback();
      }
      const got = await route.fetch();
      const body = (await got.json()) as { files: unknown[] };
      return route.fulfill({ json: { files: [...body.files, row] } });
    },
  );
  await page.route(
    (u) => u.pathname === `/api/files/files/${DATA_FILE.id}`,
    async (route: Route) => {
      if (new URL(route.request().url()).search) {
        return route.fulfill({ status: 404, json: { error: 'not found' } });
      }
      return route.fulfill({ json: { file: row, content: '' } });
    },
  );
  await page.route(
    (u) => u.pathname === `/api/files/files/${DATA_FILE.id}/database`,
    async (route: Route) => {
      const body = JSON.parse(route.request().postData() || '{}') as { sql?: string };
      const sql = (body.sql ?? '').trim();
      seen.sql.push(sql);
      if (!sql) {
        return route.fulfill({
          json: {
            kind: 'describe',
            file_id: DATA_FILE.id,
            title: DATA_FILE.filename,
            description: 'Made-up survey points for a test.',
            tabs: TABS,
            hint: 'Query a view.',
          },
        });
      }
      if (/\bbogus\b/i.test(sql) || !/^\s*(select|with)\b/i.test(sql)) {
        return route.fulfill({
          status: 400,
          json: { error: /bogus/i.test(sql) ? 'no such column: bogus' : 'Only one SELECT.' },
        });
      }
      const from = /from\s+"([^"]+)"/i.exec(sql)?.[1];
      const tab = TABS.find((t) => t.view === from);
      if (!tab) {
        return route.fulfill({
          json: {
            kind: 'rows',
            file_id: DATA_FILE.id,
            columns: ['1'],
            rows: [[1]],
            row_count: 1,
            duration_ms: 1,
          },
        });
      }
      const limit = Number(/limit\s+(\d+)/i.exec(sql)?.[1] ?? 200);
      const offset = Number(/offset\s+(\d+)/i.exec(sql)?.[1] ?? 0);
      const listed = /^select\s+\*/i.test(sql)
        ? tab.columns.map((c) => c.name)
        : [...(/^select\s+(.*?)\s+from/is.exec(sql)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map(
            (m) => m[1]!,
          );
      const idx = listed.map((n) => tab.columns.findIndex((c) => c.name === n));
      let order = Array.from({ length: tab.row_count }, (_, i) => i);
      const by = /order by\s+"([^"]+)"\s*(asc|desc)?/i.exec(sql);
      if (by && by[1] !== '_pos') {
        const col = tab.columns.findIndex((c) => c.name === by[1]);
        order = order.sort((a, b) => {
          const x = cell(tab, a, col) as string | number;
          const y = cell(tab, b, col) as string | number;
          return x < y ? -1 : x > y ? 1 : 0;
        });
        if (by[2]?.toLowerCase() === 'desc') order.reverse();
      }
      const cap = Math.min(limit, 1000);
      const rows = order.slice(offset, offset + cap).map((r) => idx.map((c) => cell(tab, r, c)));
      return route.fulfill({
        json: {
          kind: 'rows',
          file_id: DATA_FILE.id,
          columns: listed,
          rows,
          row_count: rows.length,
          duration_ms: 3,
        },
      });
    },
  );
  return seen;
}
