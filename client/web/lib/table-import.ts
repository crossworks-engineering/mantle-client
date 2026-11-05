/**
 * The Tables screen's Import: a spreadsheet becomes a new committed Table
 * (POST /api/tables/import), where New table would put it. No file lands in
 * Files. Free of React so the words it shows are unit-tested.
 */
import type { TableDetail } from '@mantle/content-core/table-model';
import { isSpreadsheetName, overLimitMessage } from './upload-progress';
import {
  UploadHttpError,
  UploadNetworkError,
  UploadStalledError,
  xhrUploadToBrain,
} from './xhr-upload';

/** What the file picker offers. */
export const TABLE_IMPORT_ACCEPT = '.xlsx,.xls,.csv';

export const TABLE_IMPORT_WRONG_TYPE = 'This takes an .xlsx, .xls or .csv file.';

/** A brain before this route answers 404 or 405. */
export const TABLE_IMPORT_NEEDS_UPDATE = 'This brain needs an update before it can import a table.';

/** Every byte went out and the answer never came back: the table may land. */
export const TABLE_IMPORT_MAY_LAND =
  'The file was sent, but the answer was lost. The table may still appear. Check the list before you try again.';

export class TableImportAnswerLost extends Error {
  constructor() {
    super(TABLE_IMPORT_MAY_LAND);
    this.name = 'TableImportAnswerLost';
  }
}

/** How long the brain may build before the dialog offers a Close. */
export const TABLE_IMPORT_CLOSE_AFTER_MS = 120_000;

/** The brain's cap for a workbook. A CSV's is lower, and the brain says so. */
export const TABLE_IMPORT_MAX_BYTES = 64 * 1024 * 1024;

/** Why this file cannot be imported, or null when it can. */
export function tableImportRefusal(file: { name: string; size: number }): string | null {
  if (!isSpreadsheetName(file.name)) return TABLE_IMPORT_WRONG_TYPE;
  return file.size > TABLE_IMPORT_MAX_BYTES
    ? overLimitMessage(file.size, TABLE_IMPORT_MAX_BYTES)
    : null;
}

/** The words for a failed import: the server's own where it gave any. */
export function tableImportError(err: unknown): string {
  if (err instanceof UploadHttpError && (err.status === 404 || err.status === 405)) {
    return TABLE_IMPORT_NEEDS_UPDATE;
  }
  return err instanceof Error ? err.message : 'Could not import this file.';
}

/** A dropped line, or a 5xx: neither says whether the table was made. */
function answerLost(err: unknown): boolean {
  return (
    err instanceof UploadNetworkError ||
    err instanceof UploadStalledError ||
    (err instanceof UploadHttpError && err.status >= 500)
  );
}

/**
 * Send the file. Resolves to the new table; rejects as `xhrUpload` does, or
 * with `TableImportAnswerLost` when the answer was lost after every byte went
 * out, since the brain may still be making the table.
 */
export async function importTable(
  file: File,
  opts: { signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void } = {},
): Promise<TableDetail> {
  const form = new FormData();
  form.set('file', file);
  let allSent = false;
  let answer: { table?: TableDetail };
  try {
    answer = await xhrUploadToBrain<{ table?: TableDetail }>('/api/tables/import', {
      form,
      signal: opts.signal,
      onProgress: (loaded, total) => {
        allSent = loaded >= total;
        opts.onProgress?.(loaded, total);
      },
    });
  } catch (err) {
    throw allSent && answerLost(err) ? new TableImportAnswerLost() : err;
  }
  // A 2xx with no table is not this route (a proxy's page, say).
  if (!answer.table?.id) throw new Error(TABLE_IMPORT_NEEDS_UPDATE);
  return answer.table;
}
