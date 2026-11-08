'use client';

/**
 * The bubble stack (Project Bubble Chat, phases 1 and 2): one card, and the
 * edges of the cards behind it. A card stays until it is closed or the chat is
 * read; a pinned one stays until it is unpinned. No card shows while a chat
 * window is open: there, the chat's row is highlighted instead.
 *
 * The stack sits with the bottom-right dock until it is first dragged, so it
 * never covers a call or an upload. After that it is fixed where it was left,
 * for this login in this browser. The root holds the drag, so a new card during
 * a drag does not stop it.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Pin, PinOff, X } from 'lucide-react';
import { apiSend } from '@mantle/web-ui/api-fetch';
import { cn } from '@mantle/web-ui/lib/utils';
import { Button } from '@mantle/web-ui/ui/button';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { useDockActions, useDockLayout } from '@/components/assistant/assistant-dock';
import { CONVERSATIONS_KEY } from '@/components/assistant/use-assistant-unread';
import { ChatAvatar } from '@/components/messenger/chat-avatar';
import { useChatFaces } from '@/components/messenger/chat-faces';
import { useViewerLogin } from '@/components/workspaces/use-shell-workspaces';
import { READ_PATH, readBody } from '@/lib/assistant-unread';
import { chatWindowOpen, cursorMayMove, type BubbleCard } from '@/lib/bubbles/cards';
import {
  DRAG_SLOP,
  clampPlace,
  readPlace,
  writePlace,
  type BubblePlace,
} from '@/lib/bubbles/place';
import { getBubbleMode, serverBubbleMode, subscribeBubbleMode } from '@/lib/bubbles/prefs';
import {
  getBubbleCards,
  isBubblePinned,
  popBubble,
  serverBubbleCards,
  subscribeBubbles,
  togglePinBubble,
} from '@/lib/bubbles/store';
import { NO_WORDS } from '@/lib/bubbles/person-text';
import { messengerApi, messengerKeys } from '@/lib/messenger/api';
import { trackPointer } from '@/lib/track-pointer';

/** A control is seen on hover, on keyboard focus, and always on a touch screen. */
const REVEAL =
  'opacity-0 transition-opacity group-hover/bubble:opacity-100 group-has-[:focus-visible]/bubble:opacity-100 [@media(hover:none)]:opacity-100';

export function useBubbleMode() {
  return useSyncExternalStore(subscribeBubbleMode, getBubbleMode, serverBubbleMode);
}

/** The window's size, and the stack's: what a place is kept on screen by. */
function boxOf(node: HTMLElement) {
  const r = node.getBoundingClientRect();
  return { w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight };
}

function moveTo(node: HTMLElement, p: BubblePlace) {
  node.style.left = `${p.x}px`;
  node.style.top = `${p.y}px`;
}

