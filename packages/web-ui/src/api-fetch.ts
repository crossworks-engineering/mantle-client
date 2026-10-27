/**
 * Client-side fetch helper for the `/api/**` surface — the single data transport
 * for the detached frontend (Phase 2 · Task 4 / DB-less dev).
 *
 * Same-origin by default: relative URL + cookie auth, exactly as today. When
 * `NEXT_PUBLIC_MANTLE_API_BASE` is set (Electron, or a detached/DB-less browser
 * client) it targets that origin and attaches the `NEXT_PUBLIC_MANTLE_API_TOKEN`
 * bearer — since cross-origin requests can't rely on the session cookie. In that
 * detached mode the browser talks straight to the remote API, so the local Next
 * server needs no database (see `detachedDevUser` in lib/auth + docs/db-less-dev.md).
 *
 * Throws an `ApiError` carrying the endpoint's `{ error }` message on non-2xx so
 * TanStack Query surfaces it in `error` / `onError`.
 */

import { isCrossOrigin, runtimeApiBase } from './runtime-env';
import { runSessionFlushes } from './session-flush';
import { tokenStore } from './token-store';

/** API base + bearer are GETTERS, not module constants: the split client
 *  resolves them at call time from window.__MANTLE_ENV__ (runtime config) and
 *  the token store (login-issued bearer). Build-time NEXT_PUBLIC_* vars remain
 *  the fallback, so the monolith and detached dev behave exactly as before. */
