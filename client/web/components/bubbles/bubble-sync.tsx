'use client';

/**
 * Headless, mounted by the messenger shell while bubbles are on and the tab is
 * live: keeps the tab's bubble cards in step with the one chat list.
 *
 * The list is the only signal. The messenger stream and the assistant thread
 * stream already refresh it, for people and for assistants alike, and a gap
 * or a silent stream refreshes it too. So a line in either system takes one
 * path: the list changes, this reads that chat's new lines through the same
 * routes the chat uses (so a login sees only what it may read), and they
 * become cards. Reading the list again drops what was read anywhere.
 *
 * It opens no stream and starts no model call. Sounds stay where they are:
 * a person's line chimes in MessengerNotices (phase 3 brings the pops).
 */
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AssistantTimelineRow } from '@mantle/client-types';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import { useMessengerBus } from '@/components/messenger/messenger-live';
import { useViewerLogin } from '@/components/workspaces/use-shell-workspaces';
import {
  cardFromMessage,
  cardFromReply,
  chatsToSync,
  linesWanted,
  newestReplies,
  parseKey,
  rowSignature,
  type BubbleCard,
} from '@/lib/bubbles/cards';
import {
  forgetPin,
  getBubbleCards,
  getPinnedKeys,
  putPinnedBubble,
  reconcileBubbles,
  setBubbleChat,
  setBubbleLogin,
} from '@/lib/bubbles/store';
import { messengerApi, messengerKeys } from '@/lib/messenger/api';
import type { MessengerListRow } from '@/lib/messenger/dto';

/** A read elsewhere of an assistant thread raises no event: this catches it. */
const LIST_REFRESH_MS = 60_000;
/** Rows read of a thread: its replies with the person's lines between them. */
const THREAD_ROWS = 20;
/** Rows read of a thread just before a pinned reply's time: a few, in case
 *  two share a millisecond. */
const PINNED_THREAD_ROWS = 5;

async function cardsOf(row: MessengerListRow, me: string): Promise<BubbleCard[]> {
  const count = linesWanted(row.unread);
  if (row.kind === 'agent') {
    if (!row.agentSlug) return [];
    const qs = new URLSearchParams({ agent: row.agentSlug, limit: String(THREAD_ROWS) });
    const data = await apiFetch<{ messages?: AssistantTimelineRow[] }>(
      `/api/assistant/messages?${qs.toString()}`,
      { cache: 'no-store' },
    );
    const replies = newestReplies(data.messages ?? [], count);
    if (replies.length === 0) return [];
    // The markdown reader only comes down when a reply does.
    const { replyWords } = await import('@/lib/bubbles/reply-text');
    return replies.map((r) => cardFromReply(r, row, replyWords(r)));
  }
  const page = await messengerApi.messages(row.id, { limit: count });
  return page.messages.flatMap((m) => cardFromMessage(m, row, me) ?? []);
}

/** A pinned line as it is now, by the chat's own routes, or null if it is gone.
 *  It is pinned, so a read or a mute does not take it away. */
async function pinnedCardOf(
  order: number,
  row: MessengerListRow,
  me: string,
): Promise<BubbleCard | null> {
  if (row.kind === 'agent') {
    if (!row.agentSlug) return null;
    // The key's time is cut to the millisecond and `before` is strict.
    const qs = new URLSearchParams({
      agent: row.agentSlug,
      before: new Date(order + 1).toISOString(),
      limit: String(PINNED_THREAD_ROWS),
    });
    const data = await apiFetch<{ messages?: AssistantTimelineRow[] }>(
      `/api/assistant/messages?${qs.toString()}`,
      { cache: 'no-store' },
    );
    const at = (data.messages ?? []).filter((r) => Date.parse(r.createdAt) === order);
    const reply = newestReplies(at, 1)[0];
    if (!reply) return null;
    const { replyWords } = await import('@/lib/bubbles/reply-text');
    return cardFromReply(reply, row, replyWords(reply));
  }
  const page = await messengerApi.messages(row.id, { afterSeq: order - 1, limit: 1 });
  const line = page.messages.find((m) => m.seq === order);
  return line ? cardFromMessage(line, { ...row, muted: false }, me) : null;
}

export function BubbleSync() {
  const me = useViewerLogin()?.loginId ?? null;
  const list = useQuery({
    queryKey: messengerKeys.list,
    queryFn: messengerApi.list,
    refetchInterval: LIST_REFRESH_MS,
    enabled: !!me,
  });
  // What each chat looked like when it was last read.
  const seen = useRef(new Map<string, string>());
  /** The list as last read; null until the first one. */
  const rowsNow = useRef<readonly MessengerListRow[] | null>(null);
  // Whose pinned cards were brought back: once, on the first list.
  const pinsReadFor = useRef<string | null>(null);

  useEffect(() => {
    if (me) setBubbleLogin(me);
  }, [me]);

  // Read a pinned line again. A failed read leaves the pin as it is.
  const readPin = (key: string, login: string) => {
    if (!rowsNow.current) return;
    const k = parseKey(key);
    const row = k && rowsNow.current.find((r) => r.id === k.chat);
    if (!k || !row) {
      forgetPin(key);
      return;
    }
    void pinnedCardOf(k.order, row, login)
      .then((card) => (card ? putPinnedBubble(card) : forgetPin(key)))
      .catch(() => {});
  };

  const rows = list.data;
  useEffect(() => {
    if (!rows || !me) return;
    rowsNow.current = rows;
    reconcileBubbles(rows);
    if (pinsReadFor.current !== me) {
      pinsReadFor.current = me;
      const held = new Set(getBubbleCards().map((c) => c.key));
      for (const key of getPinnedKeys()) if (!held.has(key)) readPin(key, me);
    }
    for (const row of chatsToSync(rows, seen.current)) {
      const signature = rowSignature(row);
      seen.current.set(row.id, signature);
      // A read the chat has moved on from is dropped: a newer one is coming.
      const current = () => seen.current.get(row.id) === signature;
      void cardsOf(row, me)
        .then((cards) => {
          if (current()) setBubbleChat(row.id, cards);
        })
        .catch(() => {
          // Try again at the next list. The badge and the list still say it.
          if (current()) seen.current.delete(row.id);
        });
    }
    // Each fetch counts, also when its answer is the same as the last one:
    // a chat forgotten below is read again at the next answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rows follows dataUpdatedAt
  }, [list.dataUpdatedAt, me]);

  // A line edited or deleted, a reaction, or the chat reloaded (people changed,
  // history deleted, my own clear or mute): read the chat again. Its cards stay
  // until the answer replaces them. The same event asks for the fresh list
  // that does it. A pinned card outlives that answer, so it is read on its own.
  useMessengerBus((e) => {
    if (e.kind !== 'effect') return;
    if (!e.effect.reload && e.effect.refetchSeq === null) return;
    seen.current.delete(e.effect.c);
    if (!me) return;
    for (const key of getPinnedKeys()) {
      if (parseKey(key)?.chat === e.effect.c) readPin(key, me);
    }
  });

  return null;
}
