'use client';

/**
 * The messenger outside the Chats screen (Messenger V1 Phase 2, M3), mounted
 * once by the shell for every login with a chat:
 *
 * - `useMessengerUnread()` reads GET /api/messenger/unread, the rail's one
 *   count (people, groups and assistant replies). A 404 means the brain has
 *   no messenger: the Chats entry hides (sidebar-nav.tsx) and nothing else
 *   here runs.
 * - `MessengerShell` keeps the one live connection (`MessengerLiveSync`),
 *   pops a toast for a new message in a chat that is not on screen (its
 *   author and first line; Open goes to the chat), sends it to the OS
 *   instead while the desktop window is hidden, and keeps the desktop
 *   shell's dock or taskbar badge on the count. A muted chat counts and
 *   never pops.
 */
import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { desktopShell } from '@mantle/web-ui/desktop-shell';
import { useToast } from '@mantle/web-ui/ui/toast';
import { CONVERSATIONS_KEY } from '@/components/assistant/use-assistant-unread';
import { useShellWorkspaces } from '@/components/workspaces/use-shell-workspaces';
import { messengerApi, messengerKeys } from '@/lib/messenger/api';
import type { MessengerListRow } from '@/lib/messenger/dto';
import {
  messengerAvailability,
  noticeRoute,
  noticeText,
  openChatId,
  railCount,
  shouldPop,
} from '@/lib/messenger/notify';
import { MessengerLiveSync, useMessengerBus } from './messenger-live';

/** A slow safety net: the stream refreshes the count on every event. */
const UNREAD_REFRESH_MS = 60_000;

/** The rail's count and whether this brain has the messenger. */
export function useMessengerUnread(): { available: 'yes' | 'no' | 'unknown'; total: number } {
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
  const on = available === 'yes';

  // The desktop shell's dock or taskbar badge follows the count.
  useEffect(() => {
    const desktop = desktopShell();
    if (!desktop || !on) return;
    desktop.setBadge(total);
  }, [on, total]);

  if (!on) return null;
  return (
    <>
      <MessengerLiveSync />
      <MessengerNotices />
      <AssistantReadFollower />
    </>
  );
}

/** A toast (or, from a hidden desktop window, an OS notice) for each new
 *  message that should pop. */
function MessengerNotices() {
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const me = useShellWorkspaces()?.loginId ?? null;
  const path = useRef(pathname);
  path.current = pathname;
  const shown = useRef(new Set<string>());

  // The desktop shell opens a notice's path in this window when it is clicked.
  useEffect(() => {
    const desktop = desktopShell();
    return desktop?.onNavigate?.((p) => {
      if (p.startsWith('/chats/')) router.push(p);
    });
  }, [router]);

  useMessengerBus((e) => {
    if (e.kind !== 'effect' || e.effect.newSeq === null) return;
    const { c, newSeq } = e.effect;
    const key = `${c}:${newSeq}`;
    if (shown.current.has(key)) return;
    shown.current.add(key);
    const rows = queryClient.getQueryData<MessengerListRow[]>(messengerKeys.list);
    const row = rows?.find((r) => r.id === c && r.kind !== 'agent');
    const hidden = typeof document !== 'undefined' && document.visibilityState !== 'visible';
    const onScreen = openChatId(path.current) === c && !hidden;
    // Muted or on screen: no need to fetch the line at all.
    if (row?.muted || onScreen) return;
    void messengerApi
      .messages(c, { afterSeq: newSeq - 1, limit: 1 })
      .then((page) => {
        const message = page.messages.find((m) => m.seq === newSeq);
        if (!message) return;
        // The row may have arrived since (the list refetches on the event).
        const fresh = queryClient
          .getQueryData<MessengerListRow[]>(messengerKeys.list)
          ?.find((r) => r.id === c && r.kind !== 'agent');
        const muted = (fresh ?? row)?.muted ?? false;
        if (!shouldPop({ message, me, muted, onScreen: false })) return;
        const group = (fresh ?? row)?.kind === 'group' ? ((fresh ?? row)?.title ?? null) : null;
        const text = noticeText(message, group);
        const href = `/chats/${encodeURIComponent(c)}`;
        const desktop = desktopShell();
        const route = noticeRoute({
          desktop: !!desktop,
          visible: document.visibilityState === 'visible',
        });
        if (desktop && route === 'os') {
          desktop.notify({ title: text.title, body: text.body, path: href });
          return;
        }
        toast.push({
          kind: 'info',
          message: text.body ? `${text.title}: ${text.body}` : text.title,
          action: { label: 'Open', onClick: () => router.push(href) },
        });
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
        if (key[0] !== CONVERSATIONS_KEY[0]) return;
        if (key[1] !== CONVERSATIONS_KEY[1]) return;
        void queryClient.invalidateQueries({ queryKey: messengerKeys.list });
        void queryClient.invalidateQueries({ queryKey: messengerKeys.unread });
      }),
    [queryClient],
  );
  return null;
}
