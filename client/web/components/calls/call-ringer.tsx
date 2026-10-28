'use client';

/**
 * The ring (calls plan section 5), headless: mounted by the messenger shell
 * beside its notices while the tab has the stream. A new message on the
 * bus is fetched; a "call started" line that should ring (lib/calls/ring.ts)
 * rings the session, sounds the web's soft tone, asks the desktop for
 * attention and, from a hidden desktop window, sends the OS notice; a
 * "call ended" or "call cap" line stops the ring, and closes the call this
 * tab is in. A hidden browser tab keeps no stream, so it rings nothing,
 * like the notices (liveStreamWanted).
 */
import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { desktopShell } from '@mantle/web-ui/desktop-shell';
import { useMessengerBus } from '@/components/messenger/messenger-live';
import { messengerApi, messengerKeys } from '@/lib/messenger/api';
import type { MessengerListRow } from '@/lib/messenger/dto';
import { noticeRoute } from '@/lib/messenger/notify';
import { callEventOf, callerNameOf, ringText, shouldRing } from '@/lib/calls/ring';
import { startRingTone, type RingTone } from '@/lib/calls/ring-tone';
import { callSession, useCallState } from './call-store';

/** The list a ring decides on may be this old (an event marks it stale). */
const RING_LIST_FRESH_MS = 30_000;
/** The lines remembered so a seq is handled once (the event and a gap). */
const SEEN_KEEP = 200;

export function CallRinger() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const seen = useRef(new Set<string>());
  const known = useRef<Map<string, number> | null>(null);

  // The desktop opens a ring's chat when its notice is clicked (the card
  // is still there to answer).
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
        staleTime: RING_LIST_FRESH_MS,
      }),
    [queryClient],
  );

  const handle = useCallback(async (c: string, seq: number, rows: MessengerListRow[]) => {
    const key = `${c}:${seq}`;
    if (seen.current.has(key)) return;
    seen.current.add(key);
    if (seen.current.size > SEEN_KEEP) {
      seen.current.delete(seen.current.values().next().value!);
    }
    const row = rows.find((r) => r.id === c && r.kind !== 'agent');
    if (!row) return;
    const page = await messengerApi.messages(c, { afterSeq: seq - 1, limit: 1 });
    const message = page.messages.find((m) => m.seq === seq);
    const event = message ? callEventOf(message) : null;
    if (!message || !event) return;
    const session = callSession();
    if (event.type !== 'call_started') {
      session.remoteEnded(c, event.callId);
      return;
    }
    const busy = session.snapshot().phase !== 'idle';
    if (!shouldRing({ message, muted: row.muted, busy, now: Date.now() })) return;
    const groupTitle = row.kind === 'group' ? row.title : null;
    session.incoming({
      conversationId: c,
      callId: event.callId,
      seq,
      callerName: callerNameOf(message),
      groupTitle,
      since: Date.now(),
    });
    const shell = desktopShell();
    if (shell) {
      shell.attention?.();
      if (
        noticeRoute({ desktop: true, visible: document.visibilityState === 'visible' }) === 'os'
      ) {
        const text = ringText(callerNameOf(message), groupTitle);
        shell.notify({
          title: text.title,
          body: text.body,
          path: `/chats/${encodeURIComponent(c)}`,
        });
      }
    }
  }, []);

  // What moved since the last list: a gap carries no event, so the list
  // itself says which chats have a new line (a call line among them).
  const fromList = useCallback(
    (rows: MessengerListRow[]) => {
      const first = known.current === null;
      const next = known.current ?? new Map<string, number>();
      for (const r of rows) {
        if (r.kind === 'agent' || r.lastSeq === null) continue;
        const was = next.get(r.id);
        next.set(r.id, Math.max(was ?? 0, r.lastSeq));
        if (!first && r.lastSeq > (was ?? 0)) void handle(r.id, r.lastSeq, rows).catch(() => {});
      }
      known.current = next;
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
    void freshList()
      .then((rows) => {
        known.current?.set(c, Math.max(known.current.get(c) ?? 0, newSeq));
        return handle(c, newSeq, rows);
      })
      .catch(() => {
        /* a ring is best effort; the chat shows the line */
      });
  });

  return <RingSound />;
}

/** The soft tone while the session rings. */
function RingSound() {
  const { phase } = useCallState();
  useEffect(() => {
    if (phase !== 'ringing') return;
    let tone: RingTone | null = null;
    try {
      tone = startRingTone();
    } catch {
      tone = null;
    }
    return () => tone?.stop();
  }, [phase]);
  return null;
}
