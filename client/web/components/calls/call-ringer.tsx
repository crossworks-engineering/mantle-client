'use client';

/**
 * The ring (calls plan section 5), headless: mounted by the messenger shell
 * beside its notices while the tab has the stream. A new message on the
 * bus is fetched; a "call started" line that should ring (lib/calls/ring.ts)
 * rings the session, asks the desktop for attention and, from a hidden
 * desktop window, sends the OS notice (its click opens the chat through the
 * notices' own navigation handler); a "call ended" or "call cap" line stops
 * the ring, and closes the call this tab is in. A hidden browser tab keeps
 * no stream, so it rings nothing, like the notices (liveStreamWanted). The
 * lines of one chat are handled in order, so an end heard right after a
 * start is seen before the start rings.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { desktopShell } from '@mantle/web-ui/desktop-shell';
import { useMessengerBus } from '@/components/messenger/messenger-live';
import { useShellWorkspaces } from '@/components/workspaces/use-shell-workspaces';
import { messengerApi, messengerKeys } from '@/lib/messenger/api';
import type { MessengerListRow } from '@/lib/messenger/dto';
import { noticeRoute } from '@/lib/messenger/notify';
import { RingBook, callEventOf, callerNameOf, ringText, shouldRing } from '@/lib/calls/ring';
import { callSession } from './call-store';

/** The list a ring decides on may be this old (an event marks it stale). */
const RING_LIST_FRESH_MS = 30_000;

export function CallRinger() {
  const queryClient = useQueryClient();
  const me = useShellWorkspaces()?.loginId ?? null;
  const meRef = useRef(me);
  meRef.current = me;
  const book = useRef(new RingBook());
  /** One chain per chat: its lines in order. */
  const chains = useRef(new Map<string, Promise<void>>());

  const freshList = useCallback(
    () =>
      queryClient.fetchQuery({
        queryKey: messengerKeys.list,
        queryFn: messengerApi.list,
        staleTime: RING_LIST_FRESH_MS,
      }),
    [queryClient],
  );

  const handleOne = useCallback(
    async (c: string, seq: number, rows: MessengerListRow[], live: boolean) => {
      if (!book.current.claim(c, seq)) return;
      const row = rows.find((r) => r.id === c && r.kind !== 'agent');
      if (!row) return;
      let message;
      try {
        const page = await messengerApi.messages(c, { afterSeq: seq - 1, limit: 1 });
        message = page.messages.find((m) => m.seq === seq);
      } catch {
        // The gap path may try this line again.
        book.current.release(c, seq);
        return;
      }
      const event = message ? callEventOf(message) : null;
      if (!message || !event) return;
      const session = callSession();
      if (event.type !== 'call_started') {
        session.remoteEnded(c, event.callId);
        return;
      }
      const callerName = callerNameOf(message);
      const myName = row.participants.find((p) => p.id === meRef.current)?.name ?? null;
      const mine =
        session.startedRecently(c) || session.hasEnded(event.callId) || myName === callerName;
      const busy = session.snapshot().phase !== 'idle';
      if (!shouldRing({ message, muted: row.muted, mine, busy, live, now: Date.now() })) return;
      const groupTitle = row.kind === 'group' ? row.title : null;
      session.incoming({
        conversationId: c,
        callId: event.callId,
        seq,
        callerName,
        groupTitle,
        since: Date.now(),
      });
      if (session.snapshot().phase !== 'ringing') return;
      const shell = desktopShell();
      if (shell) {
        shell.attention?.();
        if (
          noticeRoute({ desktop: true, visible: document.visibilityState === 'visible' }) === 'os'
        ) {
          const text = ringText(callerName, groupTitle);
          shell.notify({
            title: text.title,
            body: text.body,
            path: `/chats/${encodeURIComponent(c)}`,
          });
        }
      }
    },
    [],
  );

  const handle = useCallback(
    (c: string, seq: number, rows: MessengerListRow[], live: boolean) => {
      const prev = chains.current.get(c) ?? Promise.resolve();
      const next = prev.then(() => handleOne(c, seq, rows, live)).catch(() => {});
      chains.current.set(c, next);
      void next.then(() => {
        if (chains.current.get(c) === next) chains.current.delete(c);
      });
    },
    [handleOne],
  );

  /**
   * After a gap: the list says which chats moved. A ringing chat is read
   * after its start line too, so an end that landed in the gap stops the
   * ring (the list names only the last line).
   */
  const fromList = useCallback(
    (rows: MessengerListRow[]) => {
      for (const { c, seq } of book.current.moved(rows)) handle(c, seq, rows, false);
      const s = callSession().snapshot();
      if (s.phase === 'ringing' && s.ring) {
        const { conversationId, seq, callId } = s.ring;
        void messengerApi
          .messages(conversationId, { afterSeq: seq, limit: 50 })
          .then((page) => {
            for (const m of page.messages) {
              const e = callEventOf(m);
              if (e && e.type !== 'call_started' && e.callId === callId) {
                callSession().remoteEnded(conversationId, callId);
              }
            }
          })
          .catch(() => {});
      }
    },
    [handle],
  );

  useEffect(() => {
    void freshList()
      .then(fromList)
      .catch(() => {});
  }, [freshList, fromList]);

  useMessengerBus((e) => {
    if (e.kind === 'gap') {
      void freshList()
        .then(fromList)
        .catch(() => {});
      return;
    }
    const { c, newSeq } = e.effect;
    if (newSeq === null) return;
    book.current.heard(c, newSeq);
    void freshList()
      .then((rows) => handle(c, newSeq, rows, true))
      .catch(() => {
        /* a ring is best effort; the chat shows the line */
      });
  });

  return null;
}