function apiBaseValue(): string {
  return runtimeApiBase();
}
function apiTokenValue(): string {
  return tokenStore.get() ?? process.env.NEXT_PUBLIC_MANTLE_API_TOKEN ?? '';
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /**
     * The parsed error body, for endpoints that return more than a message.
     * Formula and table specs are validated all-at-once and reject with an
     * `errors` array — collapsing that to the first line would hand the author
     * one problem at a time, which is precisely what the validator exists to
     * avoid.
     */
    readonly body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Resolve a path against the configured API base — the remote origin in
 *  detached/Electron mode, same-origin (empty base) otherwise. For raw `fetch()`
 *  calls that must own their own `Response` handling and so can't go through
 *  `apiFetch` (e.g. the assistant turn POST's re-attach loop, the stage poller). */
export function apiUrl(path: string): string {
  return `${apiBaseValue()}${path}`;
}

/** Build a `RequestInit` carrying the owner credential: cookies same-origin,
 *  the bearer (no credentials) cross-origin. Exported for the raw-`fetch()`
 *  callers above; most code should use `apiFetch`/`apiSend` instead.
 *
 *  The bearer attaches whenever one is stored, not only cross-origin: a
 *  same-origin session that authenticated in bearer mode — minted while the
 *  old `apiBase set ⇒ split` predicate misread the default one-domain
 *  deployment — keeps working alongside the cookie, because the server
 *  verifies both carriers with the same trust. */
export function withAuth(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  const token = apiTokenValue();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return {
    // Cross-origin is bearer-only, so send NO credentials — the middleware's
    // CORS reflects the origin WITHOUT Allow-Credentials (by design; see
    // corsOrigin), and the browser refuses a credentialed cross-origin
    // response that lacks it. The test is a real origin comparison, NOT
    // "is a base configured": a same-origin box that sets a base is not split.
    credentials: isCrossOrigin() ? 'omit' : 'include',
    ...init,
    headers,
  };
}

// One upgrade attempt per page load, shared as a PROMISE — concurrent callers
// (the shell mount, anything about to load a cookie-authenticated subresource)
// all await the same in-flight request instead of double-firing.
let cookieUpgrade: Promise<void> | null = null;

/**
 * Silent bearer→cookie upgrade for the OWNER surface, same-origin only.
 *
 * Owners who signed in while the split mis-detection was live hold ONLY the
 * localStorage bearer. That is fine for `apiFetch`, which can set a header,
 * and useless for the browser-native loaders — `<img>`, `<iframe>`, download
 * anchors — which authenticate by cookie and cannot carry one. So the moment
 * `assetUrl` goes back to same-origin paths, those sessions would 401 on every
 * asset. POST /api/auth/sso verifies whatever credential they DO have and
 * answers 204 with a fresh session cookie.
 *
 * Returns a promise that settles once the cookie is in place (or there was
 * nothing to do): callers about to load cookie-dependent resources await it so
 * the first paint doesn't race the Set-Cookie; the shell just fires it. A
 * failed attempt clears the memo so a later caller retries.
 */
export function upgradeOwnerCookie(): Promise<void> {
  cookieUpgrade ??= (async () => {
    if (isCrossOrigin()) return; // split client — the bearer IS the credential
    if (!tokenStore.get()) return; // cookie-mode session — nothing to upgrade
    try {
      await fetch(apiUrl('/api/auth/sso'), { method: 'POST', ...withAuth() });
    } catch {
      cookieUpgrade = null; // offline / transient — the next caller retries
    }
  })();
  return cookieUpgrade;
}

/**
 * Forget that the upgrade was attempted, so the NEXT session tries again.
 *
 * The memo is deliberately per page load — but a sign-out is a client
 * navigation, not a page load, so without this it outlives the session that
 * created it. The next owner to sign in on the same tab would find the upgrade
 * already "done", hold no session cookie, and 401 on every image, iframe and
 * download until they reloaded.
 */
export function resetCookieUpgrade(): void {
  cookieUpgrade = null;
}

/**
 * Auth failure as seen by a *client* fetch. Two shapes, because routes gate two
 * ways: `getOwnerOr401` → JSON 401, and `requireOwner` → 307 to /login that
 * `fetch` silently follows (landing on the login HTML, 200). Without this, an
 * expired session would parse as `{}` and render an empty screen instead of
 * bouncing to login — a trap every converted screen would otherwise inherit.
 * Exported for the raw-`fetch()` callers (the assistant dock's turn POST).
 */
export function isAuthFailure(res: Response): boolean {
  if (res.status === 401) return true;
  if (res.redirected) {
    try {
      return new URL(res.url).pathname.startsWith('/login');
    } catch {
      return false;
    }
  }
  return false;
}

/** Guards the one navigation: several requests can 401 together, and each used
 *  to assign `location.href` again. Harmless when it was synchronous; with a
 *  flush in front of it, it would be several rounds of saves. */
let bouncing = false;

/**
 * Send the browser to login, preserving where we were. No-op on the server or
 * if we're already on the login screen (avoids a redirect loop).
 *
 * Exported for the handful of callers that cannot go through `apiFetch` — the
 * dock's turn POST reads the raw `Response` because it re-attaches to an
 * in-flight turn by idempotency key. Pair it with `isAuthFailure`; those two
 * together are what `apiFetch` does, and a raw `fetch` that skips them is a
 * screen that answers an expired session with an error bubble instead of a
 * login screen.
 *
 * Gives every open editor a moment to save first. This is a FULL navigation,
 * so React never unmounts and the cleanup flush every draft editor relies on
 * does not run — which is how an expired session took up to a whole debounce
 * window of typing with it, showing a login screen as the only explanation.
 * The wait is bounded and never rejects (see runSessionFlushes): the session is
 * already gone, and nothing here may leave the user stuck on a dead screen.
 */
export function bounceToLogin(): void {
  if (typeof window === 'undefined') return;
  if (window.location.pathname.startsWith('/login')) return;
  if (bouncing) return;
  bouncing = true;
  // A dead/revoked bearer won't heal — clear it (and the presence cookie) so
  // the client middleware can't redirect-loop a logged-out page load. Before
  // the flush, deliberately: a draft PUT with a dead credential will 401 too,
  // and must not recurse back into here.
  //
  // Where to: /login, back to here afterwards, for every login.
  const next = window.location.pathname + window.location.search;
  const to = `/login?next=${encodeURIComponent(next)}`;
  tokenStore.clear();
  const go = () => {
    window.location.href = to;
  };
  void runSessionFlushes().then(go, go);
}

/** Rewrites a request path before it is sent (the app registers one: a
 *  create names the switcher's workspace, workspaces W6b). */
export type PathRewrite = (path: string, method: string) => string;

let pathRewrite: PathRewrite | null = null;

/** Register the app's path rewrite (null: none). */
export function setPathRewrite(rewrite: PathRewrite | null): void {
  pathRewrite = rewrite;
}

/** `path` as apiFetch sends it for `method`. */
export function rewritePath(path: string, method = 'GET'): string {
  return pathRewrite ? pathRewrite(path, method.toUpperCase()) : path;
}

/** Fetch a JSON resource, returning the parsed body or throwing `ApiError`. */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const sent = rewritePath(path, init?.method ?? 'GET');
  const res = await fetch(`${apiBaseValue()}${sent}`, withAuth(init));
  if (isAuthFailure(res)) {
    bounceToLogin();
    throw new ApiError('unauthorized', 401);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(errorMessageOf(body, res), res.status, body);
  return body as T;
}

/**
 * The words an error body gives the user. A refusal of the session guard is
 * `{ error: 'forbidden', reason, message }` (workspaces W6b: 403
 * item-workspace, 403 workspace): `error` is a code there, so the brain's
 * `message` is shown. Every other body keeps its `error` text.
 */
export function errorMessageOf(
  body: Record<string, unknown>,
  res: Pick<Response, 'status' | 'statusText'>,
): string {
  if (body.error === 'forbidden' && typeof body.message === 'string' && body.message) {
    return body.message;
  }
  return typeof body.error === 'string' ? body.error : `${res.status} ${res.statusText}`;
}

/**
 * Open an SSE stream over the `/api/**` surface — the EventSource replacement
 * for a detached client. `EventSource` can't set an `Authorization` header or
 * honor `NEXT_PUBLIC_MANTLE_API_BASE`, so it's cookie/same-origin only; this
 * fetch-based reader carries the base-URL + bearer exactly like `apiFetch`.
 *
 * Calls `onMessage` once per `data:` frame (comments `:`/keep-alives are
 * skipped); a throwing `onMessage` is routed to `onError` without dropping the
 * connection. Auto-reconnects with exponential backoff + jitter on a
 * dropped/closed connection, mirroring EventSource — but stops (and bounces to
 * /login) on an auth failure. Returns a disposer; call it on unmount to close
 * the stream.
 *
 * **`Last-Event-ID` resume** (full EventSource parity): tracks each frame's `id:`
 * field and re-sends it as the `Last-Event-ID` header on every reconnect, so a
 * server that buffers events (e.g. the turn stream's `turn_stream_buffer`) can
 * replay exactly what was missed during the drop — no gap, no duplicate. Harmless
 * for streams that emit no `id:` or servers that ignore the header (it just
 * live-tails as before).
 */
export function apiEventStream(
  path: string,
  onMessage: (data: string) => void,
  opts?: {
    onError?: (err: unknown) => void;
    /** Bound CONSECUTIVE failed reconnects — after this many, `onExhausted`
     *  fires instead of retrying forever. The member wrapper has carried these
     *  since v0.6.53; the owner one did NOT, which is the whole reason the
     *  owner surfaces' "silent fallback" was silent: a consumer that wanted to
     *  hear the ending had no way to ask. Omit both for the original
     *  reconnect-forever behavior (owner realtime, which has no spinner to
     *  strand). */
    maxAttempts?: number;
    onExhausted?: () => void;
    /** Every frame the stream delivers, a keep-alive comment included: a
     *  consumer that watches for a silent stream (the messenger) hears it
     *  breathe. */
    onActivity?: () => void;
    /** Each successful (re)connect: what was missed while it was down is
     *  for the consumer to fetch. */
    onConnect?: () => void;
  },
): () => void {
  return eventStreamCore(
    (headers, signal) => fetch(`${apiBaseValue()}${path}`, withAuth({ signal, headers })),
    bounceToLogin,
    onMessage,
    opts,
  );
}

/**
 * The transport-agnostic SSE reader behind `apiEventStream`: how a request
 * is made (base + credential) and what an auth failure does are parameters,
 * everything else (frame parsing, Last-Event-ID resume, backoff+jitter
 * reconnect, 404-silent-fallback) is this loop. It had a second caller, the
 * retired team portal's stream; app code uses the bound wrapper.
 */
export function eventStreamCore(
  makeRequest: (headers: Record<string, string>, signal: AbortSignal) => Promise<Response>,
  onAuthFailure: () => void,
  onMessage: (data: string) => void,
  opts?: {
    onError?: (err: unknown) => void;
    /** Give up after this many CONSECUTIVE failed attempts (a successful
     *  connect resets the count) and call `onExhausted` instead of retrying
     *  forever. Consumers whose durable state can reconcile a missed ending
     *  (the team turn streams) use this so an outage can't strand a spinner;
     *  absent ⇒ the original reconnect-forever behavior (owner realtime). */
    maxAttempts?: number;
    onExhausted?: () => void;
    onActivity?: () => void;
    onConnect?: () => void;
  },
): () => void {
  const controller = new AbortController();
  let closed = false;
  let attempt = 0;
  // The last `id:` we successfully observed — resent on reconnect to resume.
  let lastEventId: string | null = null;

  const run = async (): Promise<void> => {
    while (!closed) {
      try {
        const headers: Record<string, string> = { Accept: 'text/event-stream' };
        if (lastEventId !== null) headers['Last-Event-ID'] = lastEventId;
        const res = await makeRequest(headers, controller.signal);
        if (isAuthFailure(res)) {
          onAuthFailure();
          return; // auth failure won't self-heal — don't reconnect.
        }
        if (res.status === 404) {
          // The stream route doesn't exist — the feature is off server-side
          // (MANTLE_TURN_STREAMING=0). That won't self-heal, so fall back to the
          // non-streaming flow silently instead of reconnecting forever. This is
          // what lets the server be the single source of truth even though the
          // client gate is baked at build time.
          //
          // "Silently" means no retry and no error, NOT no ending: a consumer
          // that registered `onExhausted` did so to be told when the stream is
          // over, and a 404 ends it as terminally as a run of failed reconnects.
          // Without this the team chat and forum spinners never came down on a
          // server with streaming off — they wait for the terminal `done` frame
          // that a 404 guarantees will never arrive. Owner consumers pass no
          // `onExhausted`, so the fallback stays exactly as silent for them.
          opts?.onExhausted?.();
          return;
        }
        if (!res.ok || !res.body) throw new ApiError(`stream failed (${res.status})`, res.status);

        attempt = 0; // connected — reset backoff.
        opts?.onConnect?.();
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          // Frames are separated by a blank line; flush each complete one.
          let sep: number;
          while ((sep = buf.search(/\r\n\r\n|\n\n/)) !== -1) {
            const frame = buf.slice(0, sep);
            buf = buf.slice(sep + (buf[sep] === '\r' ? 4 : 2));
            const lines = frame.split(/\r\n|\n/);
            opts?.onActivity?.();
            const data = lines
              .filter((l) => l.startsWith('data:'))
              .map((l) => l.slice(5).replace(/^ /, ''))
              .join('\n');
            // Remember the event id for Last-Event-ID resume (EventSource parity).
            // Per the SSE spec an id containing a NUL is ignored; otherwise it
            // persists as the last id, even across later id-less events.
            const idLine = lines.find((l) => l.startsWith('id:'));
            if (idLine !== undefined) {
              const id = idLine.slice(3).replace(/^ /, '');
              if (!id.includes('\u0000')) lastEventId = id;
            }
            if (data) {
              // A throwing consumer is a consumer bug, not a connection fault —
              // route it to onError but keep reading; never let it reach the
              // outer catch (which would treat it as a drop and reconnect).
              try {
                onMessage(data);
              } catch (cbErr) {
                opts?.onError?.(cbErr);
              }
            }
          }
        }
      } catch (err) {
        if (closed || controller.signal.aborted) return;
        opts?.onError?.(err);
      }
      if (closed) return;
      attempt += 1;
      if (opts?.maxAttempts !== undefined && attempt > opts.maxAttempts) {
        // Consecutive failures exhausted — stop and let the consumer reconcile
        // against its durable state rather than spinning forever.
        opts.onExhausted?.();
        return;
      }
      // Exponential backoff with full-ish jitter: a synchronously-failing
      // endpoint doesn't get hammered ~1×/s, and a deploy/restart doesn't make
      // every tab reconnect in lockstep (thundering herd). Resets to 0 above on
      // a successful connect.
      const ceiling = Math.min(30_000, 1000 * 2 ** attempt);
      await new Promise((r) => setTimeout(r, ceiling * (0.5 + Math.random() * 0.5)));
    }
  };

  void run();
  return () => {
    closed = true;
    controller.abort();
  };
}

/** POST/PATCH/DELETE JSON helper — sets the content-type + serializes the body. */
export function apiSend<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<T> {
  return apiFetch<T>(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
