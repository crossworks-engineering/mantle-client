'use client';

/**
 * One bubble card (Project Bubble Chat, phases 1 to 3): the face, the words,
 * and what the person can do from it. Every action is one existing route, as
 * this login, for the chat the card came from: the X reads, Reply sends with
 * the chat's own send (or the window's own turn, for an assistant), the thumbs
 * up reacts, and an item opens as a click in the chat would.
 */
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Pin, PinOff, Reply, SendHorizontal, ThumbsUp, X } from 'lucide-react';
import { apiSend } from '@mantle/web-ui/api-fetch';
import { uuid } from '@mantle/web-ui/lib/secure-context-fallbacks';
import { cn } from '@mantle/web-ui/lib/utils';
import { Button } from '@mantle/web-ui/ui/button';
import { Input } from '@mantle/web-ui/ui/input';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { useDockActions, useDockSession } from '@/components/assistant/assistant-dock';
import { CONVERSATIONS_KEY } from '@/components/assistant/use-assistant-unread';
import { useChatFaces } from '@/components/messenger/chat-faces';
import { READ_PATH, readBody } from '@/lib/assistant-unread';
import { cursorMayMove, type BubbleCard } from '@/lib/bubbles/cards';
import { TALK_MS } from '@/lib/bubbles/mouths';
import { NO_WORDS } from '@/lib/bubbles/person-text';
import { isBubblePinned, popBubble, togglePinBubble } from '@/lib/bubbles/store';
import { messengerApi, messengerKeys } from '@/lib/messenger/api';
import { newClientMsgId } from '@/lib/messenger/transcript';
import { TalkingAvatar } from './talking-avatar';

/** A control is seen on hover, on keyboard focus, and always on a touch screen. */
export const REVEAL =
  'opacity-0 transition-opacity group-hover/bubble:opacity-100 group-has-[:focus-visible]/bubble:opacity-100 [@media(hover:none)]:opacity-100';

/** The card's surface: see-through with a blur, solid where the person asks. */
export const CARD_SURFACE =
  'relative rounded-2xl bg-card/70 text-card-foreground shadow-lg backdrop-blur [@media(prefers-reduced-transparency:reduce)]:bg-card';

/** The longest quick reply. A longer answer belongs in the chat. */
export const REPLY_MAX = 2000;

/** The X: the card is seen. Shared by the X, the thumbs up and a reply. */
export function useBubbleClose(card: BubbleCard) {
  const queryClient = useQueryClient();

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

  /** Close the card: it is seen. The last card of a chat moves its cursor. */
  return () => {
    const to = popBubble(card);
    // The next card takes the place of this one, and a keyboard stays with it.
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('[data-testid="bubble-pop"]')?.focus(),
    );
    // A failed read leaves it unread, and the popped key keeps the card from
    // coming back. A pinned card's close reads nothing (popBubble).
    if (to !== null) void moveCursor(to).catch(() => {});
  };
}

/** True for the first few seconds of a card on screen: its face talks. */
function useFresh(ms: number): boolean {
  const [fresh, setFresh] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setFresh(false), ms);
    return () => window.clearTimeout(t);
  }, [ms]);
  return fresh;
}

