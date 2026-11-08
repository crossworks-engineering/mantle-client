'use client';

/**
 * The bubble stack (Project Bubble Chat, phases 1 to 3): one card, and the
 * edges of the cards behind it. A live card, for a turn this tab sent, goes in
 * front of them while it runs. A card stays until it is closed or the chat is
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
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { useDockLayout, useDockSession } from '@/components/assistant/assistant-dock';
import { useViewerLogin } from '@/components/workspaces/use-shell-workspaces';
import { chatWindowOpen, type BubbleCard } from '@/lib/bubbles/cards';
import { LIVE_HOLD_MS, liveHeld, liveStatus, liveTurnOf } from '@/lib/bubbles/live';
import {
  DRAG_SLOP,
  clampPlace,
  readPlace,
  writePlace,
  type BubblePlace,
} from '@/lib/bubbles/place';
import { getBubbleMode, serverBubbleMode, subscribeBubbleMode } from '@/lib/bubbles/prefs';
import { getBubbleCards, serverBubbleCards, subscribeBubbles } from '@/lib/bubbles/store';
import { NO_WORDS } from '@/lib/bubbles/person-text';
import { messengerApi, messengerKeys } from '@/lib/messenger/api';
import { trackPointer } from '@/lib/track-pointer';
import { Bubble } from './bubble-card';
import { LiveBubble } from './live-bubble';

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

/** The live card's state: the dock's newest turn, while it runs, and for a
 *  moment after, until the reply's own card comes (lib/bubbles/live.ts). */
function useLiveCard(cards: readonly BubbleCard[], visible: boolean) {
  const { messages, agentSlug, agentName } = useDockSession();
  // The list the sync keeps fresh; this only reads it.
  const rows = useQuery({
    queryKey: messengerKeys.list,
    queryFn: messengerApi.list,
    enabled: false,
  }).data;
  const turn = liveTurnOf(messages);
  const row = rows?.find(
    (r) => r.kind === 'agent' && (agentSlug ? r.agentSlug === agentSlug : r.title === agentName),
  );
  const chat = row?.id ?? null;
  const keysNow = chat ? cards.filter((c) => c.chat === chat).map((c) => c.key) : [];
  /** The turn seen running, and its chat's cards when it started: a card
   *  that is not among them is this turn's reply. */
  const [run, setRun] = useState<{ id: string; keys: readonly string[] } | null>(null);
  /** The turn that ended: whether it was on screen, and if its hold is over. */
  const [end, setEnd] = useState<{
    id: string;
    keys: readonly string[];
    shown: boolean;
    over: boolean;
  } | null>(null);
  const [closed, setClosed] = useState<string | null>(null);

  // Set during the render that sees the change, as React adjusts state to a
  // prop, so the turn's end is one commit and the card never leaves.
  // A live card is a turn the brain took (it has an id): a refused send
  // never leaves its card, so the reply field keeps its words.
  const taken = turn?.turnId ? turn : null;
  // Once the chat is known: before it, "its cards" would read as none.
  if (taken?.pending && chat && run?.id !== taken.id) setRun({ id: taken.id, keys: keysNow });
  if (taken && !taken.pending && run?.id === taken.id) {
    setRun(null);
    setEnd({ id: taken.id, keys: run.keys, shown: visible, over: false });
  }

  const endId = end?.id;
  useEffect(() => {
    if (!endId) return;
    const t = window.setTimeout(
      () => setEnd((e) => (e?.id === endId ? { ...e, over: true } : e)),
      LIVE_HOLD_MS,
    );
    return () => window.clearTimeout(t);
  }, [endId]);

  // A chat window opened after the end shows the turn there: it is seen,
  // so a failure does not come back when the window closes.
  if (taken && end?.id === taken.id && end.shown && !visible && closed !== taken.id) {
    setClosed(taken.id);
  }

  if (!taken || closed === taken.id) return null;
  const on =
    taken.pending ||
    (end?.id === taken.id &&
      liveHeld({
        shownAtEnd: end.shown,
        failed: taken.error,
        keysAtStart: end.keys,
        keysNow,
        over: end.over,
      }));
  if (!on) return null;
  return {
    turn: taken,
    agentSlug,
    title: row?.title ?? agentName,
    chat,
    close: () => setClosed(taken.id),
  };
}