export function BubbleStack() {
  const mode = useBubbleMode();
  const cards = useSyncExternalStore(subscribeBubbles, getBubbleCards, serverBubbleCards);
  const { panel } = useDockLayout();
  const pathname = usePathname();
  const login = useViewerLogin()?.loginId ?? null;
  const [place, setPlace] = useState<BubblePlace | null>(null);
  const [turned, setTurned] = useState({ front: '', by: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  /** A drag is going on: nothing else moves the node. */
  const moving = useRef(false);
  /** The last press was a drag, so its click opens nothing. A touch can send
   *  that click late, so this lasts until the next press. */
  const dragged = useRef(false);

  useEffect(() => {
    setPlace(login ? readPlace(login) : null);
  }, [login]);

  // A new line comes to the front: the turn through the stack holds only while
  // the same card leads it.
  const front = cards[0]?.key ?? '';
  const by = turned.front === front ? turned.by : 0;
  const shown =
    mode === 'off' || chatWindowOpen({ panel, pathname }) ? undefined : cards[by % cards.length];
  const shownKey = shown?.key;
  // A card of another height, or edges that come or go, can push it off screen.
  const shownText = shown?.text;
  const hasEdges = cards.length > 1;

  // On screen, for this card and this window. Written to the node and not to
  // the place, so a bigger window brings the place back.
  useLayoutEffect(() => {
    const node = rootRef.current;
    if (!node || !place) return;
    const keep = () => {
      if (!moving.current) moveTo(node, clampPlace(place, boxOf(node)));
    };
    keep();
    window.addEventListener('resize', keep);
    return () => window.removeEventListener('resize', keep);
  }, [shownKey, shownText, hasEdges, place]);

  if (mode === 'off') return null;

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragged.current = false;
    if (e.button !== 0 || (e.target as HTMLElement).closest('[data-bubble-control]')) return;
    const node = e.currentTarget;
    const base = node.getBoundingClientRect();
    const { clientX: ox, clientY: oy } = e;
    let next: BubblePlace | null = null;
    trackPointer(
      (m) => {
        const dx = m.clientX - ox;
        const dy = m.clientY - oy;
        if (!next && Math.hypot(dx, dy) < DRAG_SLOP) return;
        dragged.current = true;
        moving.current = true;
        next = clampPlace({ x: base.left + dx, y: base.top + dy }, boxOf(node));
        node.style.position = 'fixed';
        moveTo(node, next);
      },
      () => {
        moving.current = false;
        if (!next) return;
        setPlace(next);
        if (login) writePlace(login, next);
      },
    );
  };

  const more = cards.length - 1;
  return (
    <>
      {/* Says a new card once, in words. It stays mounted, or a screen reader
          may not hear what is written into it. */}
      <span role="status" className="sr-only">
        {shown ? `${shown.title}: ${shown.text || NO_WORDS}` : ''}
      </span>
      {shown ? (
        <div
          ref={rootRef}
          data-testid="bubble-stack"
          onPointerDown={startDrag}
          // A photo is an image: the browser's own image drag would end ours.
          onDragStart={(e) => e.preventDefault()}
          style={place ? { position: 'fixed', left: place.x, top: place.y } : undefined}
          className="group/bubble pointer-events-auto relative isolate w-80 max-w-[calc(100vw-2rem)] touch-none select-none self-end"
        >
          <Bubble key={shown.key} card={shown} more={more} dragged={dragged} />
          {more > 0 ? (
            <RowButton
              data-bubble-control
              data-testid="bubble-next"
              aria-label="Show the next message"
              title="Show the next message"
              onClick={() => setTurned({ front, by: by + 1 })}
              className="absolute inset-x-0 top-full h-4 rounded-b-2xl"
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-3 top-0 h-2 rounded-b-xl bg-card/60 shadow-sm [@media(prefers-reduced-transparency:reduce)]:bg-card"
              />
              {more > 1 ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-6 top-2 h-2 rounded-b-xl bg-card/60 shadow-sm [@media(prefers-reduced-transparency:reduce)]:bg-card"
                />
              ) : null}
            </RowButton>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function Bubble({
  card,
  more,
  dragged,
}: {
  card: BubbleCard;
  more: number;
  dragged: RefObject<boolean>;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { openAssistant } = useDockActions();
  const faceOf = useChatFaces();
  const pinned = isBubblePinned(card.key);

  const open = (e: ReactMouseEvent) => {
    // A keyboard click (detail 0) has no press of its own to be a drag.
    if (dragged.current && e.detail > 0) return;
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

  const pop = (e: ReactMouseEvent) => {
    // The second click of a double click would close the card that came next,
    // unseen.
    if (e.detail > 1) return;
    const to = popBubble(card);
    // The next card takes the place of this one, and a keyboard stays with it.
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('[data-testid="bubble-pop"]')?.focus(),
    );
    // The last card of this chat went: the chat is seen. A failed read leaves
    // it unread, and the popped key keeps the card from coming back. A pinned
    // card's close reads nothing (popBubble).
    if (to !== null) void moveCursor(to).catch(() => {});
  };

  return (
    <div
      data-testid="bubble-card"
      role="group"
      aria-label={`Message from ${card.title}`}
      className="relative rounded-2xl bg-card/70 text-card-foreground shadow-lg backdrop-blur [@media(prefers-reduced-transparency:reduce)]:bg-card"
    >
      <RowButton
        onClick={open}
        data-testid="bubble-open"
        className="block w-full rounded-2xl p-3"
        title="Open the chat"
      >
        {/* Past the avatar on its left, and clear of the controls on its right. */}
        <span className="block truncate pl-5 pr-11 text-sm font-medium">{card.title}</span>
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
        className="absolute -left-3 -top-3 rounded-full ring-2 ring-card"
      />
      <div className="absolute right-1.5 top-1.5 flex">
        <Button
          variant="ghost"
          size="icon-2xs"
          onClick={() => togglePinBubble(card.key)}
          data-bubble-control
          data-testid="bubble-pin"
          aria-pressed={pinned}
          aria-label={`Pin the message from ${card.title}`}
          title={pinned ? 'Unpin' : 'Pin'}
          className={cn(!pinned && REVEAL)}
        >
          {pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
        </Button>
        <Button
          variant="ghost"
          size="icon-2xs"
          onClick={pop}
          data-bubble-control
          data-testid="bubble-pop"
          aria-label={`Close the message from ${card.title}`}
          title="Close"
          className={REVEAL}
        >
          <X aria-hidden />
        </Button>
      </div>
    </div>
  );
}