export function Bubble({
  card,
  more,
  dragged,
}: {
  card: BubbleCard;
  more: number;
  dragged: RefObject<boolean>;
}) {
  const router = useRouter();
  const { openAssistant } = useDockActions();
  const faceOf = useChatFaces();
  const pinned = isBubblePinned(card.key);
  const close = useBubbleClose(card);
  const fresh = useFresh(TALK_MS);
  const [replying, setReplying] = useState(false);
  const person = !card.agentSlug;

  const open = (e: ReactMouseEvent) => {
    // A keyboard click (detail 0) has no press of its own to be a drag.
    if (dragged.current && e.detail > 0) return;
    if (card.agentSlug) openAssistant(card.agentSlug);
    else router.push(`/chats/${encodeURIComponent(card.chat)}`);
  };

  const pop = (e: ReactMouseEvent) => {
    // The second click of a double click would close the card that came next,
    // unseen.
    if (e.detail > 1) return;
    close();
  };

  const [thanking, setThanking] = useState(false);
  const thumbsUp = () => {
    if (thanking) return;
    setThanking(true);
    messengerApi
      .react(card.chat, card.order, '👍')
      .then(close)
      // The card stays, and the person can try again or open the chat.
      .catch(() => setThanking(false));
  };

  return (
    <div
      data-testid="bubble-card"
      role="group"
      aria-label={`Message from ${card.title}`}
      className={CARD_SURFACE}
    >
      <RowButton
        onClick={open}
        data-testid="bubble-open"
        className="block w-full rounded-2xl p-3"
        title="Open the chat"
      >
        {/* Past the avatar on its left, and clear of the controls on its right. */}
        <span className="block truncate pl-5 pr-20 text-sm font-medium">{card.title}</span>
        {card.note ? (
          <span className="block text-xs text-muted-foreground">{card.note}</span>
        ) : null}
        <span className="line-clamp-7 whitespace-pre-line text-sm [overflow-wrap:anywhere]">
          {card.text || NO_WORDS}
        </span>
        {card.facts ? (
          <span data-testid="bubble-facts" className="mt-1 block text-xs text-muted-foreground">
            {card.facts}
          </span>
        ) : null}
        {card.cut || more > 0 ? (
          <span className="mt-1 block text-xs text-muted-foreground">
            {[card.cut ? 'Open to read more' : null, more > 0 ? `${more} more` : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        ) : null}
      </RowButton>
      {card.links?.length ? (
        <div className="-mt-1 flex flex-wrap gap-1.5 px-3 pb-3">
          {card.links.map((l) => (
            <Button
              key={l.href}
              variant="secondary"
              size="2xs"
              data-bubble-control
              data-testid="bubble-item"
              title={`Open ${l.label}`}
              onClick={() => router.push(l.href)}
              className="max-w-full"
            >
              <ExternalLink aria-hidden />
              <span className="truncate">{l.label}</span>
            </Button>
          ))}
        </div>
      ) : null}
      {replying ? (
        <BubbleReply card={card} onDone={() => setReplying(false)} close={close} />
      ) : null}
      <TalkingAvatar
        talking={fresh}
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
        {person ? (
          <Button
            variant="ghost"
            size="icon-2xs"
            onClick={thumbsUp}
            disabled={thanking}
            data-bubble-control
            data-testid="bubble-thumbs"
            aria-label={`Thumbs up to ${card.title}, and close`}
            title="Thumbs up, and close"
            className={REVEAL}
          >
            <ThumbsUp aria-hidden />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon-2xs"
          onClick={() => setReplying((r) => !r)}
          data-bubble-control
          data-testid="bubble-reply"
          aria-expanded={replying}
          aria-label={`Reply to ${card.title}`}
          title="Reply"
          className={cn(!replying && REVEAL)}
        >
          <Reply aria-hidden />
        </Button>
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

/**
 * The quick reply: one line, Enter sends, Esc closes. A person's chat takes it
 * by the chat's own send route; the brain then moves this login's read cursor
 * to the new line, so the chat's cards go at the next list read. An assistant
 * takes it as a turn of the window's own (the dock's runTurn): the live card
 * shows it while it runs. The card answered closes, as it is seen.
 */
function BubbleReply({
  card,
  onDone,
  close,
}: {
  card: BubbleCard;
  onDone: () => void;
  close: () => void;
}) {
  const queryClient = useQueryClient();
  const { runTurn } = useDockActions();
  const { busy } = useDockSession();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const waits = !!card.agentSlug && busy;

  useEffect(() => inputRef.current?.focus(), []);

  const send = async () => {
    const body = text.trim();
    if (!body || sending || waits) return;
    setSending(true);
    setError(null);
    try {
      if (card.agentSlug) {
        await runTurn({
          agentSlug: card.agentSlug,
          agentName: card.title,
          idempotencyKey: uuid(),
          displayText: body,
          body: JSON.stringify({ text: body, agentSlug: card.agentSlug }),
          isJson: true,
        });
      } else {
        await messengerApi.send(card.chat, { body, clientMsgId: newClientMsgId() });
        void queryClient.invalidateQueries({ queryKey: messengerKeys.list });
        void queryClient.invalidateQueries({ queryKey: messengerKeys.unread });
      }
      setText('');
      onDone();
      // A pinned card stays: the person pinned it to keep it.
      if (!isBubblePinned(card.key)) close();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Not sent');
      setSending(false);
    }
  };

  return (
    <form
      data-bubble-control
      data-testid="bubble-reply-form"
      className="px-3 pb-3"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div className="flex items-center gap-1">
        <Input
          ref={inputRef}
          size="xs"
          data-testid="bubble-reply-input"
          aria-label={`Reply to ${card.title}`}
          value={text}
          maxLength={REPLY_MAX}
          disabled={sending}
          placeholder={waits ? 'Wait for the current reply' : `Reply to ${card.title}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              onDone();
            }
          }}
          className="min-w-0 flex-1 select-text rounded-lg bg-background/60 [@media(prefers-reduced-transparency:reduce)]:bg-background"
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon-xs"
          disabled={!text.trim() || sending || waits}
          data-testid="bubble-reply-send"
          aria-label="Send"
          title="Send"
        >
          <SendHorizontal aria-hidden />
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-xs text-destructive-ink">
          Not sent: {error}
        </p>
      ) : null}
    </form>
  );
}
