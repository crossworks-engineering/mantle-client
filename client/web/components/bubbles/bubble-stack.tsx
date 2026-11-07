'use client';

/**
 * The bubble stack (Project Bubble Chat, phase 1): the newest card, and how
 * many wait behind it. It stays until it is popped or the chat is read. It
 * does not show while a chat window is open: there, the chat's row is
 * highlighted instead. Plain and opaque in this phase, as every floating layer
 * is; phase 2 brings the look and the move.
 */
import { useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { apiSend } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { useDockActions, useDockLayout } from '@/components/assistant/assistant-dock';
import { CONVERSATIONS_KEY } from '@/components/assistant/use-assistant-unread';
import { ChatAvatar } from '@/components/messenger/chat-avatar';
import { useChatFaces } from '@/components/messenger/chat-faces';
import { READ_PATH, readBody } from '@/lib/assistant-unread';
import { chatWindowOpen, cursorMayMove, type BubbleCard } from '@/lib/bubbles/cards';
import { getBubbleMode, serverBubbleMode, subscribeBubbleMode } from '@/lib/bubbles/prefs';
import {
  getBubbleCards,
  popBubble,
  serverBubbleCards,
  subscribeBubbles,
} from '@/lib/bubbles/store';
import { NO_WORDS } from '@/lib/bubbles/person-text';
import { messengerApi, messengerKeys } from '@/lib/messenger/api';

export function useBubbleMode() {
  return useSyncExternalStore(subscribeBubbleMode, getBubbleMode, serverBubbleMode);
}

export function BubbleStack() {
  const mode = useBubbleMode();
  const cards = useSyncExternalStore(subscribeBubbles, getBubbleCards, serverBubbleCards);
  const { panel } = useDockLayout();
  const pathname = usePathname();
  if (mode === 'off') return null;
  const top = chatWindowOpen({ panel, pathname }) ? undefined : cards[0];
  return (
    <>
      {/* Says a new card once, in words. It stays mounted, or a screen reader
          may not hear what is written into it. */}
      <span role="status" className="sr-only">
        {top ? `${top.title}: ${top.text || NO_WORDS}` : ''}
      </span>
      {top ? <Bubble key={top.key} card={top} more={cards.length - 1} /> : null}
    </>
  );
}

function Bubble({ card, more }: { card: BubbleCard; more: number }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { openAssistant } = useDockActions();
  const faceOf = useChatFaces();

  const open = () => {
    if (card.agentSlug) openAssistant(card.agentSlug);
    else router.push(`/chats/${encodeURIComponent(card.chat)}`);
  };

  const moveCursor = async (to: number) => {
    // By the list as it is now, not as this tab last heard it.
    const rows = await queryClient.fetchQuery({
      queryKey: messengerKeys.list,
      queryFn: messengerApi.list,
      staleTime: 0,
    });
    if (!cursorMayMove(rows.find((r) => r.id === card.chat))) return;
    await (card.agentSlug
      ? // A thread has no seq: its order is the reply's time in ms. The row's
        // own time has more digits than that, so step past it.
        apiSend(READ_PATH, 'POST', readBody(card.agentSlug, new Date(to + 1).toISOString()))
      : messengerApi.read(card.chat, to));
    void queryClient.invalidateQueries({ queryKey: messengerKeys.list });
    void queryClient.invalidateQueries({ queryKey: messengerKeys.unread });
    void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
  };

  const pop = () => {
    const to = popBubble(card);
    // The next card takes the place of this one, and a keyboard stays with it.
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('[data-testid="bubble-pop"]')?.focus(),
    );
    // The last card of this chat went: the chat is seen. A failed read leaves
    // it unread, and the popped key keeps the card from coming back.
    if (to !== null) void moveCursor(to).catch(() => {});
  };

  return (
    <div
      data-testid="bubble-card"
      role="group"
      aria-label={`Message from ${card.title}`}
      className="pointer-events-auto flex w-full items-start gap-3 rounded-lg bg-popover p-3 text-popover-foreground shadow-lg"
    >
      <ChatAvatar
        name={card.author.name}
        kind={card.author.kind === 'agent' ? 'agent' : 'person'}
        face={faceOf({
          kind: card.author.kind,
          id: card.author.id,
          slug: card.agentSlug,
          avatar: card.author.avatar,
          photoVersion: card.author.photoVersion,
        })}
        size="md"
      />
      <RowButton
        onClick={open}
        data-testid="bubble-open"
        className="min-w-0 flex-1 rounded-sm"
        aria-label={`Open the chat: ${card.title}`}
      >
        <span className="block truncate text-sm font-medium">{card.title}</span>
        {card.note ? (
          <span className="block text-xs text-muted-foreground">{card.note}</span>
        ) : null}
        <span className="line-clamp-6 whitespace-pre-line text-sm [overflow-wrap:anywhere]">
          {card.text || NO_WORDS}
        </span>
        {card.cut || more > 0 ? (
          <span className="mt-1 block text-xs text-muted-foreground">
            {[card.cut ? 'Open to read more' : null, more > 0 ? `${more} more` : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        ) : null}
      </RowButton>
      <Button
        variant="ghost"
        size="icon-2xs"
        onClick={pop}
        data-testid="bubble-pop"
        aria-label={`Close the message from ${card.title}`}
        title="Close"
      >
        <X aria-hidden />
      </Button>
    </div>
  );
}
