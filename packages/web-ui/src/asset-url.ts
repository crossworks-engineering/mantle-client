/**
 * Client-side resolver for browser-native asset sources — the `<img>`/`<iframe>`/
 * download `src`s pointing at `/api/files/files/[id]?raw=1`,
 * `/api/attachments/[id]` and `/api/export/[id]` (the download-anchor export
 * surface). Those loaders can't send the `Authorization` header
 * that `apiFetch` uses, so in a detached client (cross-origin, no
 * session cookie) they'd 401.
 *
 * Same-origin (the normal case): returns the path unchanged — the session cookie
 * authenticates, exactly as before. Detached (`NEXT_PUBLIC_MANTLE_API_BASE` set):
 * targets the remote origin and appends the short-lived `?at=` asset token minted
 * by `GET /api/shell` (see `buildAssetToken`/`getOwnerForAsset` in lib/auth and
 * the asset-path acceptance in middleware.ts).
 *
 * ## The token arrives late, and then it rotates
 *
 * `assetUrl` is synchronous, but the token it signs with is not: `AppShell`
 * publishes it from the `GET /api/shell` response, and refreshes it on a timer
 * (`assetTokenRefreshDelayMs`). Anything resolved before that first publish gets
 * an unsigned URL that 401s, and nothing re-resolved it when the token landed.
 *
 * So the token is a tiny STORE, not a variable, with two ways to wait on it:
 *
 *   - `subscribeAssetToken` + `assetTokenVersion` — the `useSyncExternalStore`
 *     pair behind `useAssetUrl()`, for anything that resolves a URL while
 *     rendering. Re-renders on arrival AND on rotation.
 *   - `assetTokenReady()` — a promise for imperative callers that `fetch()` a
 *     signed URL from outside React (Excalidraw scene files, the draw-embed
 *     theme probe). Resolves immediately same-origin, where there is no token
 *     to wait for and blocking would be a hang for no reason.
 *
 * A hook alone could not have been the answer: three of the call sites are
 * plain modules feeding TipTap node views and Excalidraw, outside React.
 */

import { isCrossOrigin, runtimeApiBase } from './runtime-env';

/** Resolved at call time (runtime config first) — see api-fetch.ts. */
function apiBaseValue(): string {
  return runtimeApiBase();
}

let assetToken: string | null = null;

/** Bumped on every real change, and read as the `useSyncExternalStore`
 *  snapshot. A counter rather than the token itself so the value in React's
 *  hands is never the credential. */
let tokenVersion = 0;

const listeners = new Set<() => void>();

/** Imperative callers parked in `assetTokenReady()`, released by the next
 *  token. Cleared on release; a timed-out waiter is inert, not removed. */
let waiters: Array<() => void> = [];

/**
 * How long an imperative caller waits before giving up and fetching unsigned.
 *
 * Bounded on purpose. Awaiting forever would turn "the shell never answered"
 * (or a sign-out, which sets the token back to null) into a canvas that hangs
 * with no image and no error — louder than the 401 it was trying to prevent.
 * Timing out reproduces exactly today's behaviour instead.
 */
const READY_TIMEOUT_MS = 5_000;

/** Set by `AppShell` from the `GET /api/shell` response, and again on each
 *  refresh. Only used in detached mode; harmless to set same-origin (where
 *  `assetUrl` ignores it). */
export function setAssetToken(token: string | null | undefined): void {
  const next = token ?? null;
  // A refetch that returns the same token is the common case (the shell query
  // re-runs for reasons other than rotation); re-rendering every asset on the
  // page for it would be pure waste.
  if (next === assetToken) return;
  assetToken = next;
  tokenVersion += 1;
  if (next) {
    const released = waiters;
    waiters = [];
    for (const release of released) release();
  }
  // Copied: a listener may unsubscribe during its own notification.
  for (const listener of [...listeners]) listener();
}

/** Subscribe to token arrival and rotation. Returns the unsubscribe. */
export function subscribeAssetToken(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Snapshot for `useSyncExternalStore` — changes when the token does. */
export function assetTokenVersion(): number {
  return tokenVersion;
}

/**
 * Resolves once `assetUrl()` can sign — for callers that `fetch()` outside
 * React. Immediate same-origin (nothing to sign with) and immediate once a
 * token is held; otherwise waits for the next one, up to `READY_TIMEOUT_MS`.
 */
export function assetTokenReady(): Promise<void> {
  if (!isCrossOrigin() || assetToken) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const release = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    waiters.push(release);
    setTimeout(release, READY_TIMEOUT_MS);
  });
}

/** Resolve a raw-asset path to a loadable URL (see module comment). */
export function assetUrl(path: string): string {
  // A real origin comparison, not "is a base configured": a same-origin box
  // that sets a base is NOT split, and signing its own paths with `?at=` put
  // a short-lived token in every <img> src (and so in history and logs) for
  // no benefit. Same-origin returns the path unchanged and the session cookie
  // authenticates — which is why the shell fires `upgradeOwnerCookie()` for
  // bearer-only sessions before assets paint.
  if (!isCrossOrigin()) return path;
  const base = `${apiBaseValue()}${path}`;
  if (!assetToken) return base; // token not loaded yet — will 401 until shell resolves
  return `${base}${path.includes('?') ? '&' : '?'}at=${encodeURIComponent(assetToken)}`;
}
