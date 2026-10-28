'use client';

/**
 * The messenger outside the Chats screen (Messenger V1 Phase 2, M3), mounted
 * once by the shell for every login with a chat:
 *
 * - `useMessengerUnread()` reads GET /api/messenger/unread, the rail's one
 *   count (people, groups and assistant replies). A 404 means the brain has
 *   no messenger: the Chats entry hides (sidebar-nav.tsx) and nothing else
 *   here runs.
 * - `MessengerShell` keeps the live connection (`MessengerLiveSync`) while
 *   the tab is visible (a background browser tab gives the brain's
 *   per-login stream slot back; the desktop window keeps it), pops a toast
 *   for a new message in a chat that is not on screen (its author and first
 *   line; Open goes to it), sends it to the OS instead while the desktop
 *   window is hidden, and keeps the desktop shell's badge on the count. A
 *   muted chat counts and never pops; a chat the list does not know yet
 *   does not pop either.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { desktopShell } from '@mantle/web-ui/desktop-shell';
import { useToast } from '@mantle/web-ui/ui/toast';
import { CONVERSATIONS_KEY } from '@/components/assistant/use-assistant-unread';
import { useShellWorkspaces } from '@/components/workspaces/use-shell-workspaces';
import { useDocumentVisible } from '@/lib/use-document-visible';
import { messengerApi, messengerKeys } from '@/lib/messenger/api';
import type { MessengerListRow } from '@/lib/messenger/dto';
import {
  liveStreamWanted,
  messengerAvailability,
  noticeRoute,
  noticeText,
  openChatId,
  railCount,
  shouldPop,
} from '@/lib/messenger/notify';
import { CallUnloadGuard } from '@/components/calls/call-store';
import { MessengerLiveSync, useMessengerBus } from './messenger-live';

/** A slow safety net: the stream refreshes the count on every event. */
const UNREAD_REFRESH_MS = 60_000;
/** The list a notice decides on may be this old (an event or a gap marks it
 *  stale at once, so a mute is seen right away). */
const NOTICE_LIST_FRESH_MS = 30_000;
/** The notices remembered so the event and the list never pop one twice. */
const SHOWN_KEEP = 200;

/** The rail's count and whether this brain has the messenger. */
export function useMessengerUnread(): {
  available: 'yes' | 'no' | 'unknown';
  total: number;
} {
  const q = useQuery({
    queryKey: messengerKeys.unread,
    queryFn: messengerApi.unread,
    refetchInterval: (query) =>
      messengerAvailability({ data: query.state.data, error: query.state.error }) === 'no'
        ? false
        : UNREAD_REFRESH_MS,
    retry: (n, err) => (err as { status?: number } | null)?.status !== 404 && n < 2,
  });
  return {
    available: messengerAvailability({ data: q.data, error: q.error }),
    total: railCount(q.data),
  };
}

export function MessengerShell() {
  const { available, total } = useMessengerUnread();
  // Only a 404 says there is no messenger; a failed count (a blip, a 500)
  // keeps the live parts running.
  const on = available !== 'no';
  const visible = useDocumentVisible();
  const [desktop, setDesktop] = useState(false);
  useEffect(() => setDesktop(!!desktopShell()), []);
  const live = on && liveStreamWanted({ visible, desktop });

  // The desktop shell's badge follows the count, and clears when this
  // window stops counting (signed out, no messenger).
  useEffect(() => {
    const shell = desktopShell();
    if (!shell) return;
    shell.setBadge(available === 'yes' ? total : 0);
  }, [available, total]);
  useEffect(() => () => desktopShell()?.setBadge(0), []);

  if (!on) return null;
  return (
    <>
      <MessengerLiveSync enabled={live} />
      {live ? <MessengerNotices /> : null}
      <AssistantReadFollower />
      <CallUnloadGuard />
    </>
  );
}

/**
 * A toast (or, from a hidden desktop window, an OS notice) for each new
 * message that should pop: on a stream event, and from the list itself when
 * a gap or the silent-stream poll finds a chat moved (the stream said
 * nothing about it).
 */
