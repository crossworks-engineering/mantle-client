import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '@mantle/web-ui/token-store';
import { setCreateWorkspace } from './create-workspace';
import {
  TABLE_IMPORT_ACCEPT,
  TABLE_IMPORT_FAILED,
  TABLE_IMPORT_MAX_BYTES,
  TABLE_IMPORT_MAY_LAND,
  TABLE_IMPORT_NEEDS_UPDATE,
  TABLE_IMPORT_WRONG_TYPE,
  TableImportAnswerLost,
  importTable,
  tableImportError,
  tableImportRefusal,
} from './table-import';
import { UploadAbortedError, UploadHttpError, UploadNetworkError } from './xhr-upload';

/**
 * A browser's XMLHttpRequest, answering as `reply` says. `fault` drops the
 * connection after all the bytes. `hold` keeps the answer back until `xhr.answer`,
 * with `sentOf` bytes of 10 gone out by then.
 */
type Reply = {
  status?: number;
  body?: unknown;
  statusText?: string;
  fault?: 'network';
  hold?: boolean;
  sentOf?: number;
};
let reply: Reply;
let sent: {
  url: string;
  form: FormData;
  headers: Record<string, string>;
  withCredentials: boolean;
} | null;
/** The last request: lets a held answer go, and says if it was stopped. */
const xhr = { answer: () => {}, aborted: false };

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
  private headers: Record<string, string> = {};
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  abort() {
    xhr.aborted = true;
    this.onabort?.();
  }
  send(form: FormData) {
    xhr.answer = () => this.answer();
    xhr.aborted = false;
    sent = {
      url: this.url,
      form,
      headers: this.headers,
      withCredentials: this.withCredentials,
    };
    const loaded = reply.sentOf ?? 10;
    this.upload.onprogress?.({ lengthComputable: true, loaded, total: 10 });
    if (loaded >= 10) this.upload.onload?.();
    if (reply.fault) this.onerror?.();
    else if (!reply.hold) this.answer();
  }
  answer() {
    this.status = reply.status ?? 0;
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
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setCreateWorkspace(null);
});

