'use client';

import { useEffect, useRef } from 'react';
import { apiEventStream } from '@mantle/web-ui/api-fetch';
import { useShellRole } from '@/components/layout/shell-role';
import { realtimeStreamPath } from '@/lib/realtime-stream';

export type RealtimeChange = { type: string; id: string };

/**
 * All `useRealtime()` consumers share ONE `/api/realtime` connection per tab:
 * a module-level singleton that fans out to every subscriber and filters by
 * type client-side. Per-hook connections exhausted the browser's HTTP/1.1
 * ~6-per-origin pool: ~4 held-open SSE sockets app-wide (sidebar pending badge,
 * pending-question sync, runs strip, a list screen) left ordinary `fetch`es
 * starving intermittently, the tables "spinner-forever" over the plain-`http://`
 * workstation dev path (prod negotiates HTTP/2, which multiplexes, so it was
 * dev-only). Collapsing to one socket removes the pressure and makes the
 * duplicate `pending_tool_call` subscription harmless (two subscribers, one
 * stream).
 *
 * The server route's `?types=` filter is only a bandwidth nicety, an unfiltered
 * stream is already owner-scoped, so the per-consumer type filter moved here.
 * Reconnect/backoff/auth-bounce all still come from `apiEventStream` unchanged.
 *
 * Which stream (phase W5c: one shell for every login): the shell's role picks
 * it (lib/realtime-stream.ts). An admin reads /api/realtime, a member the
 * kept /api/member/realtime (it carries no event since W8): /api/realtime is
 * the owner's, and a refused stream would only reconnect for ever. One shared
 * connection per stream path.
 */
type Subscriber = {
  types: string[] | null;
  cb: (c: RealtimeChange) => void;
  /** Every frame, keep-alives included (the messenger's silence watch). */
  onActivity?: () => void;
  /** Each (re)connect of the shared stream (the messenger's gap fetch). */
  onConnect?: () => void;
};

type Stream = {
  subscribers: Map<number, Subscriber>;
  stop: (() => void) | null;
  linger: ReturnType<typeof setTimeout> | null;
};

const streams = new Map<string, Stream>();
let nextId = 1;

function streamFor(path: string): Stream {
  let s = streams.get(path);
  if (!s) {
    s = { subscribers: new Map(), stop: null, linger: null };
    streams.set(path, s);
  }
  return s;
}

/** Open the shared stream for `path` if it isn't already running. */
function ensureStream(path: string, s: Stream): void {
  if (s.stop) return;
  const each = (fn: (sub: Subscriber) => void) => {
    for (const sub of s.subscribers.values()) {
      try {
        fn(sub);
      } catch {
        /* one consumer's bug must not break the fan-out to the others */
      }
    }
  };
  s.stop = apiEventStream(
    path,
    (data) => {
      let change: RealtimeChange;
      try {
        change = JSON.parse(data) as RealtimeChange;
      } catch {
        return; // ignore malformed frame
      }
      each((sub) => {
        if (sub.types && !sub.types.includes(change.type)) return;
        sub.cb(change);
      });
    },
    {
      onActivity: () => each((sub) => sub.onActivity?.()),
      onConnect: () => each((sub) => sub.onConnect?.()),
    },
  );
}

/** Register a subscriber against the shared stream; returns an unsubscribe
 *  fn. Exported for use-realtime.test.ts: every subscriber of one path shares
 *  one connection. */
export function subscribeRealtime(path: string, sub: Subscriber): () => void {
  const s = streamFor(path);
  const id = nextId++;
  s.subscribers.set(id, sub);
  if (s.linger) {
    clearTimeout(s.linger);
    s.linger = null;
  }
  ensureStream(path, s);
  return () => {
    s.subscribers.delete(id);
    if (s.subscribers.size > 0) return;
    // Linger before closing so a route transition (last subscriber unmounts,
    // next mounts a frame later) and StrictMode's mount, unmount, mount don't
    // churn the underlying connection.
    s.linger = setTimeout(() => {
      s.linger = null;
      if (s.subscribers.size === 0) {
        s.stop?.();
        s.stop = null;
      }
    }, 5_000);
  };
}

/**
 * Subscribe to live node changes over SSE (/api/realtime). Calls `onChange`
 * whenever a node of one of the given `types` is created/ingested for the
 * current owner, e.g. `useRealtime(['event'], () => router.refresh())` makes a
 * server-rendered screen repaint the moment the data changes, no manual refresh.
 * An empty `types` array subscribes to every type.
 *
 * Backed by a single shared connection per tab (see the module comment above),
 * itself built on `apiEventStream` (not raw `EventSource`) so a detached/Electron
 * client can carry the base-URL + bearer, `EventSource` can do neither. It
 * auto-reconnects with exponential backoff + jitter, so transient drops
 * self-heal; the connection closes once the last subscriber unmounts.
 *
 * **Best-effort by design, NOT guaranteed delivery.** The server side is a
 * Postgres LISTEN/NOTIFY bridge (ephemeral pub/sub, no replayable backlog), so
 * there's no `Last-Event-ID` resumption: a change that fires *during* a
 * reconnect gap is missed. This is a "ping to refetch" trigger, not a data
 * channel, the next change re-pings and the screen catches up, so a stale row
 * self-heals on the following event. For a screen that must not miss the gap,
 * pair this with a periodic `refetchInterval` on its query as a safety net.
 */
export function useRealtime(
  types: string[],
  onChange: (c: RealtimeChange) => void,
  /** `enabled: false` subscribes to nothing. */
  opts: { enabled?: boolean } = {},
): void {
  // Keep the latest callback without re-registering the subscriber each render.
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  const key = types.join(',');
  const path = realtimeStreamPath(useShellRole());
  const enabled = opts.enabled !== false && path !== null;
  useEffect(() => {
    if (typeof window === 'undefined' || !enabled || !path) return;
    const filter = key ? key.split(',') : null; // '' means all types, as before
    return subscribeRealtime(path, { types: filter, cb: (c) => cbRef.current(c) });
  }, [key, enabled, path]);
}
