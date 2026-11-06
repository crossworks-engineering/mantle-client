/**
 * Upload with byte-level progress. `fetch` cannot report upload progress, so
 * a 250 MB file behind it is a spinner until the request ends, however it
 * ends. XMLHttpRequest can, and it also tells the difference between a
 * refusal (413 with a message), a dropped connection, and a stall.
 */

import { apiTokenValue, errorMessageOf } from '@mantle/web-ui/api-fetch';
import { isCrossOrigin, runtimeApiBase } from '@mantle/web-ui/runtime-env';
import { agentHands } from './agent-ui/hands';
import { AGENT_CALL_HEADER, isAgentRefusal } from './agent-ui/model';
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
  constructor(message = 'Cancelled.') {
    super(message);
    this.name = 'UploadAbortedError';
  }
}
/** Not sent: an agent drove the window and the user said Not now to it.
 *  An abort, so a screen treats it as the cancel it is. */
export class UploadBlockedError extends UploadAbortedError {
  constructor() {
    super('Not sent: the user did not allow it.');
    this.name = 'UploadBlockedError';
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

/**
 * An upload, through the same guard as every fetch while an agent drives
 * the window (lib/agent-ui/hands.ts): a risky one waits for the user's
 * Allow, one the agent set off carries its tag, and the brain's
 * agent_refused is held and, on Allow, sent once more untagged. With no
 * agent session it is a plain upload.
 */
export function xhrUpload<T = unknown>(opts: XhrUploadOptions): Promise<T> {
  const hands = agentHands();
  // No agent session: sent at once, as ever.
  if (!hands.guarding()) return sendXhr<T>(opts);
  return guardedXhr<T>(opts);
}

async function guardedXhr<T>(opts: XhrUploadOptions): Promise<T> {
  const hands = agentHands();
  const guard = await hands.guardRequest('POST', opts.url, opts.form);
  if (guard.blocked) throw new UploadBlockedError();
  if (!guard.tag) return hands.track(sendXhr<T>(opts));
  const tagged = { ...opts, headers: { ...opts.headers, [AGENT_CALL_HEADER]: guard.tag } };
  try {
    return await hands.track(sendXhr<T>(tagged));
  } catch (err) {
    if (!(err instanceof UploadHttpError) || !isAgentRefusal(err.status, err.body)) throw err;
    if (!(await hands.allowRefused('POST', opts.url, err.status, err.body))) {
      throw hands.get().active ? new UploadBlockedError() : err;
    }
    return hands.track(sendXhr<T>(opts));
  }
}

function sendXhr<T>(opts: XhrUploadOptions): Promise<T> {
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
        // A 401 first: its body is a code ('unauthorized'), not words to show.
        const msg =
          xhr.status === 401
            ? 'Your session expired. Sign in again.'
            : body && typeof body.error === 'string'
              ? errorMessageOf(body, xhr)
              : xhr.status === 413
                ? 'The server refused the file as too large.'
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
 * workspace, and the credential is apiFetch's (the cookie on the same origin,
 * and its bearer whenever it has one).
 */
export function xhrUploadToBrain<T = unknown>(
  path: string,
  opts: Omit<XhrUploadOptions, 'url' | 'headers' | 'withCredentials'>,
): Promise<T> {
  const token = apiTokenValue();
  return xhrUpload<T>({
    ...opts,
    url: `${runtimeApiBase()}${withCreateWs(path)}`,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    withCredentials: !isCrossOrigin(),
  });
}
