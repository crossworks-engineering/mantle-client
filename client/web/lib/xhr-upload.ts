/**
 * Upload with byte-level progress. `fetch` cannot report upload progress, so
 * a 250 MB file behind it is a spinner until the request ends, however it
 * ends. XMLHttpRequest can, and it also tells the difference between a
 * refusal (413 with a message), a dropped connection, and a stall.
 */

import { errorMessageOf } from '@mantle/web-ui/api-fetch';
import { isCrossOrigin, runtimeApiBase } from '@mantle/web-ui/runtime-env';
import { tokenStore } from '@mantle/web-ui/token-store';
import { withCreateWs } from './create-workspace';

export class UploadHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown> | null,
  ) {
    super(message);
    this.name = 'UploadHttpError';
  }
}
export class UploadNetworkError extends Error {
  constructor() {
    super('Connection dropped before the upload finished.');
    this.name = 'UploadNetworkError';
  }
}
export class UploadStalledError extends Error {
  constructor(seconds: number) {
    super(`No progress for ${seconds}s. The connection stalled.`);
    this.name = 'UploadStalledError';
  }
}
export class UploadAbortedError extends Error {
  constructor() {
    super('Cancelled.');
    this.name = 'UploadAbortedError';
  }
}

export type XhrUploadOptions = {
  url: string;
  form: FormData;
  headers?: Record<string, string>;
  withCredentials?: boolean;
  signal?: AbortSignal;
  /** Abort when no upload progress arrives for this long. Only armed while
   *  bytes are still going out; once the body is sent the server's own work
   *  (hash, rename, DB row) is not a stall. Default 60 s. */
  stallMs?: number;
  onProgress?: (loaded: number, total: number) => void;
};

export function xhrUpload<T = unknown>(opts: XhrUploadOptions): Promise<T> {
  const stallMs = opts.stallMs ?? 60_000;
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    let stalled = false;
    let settled = false;

    const clearStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = null;
    };
    const armStall = () => {
      clearStall();
      stallTimer = setTimeout(() => {
        stalled = true;
        xhr.abort();
      }, stallMs);
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearStall();
      opts.signal?.removeEventListener('abort', onSignalAbort);
      fn();
    };
    const onSignalAbort = () => xhr.abort();

    xhr.open('POST', opts.url, true);
    for (const [k, v] of Object.entries(opts.headers ?? {})) xhr.setRequestHeader(k, v);
    xhr.withCredentials = opts.withCredentials ?? false;
    xhr.responseType = 'text';

    xhr.upload.onprogress = (e) => {
      armStall();
      if (e.lengthComputable) opts.onProgress?.(e.loaded, e.total);
    };
    // Body fully sent: the stall watchdog stands down while the server works.
    xhr.upload.onload = () => clearStall();

    xhr.onload = () =>
      finish(() => {
        let body: Record<string, unknown> | null = null;
        try {
          body = xhr.responseText
            ? (JSON.parse(xhr.responseText) as Record<string, unknown>)
            : null;
        } catch {
          /* not JSON (a proxy error page, say): the status alone has to do */
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve((body ?? {}) as T);
          return;
        }
        const msg =
          body && typeof body.error === 'string'
            ? errorMessageOf(body, xhr)
            : xhr.status === 413
              ? 'The server refused the file as too large.'
              : xhr.status === 401
                ? 'Your session expired. Sign in again.'
                : `${xhr.status} ${xhr.statusText || 'error'}`;
        reject(new UploadHttpError(xhr.status, msg, body));
      });
    xhr.onerror = () => finish(() => reject(new UploadNetworkError()));
    xhr.onabort = () =>
      finish(() =>
        reject(
          stalled ? new UploadStalledError(Math.round(stallMs / 1000)) : new UploadAbortedError(),
        ),
      );

    if (opts.signal?.aborted) {
      finish(() => reject(new UploadAbortedError()));
      return;
    }
    opts.signal?.addEventListener('abort', onSignalAbort, { once: true });
    armStall();
    xhr.send(opts.form);
  });
}

/**
 * `xhrUpload` to a route on the brain: a create route names the switcher's
 * workspace, and the credential is apiFetch's (cookie on same-origin, bearer
 * only across origins).
 */
export function xhrUploadToBrain<T = unknown>(
  path: string,
  opts: Omit<XhrUploadOptions, 'url' | 'headers' | 'withCredentials'>,
): Promise<T> {
  const token = tokenStore.get();
  return xhrUpload<T>({
    ...opts,
    url: `${runtimeApiBase()}${withCreateWs(path)}`,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    withCredentials: !isCrossOrigin(),
  });
}
