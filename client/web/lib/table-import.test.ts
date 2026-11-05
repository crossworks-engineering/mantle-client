import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setCreateWorkspace } from './create-workspace';
import {
  TABLE_IMPORT_ACCEPT,
  TABLE_IMPORT_MAY_LAND,
  TABLE_IMPORT_NEEDS_UPDATE,
  TABLE_IMPORT_WRONG_TYPE,
  importTable,
  tableImportError,
  tableImportRefusal,
} from './table-import';
import { UploadAbortedError, UploadHttpError } from './xhr-upload';

/** A browser's XMLHttpRequest, answering as `reply` says. */
type Reply = { status: number; body?: unknown; statusText?: string };
let reply: Reply;
let sent: { url: string; form: FormData } | null;

class FakeXhr {
  status = 0;
  statusText = '';
  responseText = '';
  responseType = '';
  withCredentials = false;
  upload: { onprogress?: (e: unknown) => void; onload?: () => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  private url = '';
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader() {}
  abort() {
    this.onabort?.();
  }
  send(form: FormData) {
    sent = { url: this.url, form };
    this.upload.onprogress?.({ lengthComputable: true, loaded: 10, total: 10 });
    this.upload.onload?.();
    this.status = reply.status;
    this.statusText = reply.statusText ?? '';
    this.responseText = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
    this.onload?.();
  }
}

const csv = (name = 'stock.csv') => new File(['Name\nA\n'], name, { type: 'text/csv' });

beforeEach(() => {
  sent = null;
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setCreateWorkspace(null);
});

describe('which files it takes', () => {
  it('takes the three types, in any case', () => {
    for (const name of ['a.xlsx', 'a.xls', 'a.csv', 'A.XLSX', 'my book.Csv']) {
      expect(tableImportRefusal({ name }), name).toBeNull();
    }
  });
  it('refuses another', () => {
    for (const name of ['a.pdf', 'a.xlsm', 'a.txt', 'csv', 'a.csv.zip']) {
      expect(tableImportRefusal({ name }), name).toBe(TABLE_IMPORT_WRONG_TYPE);
    }
  });
  it('offers the three in the picker', () => {
    expect(TABLE_IMPORT_ACCEPT).toBe('.xlsx,.xls,.csv');
  });
});

describe('importTable', () => {
  it('a 201 gives the new table, sent as the field `file`', async () => {
    reply = { status: 201, body: { table: { id: 'T1', title: 'stock' } } };
    const onProgress = vi.fn();
    const table = await importTable(csv(), { onProgress });
    expect(table.id).toBe('T1');
    expect(sent?.url).toBe('/api/tables/import');
    expect((sent?.form.get('file') as File).name).toBe('stock.csv');
    expect(onProgress).toHaveBeenCalledWith(10, 10);
  });

  it('names the workspace the switcher shows', async () => {
    setCreateWorkspace('W1');
    reply = { status: 201, body: { table: { id: 'T1' } } };
    await importTable(csv());
    expect(sent?.url).toBe('/api/tables/import?ws=W1');
  });

  it('a 2xx with no table is not this route', async () => {
    reply = { status: 200, body: '<!doctype html>' };
    await expect(importTable(csv())).rejects.toThrow(TABLE_IMPORT_NEEDS_UPDATE);
  });

  it('a Cancel rejects as aborted, with nothing to show', async () => {
    reply = { status: 201, body: {} };
    const stop = new AbortController();
    stop.abort();
    await expect(importTable(csv(), { signal: stop.signal })).rejects.toBeInstanceOf(
      UploadAbortedError,
    );
  });
});

describe('the words of a failed import', () => {
  const failure = async (r: Reply) => {
    reply = r;
    const err = await importTable(csv()).catch((e: unknown) => e);
    return tableImportError(err);
  };

  it('a 400 and a 413 show the server words', async () => {
    expect(await failure({ status: 400, body: { error: 'no tabular data found' } })).toBe(
      'no tabular data found',
    );
    expect(
      await failure({ status: 413, body: { error: 'This request is too large (at most 64 MB).' } }),
    ).toBe('This request is too large (at most 64 MB).');
  });

  it('a 429 shows the server words', async () => {
    expect(await failure({ status: 429, body: { error: 'Too many requests.' } })).toBe(
      'Too many requests.',
    );
  });

  it('a 401 says the session expired, not its code', async () => {
    reply = { status: 401, body: { error: 'unauthorized' } };
    const err = await importTable(csv()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UploadHttpError);
    expect((err as UploadHttpError).status).toBe(401);
    expect(tableImportError(err)).toBe('Your session expired. Sign in again.');
  });

  it('a workspace refusal shows its message, not its code', async () => {
    expect(
      await failure({
        status: 403,
        body: {
          error: 'forbidden',
          reason: 'workspace',
          message: 'You are not in that workspace.',
        },
      }),
    ).toBe('You are not in that workspace.');
  });

  it('a 404 or a 405 says this brain needs an update', async () => {
    expect(await failure({ status: 404, body: { error: 'not found' } })).toBe(
      TABLE_IMPORT_NEEDS_UPDATE,
    );
    expect(await failure({ status: 405, body: '' })).toBe(TABLE_IMPORT_NEEDS_UPDATE);
    expect(tableImportError(new UploadHttpError(404, 'x', null))).toBe(TABLE_IMPORT_NEEDS_UPDATE);
  });

  it('a proxy that answers after every byte went out: the table may still land', async () => {
    expect(await failure({ status: 502, body: '<html>Bad Gateway</html>' })).toBe(
      TABLE_IMPORT_MAY_LAND,
    );
    expect(await failure({ status: 504, body: '<html>Gateway Timeout</html>' })).toBe(
      TABLE_IMPORT_MAY_LAND,
    );
  });

  it('a dropped connection says so', () => {
    expect(tableImportError(new Error('Connection dropped before the upload finished.'))).toBe(
      'Connection dropped before the upload finished.',
    );
  });
});