describe('which files it takes', () => {
  it('takes the three types, in any case', () => {
    for (const name of ['a.xlsx', 'a.xls', 'a.csv', 'A.XLSX', 'my book.Csv']) {
      expect(tableImportRefusal({ name, size: 10 }), name).toBeNull();
    }
  });
  it('refuses another', () => {
    for (const name of ['a.pdf', 'a.xlsm', 'a.txt', 'csv', 'a.csv.zip']) {
      expect(tableImportRefusal({ name, size: 10 }), name).toBe(TABLE_IMPORT_WRONG_TYPE);
    }
  });
  it('refuses a file over the cap, with both numbers', () => {
    const name = 'big.xlsx';
    expect(tableImportRefusal({ name, size: TABLE_IMPORT_MAX_BYTES })).toBeNull();
    expect(tableImportRefusal({ name, size: 70 * 1024 * 1024 })).toBe(
      'File is 70 MB. The limit is 64 MB.',
    );
  });
  it('the picker offers only what it takes', () => {
    for (const type of TABLE_IMPORT_ACCEPT.split(',')) {
      expect(tableImportRefusal({ name: `a${type}`, size: 10 }), type).toBeNull();
    }
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

describe('the credential it sends', () => {
  const page = (apiBase: string) =>
    vi.stubGlobal('window', {
      location: {
        href: 'https://client.example.test/tables',
        origin: 'https://client.example.test',
      },
      __MANTLE_ENV__: { apiBase },
    });
  const ok = { status: 201, body: { table: { id: 'T1' } } };

  it('across origins: the bearer, and no cookie', async () => {
    page('https://brain.example.test');
    vi.spyOn(tokenStore, 'get').mockReturnValue('tok');
    reply = ok;
    await importTable(csv());
    expect(sent?.url).toBe('https://brain.example.test/api/tables/import');
    expect(sent?.headers).toEqual({ Authorization: 'Bearer tok' });
    expect(sent?.withCredentials).toBe(false);
  });

  it('the same origin, by a full address too: the cookie, and no bearer without a token', async () => {
    for (const apiBase of ['', 'https://client.example.test']) {
      page(apiBase);
      vi.spyOn(tokenStore, 'get').mockReturnValue(null);
      reply = ok;
      await importTable(csv());
      expect(sent?.headers, apiBase).toEqual({});
      expect(sent?.withCredentials, apiBase).toBe(true);
    }
  });

  it('the same origin with a token: the bearer goes beside the cookie, as apiFetch does', async () => {
    page('');
    vi.spyOn(tokenStore, 'get').mockReturnValue('tok');
    reply = ok;
    await importTable(csv());
    expect(sent?.headers).toEqual({ Authorization: 'Bearer tok' });
    expect(sent?.withCredentials).toBe(true);
  });

  it('a build with only the env token sends it, as apiFetch does', async () => {
    page('https://brain.example.test');
    vi.spyOn(tokenStore, 'get').mockReturnValue(null);
    vi.stubEnv('NEXT_PUBLIC_MANTLE_API_TOKEN', 'env-tok');
    reply = ok;
    await importTable(csv());
    expect(sent?.headers).toEqual({ Authorization: 'Bearer env-tok' });
  });
});

describe('an import under way', () => {
  it('a Cancel part way through stops the bytes and rejects as aborted', async () => {
    reply = { hold: true, sentOf: 5 };
    const stop = new AbortController();
    const onProgress = vi.fn();
    const going = importTable(csv(), { signal: stop.signal, onProgress });
    expect(onProgress).toHaveBeenCalledWith(5, 10);
    stop.abort();
    await expect(going).rejects.toBeInstanceOf(UploadAbortedError);
    expect(xhr.aborted).toBe(true);
  });

  it('a stop after all the bytes stops nothing: the table still comes', async () => {
    reply = { hold: true, status: 201, body: { table: { id: 'T1' } } };
    const stop = new AbortController();
    const going = importTable(csv(), { signal: stop.signal });
    stop.abort();
    expect(xhr.aborted).toBe(false);
    xhr.answer();
    expect((await going).id).toBe('T1');
  });

  it('a delayed answer still gives the table, after all the bytes', async () => {
    reply = { hold: true, status: 201, body: { table: { id: 'T1' } } };
    const onProgress = vi.fn();
    const going = importTable(csv(), { onProgress });
    expect(onProgress).toHaveBeenCalledWith(10, 10);
    xhr.answer();
    expect((await going).id).toBe('T1');
  });

  it('a delayed refusal shows the server words, not the lost answer', async () => {
    reply = { hold: true, status: 400, body: { error: 'no tabular data found' } };
    const going = importTable(csv()).catch((e: unknown) => e);
    xhr.answer();
    expect(tableImportError(await going)).toBe('no tabular data found');
  });

  it('a network fault after all the bytes: the table may still land', async () => {
    reply = { fault: 'network' };
    const err = await importTable(csv()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TableImportAnswerLost);
    expect(tableImportError(err)).toBe(TABLE_IMPORT_MAY_LAND);
  });

  it('a network fault part way through is only a dropped connection', async () => {
    reply = { fault: 'network', sentOf: 5 };
    const err = await importTable(csv()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UploadNetworkError);
    expect(tableImportError(err)).toBe('Connection dropped before the upload finished.');
  });

  it('a proxy answer part way through is not a lost answer', async () => {
    reply = { status: 502, statusText: 'Bad Gateway', body: '<html></html>', sentOf: 5 };
    const err = await importTable(csv()).catch((e: unknown) => e);
    expect(tableImportError(err)).toBe(TABLE_IMPORT_FAILED);
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

  it('any 5xx after every byte went out: the table may still land', async () => {
    for (const status of [500, 502, 503, 504, 520]) {
      expect(await failure({ status, body: '<html>Bad Gateway</html>' }), String(status)).toBe(
        TABLE_IMPORT_MAY_LAND,
      );
    }
    expect(await failure({ status: 500, body: { error: 'database is down' } })).toBe(
      TABLE_IMPORT_MAY_LAND,
    );
  });
});
