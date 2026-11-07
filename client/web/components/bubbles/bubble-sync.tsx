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
  rowSignature,
  type BubbleCard,
} from '@/lib/bubbles/cards';
import {
  addBubbleCards,
  dropBubbleChat,
  reconcileBubbles,
  setBubbleLogin,
} from '@/lib/bubbles/store';
import { messengerApi, messengerKeys } from '@/lib/messenger/api';
import type { MessengerListRow } from '@/lib/messenger/dto';

/** A read elsewhere of an assistant thread raises no event: this catches it. */
const LIST_REFRESH_MS = 60_000;
/** Rows read of a thread: its replies with the person's lines between them. */
const THREAD_ROWS = 20;

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
    const { replyText } = await import('@/lib/bubbles/reply-text');
    return replies.map((r) => cardFromReply(r, row, replyText(r.text)));
  }
  const page = await messengerApi.messages(row.id, { limit: count });
  return page.messages.flatMap((m) => cardFromMessage(m, row, me) ?? []);
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

  useEffect(() => {
    if (me) setBubbleLogin(me);
  }, [me]);

  const rows = list.data;
  useEffect(() => {
    if (!rows || !me) return;
    reconcileBubbles(rows);
    for (const row of chatsToSync(rows, seen.current)) {
      seen.current.set(row.id, rowSignature(row));
      void cardsOf(row, me)
        .then(addBubbleCards)
        .catch(() => {
          // Try again at the next list. The badge and the list still say it.
          seen.current.delete(row.id);
        });
    }
    // Each fetch counts, also when its answer is the same as the last one:
    // a chat dropped below is read again at the next answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rows follows dataUpdatedAt
  }, [list.dataUpdatedAt, me]);

  // A line edited or deleted, or the chat reloaded (people changed, history
  // deleted, my own clear or mute): read the chat again. The same event asks
  // for the fresh list that does it.
  useMessengerBus((e) => {
    if (e.kind !== 'effect') return;
    if (!e.effect.reload && e.effect.refetchSeq === null) return;
    dropBubbleChat(e.effect.c);
    seen.current.delete(e.effect.c);
  });

  return null;
}