export function BubbleStack() {
  // Off: nothing mounts, so nothing here follows the dock's stream.
  return useBubbleMode() === 'off' ? null : <Stack />;
}

function Stack() {
  const cards = useSyncExternalStore(subscribeBubbles, getBubbleCards, serverBubbleCards);
  const { panel } = useDockLayout();
  const pathname = usePathname();
  const login = useViewerLogin()?.loginId ?? null;
  const hidden = chatWindowOpen({ panel, pathname });
  const live = useLiveCard(cards, !hidden);
  const [place, setPlace] = useState<BubblePlace | null>(null);
  const [turned, setTurned] = useState({ front: '', by: 0 });
  /** The card whose reply field is open, and the words in it: it keeps the
   *  front, so a new line does not take the field away, and the words stay
   *  while a chat window hides the stack. In memory only. */
  const [reply, setReply] = useState<{ key: string; text: string } | null>(null);
  const replyKey = reply?.key ?? null;
  const rootRef = useRef<HTMLDivElement>(null);
  /** A drag is going on: nothing else moves the node. */
  const moving = useRef(false);
  /** The last press was a drag, so its click opens nothing. A touch can send
   *  that click late, so this lasts until the next press. */
  const dragged = useRef(false);

  useEffect(() => {
    setPlace(login ? readPlace(login) : null);
  }, [login]);

  // The deck: the live card first, then the cards. A new line comes to the
  // front: the turn through the deck holds only while the same item leads it.
  const deck = cards.length + (live ? 1 : 0);
  const front = live ? `live:${live.turn.id}` : (cards[0]?.key ?? '');
  const by = turned.front === front ? turned.by : 0;
  const at = deck ? by % deck : 0;
  const replyingTo = replyKey ? cards.find((c) => c.key === replyKey) : undefined;
  const liveShown = !hidden && !replyingTo && live && at === 0 ? live : null;
  const shown = hidden || liveShown ? undefined : (replyingTo ?? cards[live ? at - 1 : at]);
  const shownKey = liveShown ? front : shown?.key;
  // A card of another height, or edges that come or go, can push it off screen.
  const shownText = liveShown ? `${liveShown.turn.text.length}` : shown?.text;
  const hasEdges = deck > 1;

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

  const more = deck - 1;
  return (
    <>
      {/* Says a new card once, in words. It stays mounted, or a screen reader
          may not hear what is written into it. A live card says only that
          the assistant works, not each word it writes. */}
      <span role="status" className="sr-only">
        {liveShown
          ? liveStatus(liveShown.title, liveShown.turn)
          : shown
            ? `${shown.title}: ${shown.text || NO_WORDS}`
            : ''}
      </span>
      {liveShown || shown ? (
        <div
          ref={rootRef}
          data-testid="bubble-stack"
          onPointerDown={startDrag}
          // A photo is an image: the browser's own image drag would end ours.
          onDragStart={(e) => e.preventDefault()}
          style={place ? { position: 'fixed', left: place.x, top: place.y } : undefined}
          className="group/bubble pointer-events-auto relative isolate w-88 max-w-[calc(100vw-2rem)] touch-none select-none self-end"
        >
          {liveShown ? (
            <LiveBubble
              key={front}
              live={liveShown.turn}
              agentSlug={liveShown.agentSlug}
              title={liveShown.title}
              chat={liveShown.chat}
              more={more}
              dragged={dragged}
              onClose={liveShown.close}
            />
          ) : shown ? (
            <Bubble
              key={shown.key}
              card={shown}
              more={more}
              dragged={dragged}
              draft={shown.key === replyKey ? (reply?.text ?? '') : null}
              // A close clears only this card's words: a slow send that ends
              // later must not close the field of another card.
              setDraft={(text) =>
                setReply((r) =>
                  text !== null ? { key: shown.key, text } : r?.key === shown.key ? null : r,
                )
              }
            />
          ) : null}
          {/* While a reply field is open its card keeps the front, so the
              edge would turn a deck nobody sees. */}
          {more > 0 && !replyingTo ? (
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