function MessengerNotices() {
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const me = useShellWorkspaces()?.loginId ?? null;
  const path = useRef(pathname);
  path.current = pathname;
  const shown = useRef(new Set<string>());
  // The last seq seen of each chat; null until the first list.
  const known = useRef<Map<string, number> | null>(null);

  // The desktop shell opens a notice's path in this window when it is clicked.
  useEffect(() => {
    const shell = desktopShell();
    return shell?.onNavigate?.((p) => {
      if (p.startsWith('/chats/')) router.push(p);
    });
  }, [router]);

  const freshList = useCallback(
    () =>
      queryClient.fetchQuery({
        queryKey: messengerKeys.list,
        queryFn: messengerApi.list,
        staleTime: NOTICE_LIST_FRESH_MS,
      }),
    [queryClient],
  );

  const pop = useCallback(
    async (c: string, seq: number, rows: MessengerListRow[]) => {
      const key = `${c}:${seq}`;
      if (shown.current.has(key)) return;
      shown.current.add(key);
      // Only recent keys matter (a seq comes once from each path).
      if (shown.current.size > SHOWN_KEEP) {
        shown.current.delete(shown.current.values().next().value!);
      }
      const row = rows.find((r) => r.id === c && r.kind !== 'agent');
      // A chat the list does not know (yet), or a muted one: no notice.
      if (!row || row.muted) return;
      const hidden = document.visibilityState !== 'visible';
      if (openChatId(path.current) === c && !hidden) return;
      const page = await messengerApi.messages(c, { afterSeq: seq - 1, limit: 1 });
      const message = page.messages.find((m) => m.seq === seq);
      if (!message || !shouldPop({ message, me, muted: row.muted, onScreen: false })) return;
      const text = noticeText(message, row.kind === 'group' ? row.title : null);
      const href = `/chats/${encodeURIComponent(c)}`;
      const shell = desktopShell();
      const route = noticeRoute({
        desktop: !!shell,
        visible: document.visibilityState === 'visible',
      });
      if (shell && route === 'os') {
        shell.notify({ title: text.title, body: text.body, path: href });
        return;
      }
      toast.push({
        kind: 'info',
        message: text.body ? `${text.title}: ${text.body}` : text.title,
        action: { label: 'Open', onClick: () => router.push(href) },
      });
    },
    [me, router, toast],
  );

  // What moved since the last list: the gap and the silent-stream poll
  // carry no event, so the list itself says which chats have a new line.
  const fromList = useCallback(
    (rows: MessengerListRow[]) => {
      const first = known.current === null;
      const seen = known.current ?? new Map<string, number>();
      for (const r of rows) {
        if (r.kind === 'agent' || r.lastSeq === null) continue;
        const was = seen.get(r.id);
        seen.set(r.id, Math.max(was ?? 0, r.lastSeq));
        if (!first && r.lastSeq > (was ?? 0) && r.unread > 0) {
          void pop(r.id, r.lastSeq, rows).catch(() => {});
        }
      }
      known.current = seen;
    },
    [pop],
  );

  // The baseline: what is already there never pops.
  useEffect(() => {
    void freshList()
      .then(fromList)
      .catch(() => {});
  }, [freshList, fromList]);

  useMessengerBus((e) => {
    if (e.kind === 'gap') {
      // MessengerLiveSync marked the list stale: this fetches it again.
      void freshList()
        .then(fromList)
        .catch(() => {});
      return;
    }
    const { c, newSeq } = e.effect;
    if (newSeq === null) return;
    void freshList()
      .then((rows) => {
        known.current?.set(c, Math.max(known.current.get(c) ?? 0, newSeq));
        return pop(c, newSeq, rows);
      })
      .catch(() => {
        /* a notice is best effort; the list and the badge still show it */
      });
  });
  return null;
}

/**
 * The assistant threads' read cursor moves outside the messenger (the
 * thread marks itself read, use-assistant-unread.ts); when it does, the
 * agent rows and the rail count follow.
 */
function AssistantReadFollower() {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        const key = event.query.queryKey;
        // A fresh answer only, not every fetch-state change.
        if (event.type !== 'updated' || event.action.type !== 'success') return;
        if (key[0] !== CONVERSATIONS_KEY[0] || key[1] !== CONVERSATIONS_KEY[1]) return;
        void queryClient.invalidateQueries({ queryKey: messengerKeys.list });
        void queryClient.invalidateQueries({ queryKey: messengerKeys.unread });
      }),
    [queryClient],
  );
  return null;
}
