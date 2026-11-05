/**
 * The Tables screen's Import: a spreadsheet becomes a new committed Table
 * (POST /api/tables/import), where New table would put it. No file lands in
 * Files. Free of React so the words it shows are unit-tested.
 */
import type { TableDetail } from '@mantle/content-core/table-model';
import { isSpreadsheetName } from './upload-progress';
import { UploadHttpError, xhrUploadToBrain } from './xhr-upload';

/** What the file picker offers. */
export const TABLE_IMPORT_ACCEPT = '.xlsx,.xls,.csv';

export const TABLE_IMPORT_WRONG_TYPE = 'This takes an .xlsx, .xls or .csv file.';

/** A brain before this route answers 404 or 405. */
export const TABLE_IMPORT_NEEDS_UPDATE = 'This brain needs an update before it can import a table.';

/** Why this file cannot be imported, or null when it can. */
export function tableImportRefusal(file: { name: string }): string | null {
  return isSpreadsheetName(file.name) ? null : TABLE_IMPORT_WRONG_TYPE;
}

/** The words for a failed import: the server's own where it gave any. */
export function tableImportError(err: unknown): string {
  if (err instanceof UploadHttpError && (err.status === 404 || err.status === 405)) {
    return TABLE_IMPORT_NEEDS_UPDATE;
  }
  return err instanceof Error ? err.message : 'Could not import this file.';
}

/** Send the file. Resolves to the new table; rejects as `xhrUpload` does. */
export async function importTable(
  file: File,
  opts: { signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void } = {},
): Promise<TableDetail> {
  const form = new FormData();
  form.set('file', file);
  const { table } = await xhrUploadToBrain<{ table?: TableDetail }>('/api/tables/import', {
    form,
    ...opts,
  });
  // A 2xx with no table is not this route (a proxy's page, say).
  if (!table?.id) throw new Error(TABLE_IMPORT_NEEDS_UPDATE);
  return table;
}
