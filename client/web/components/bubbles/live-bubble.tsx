'use client';

/**
 * The live card (Project Bubble Chat, phase 3, R17 and R18): an assistant
 * turn this tab sent, from the bubble or the window, while no chat window is
 * open. The face talks, the line under the name is the turn's step, the text
 * is the end of what it has written so far, and Stop cancels it. At the end
 * it shows the finished reply until the reply's own card comes (lib/bubbles/
 * live.ts).
 *
 * It reads the dock's own transcript: the dock already holds the one stream
 * for the turn, so this opens nothing.
 */
import { useEffect, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import { Square, X } from 'lucide-react';
import { apiSend } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { useDockActions } from '@/components/assistant/assistant-dock';
import { useChatFaces } from '@/components/messenger/chat-faces';
import { liveTail, type LiveTurn } from '@/lib/bubbles/live';
import type { BubbleText } from '@/lib/bubbles/person-text';
import { CARD_SURFACE, REVEAL } from './bubble-card';
import { TalkingAvatar } from './talking-avatar';

export function LiveBubble({
  live,
  agentSlug,
  title,
  chat,
  more,
  dragged,
  onClose,
}: {
  live: LiveTurn;
  agentSlug: string | undefined;
  title: string;
  /** The agent's id, its list row: what the face is looked up by. */
  chat: string | null;
  more: number;
  dragged: RefObject<boolean>;
  onClose: () => void;
}) {
  const { openAssistant } = useDockActions();
  const faceOf = useChatFaces();
  const [stopping, setStopping] = useState(false);
  const [final, setFinal] = useState<BubbleText | null>(null);

  // The finished reply is read as a reply card reads it. The markdown reader
  // only comes down now.
  const done = !live.pending && !live.error;
  useEffect(() => {
    if (!done) return;
    let on = true;
    void import('@/lib/bubbles/reply-text').then(({ replyText }) => {
      if (on) setFinal(replyText(live.text));
    });
    return () => {
      on = false;
    };
  }, [done, live.text]);

  const open = (e: ReactMouseEvent) => {
    if (dragged.current && e.detail > 0) return;
    openAssistant(agentSlug);
  };

  const stop = () => {
    if (!live.turnId || stopping) return;
    setStopping(true);
    // The window's own Stop: the turn ends with what it wrote, as a done.
    void apiSend(`/api/assistant/turn/${encodeURIComponent(live.turnId)}/cancel`, 'POST').catch(
      () => setStopping(false),
    );
  };

  const step = live.pending
    ? stopping
      ? 'Stopping'
      : live.step || (live.text ? 'Writing' : 'Working')
    : null;
  const words = live.pending ? liveTail(live.text) : final ? final.text : liveTail(live.text);
  return (
    <div
      data-testid="bubble-live"
      data-state={live.pending ? 'running' : live.error ? 'failed' : 'done'}
      role="group"
      aria-label={`${title} is working`}
      aria-busy={live.pending}
      className={CARD_SURFACE}
    >
      <RowButton
        onClick={open}
        data-testid="bubble-open"
        className="block w-full rounded-2xl p-3"
        title="Open the chat"
      >
        <span className="block truncate pl-5 pr-14 text-sm font-medium">{title}</span>
        {step ? (
          <span
            data-testid="bubble-step"
            className="block truncate pl-5 pr-14 text-xs text-muted-foreground"
          >
            {step}
            <span aria-hidden className="motion-safe:animate-pulse">
              …
            </span>
          </span>
        ) : null}
        {words ? (
          <span
            data-testid="bubble-live-text"
            className={
              live.error
                ? 'mt-1 line-clamp-4 text-sm text-destructive-ink [overflow-wrap:anywhere]'
                : 'mt-1 line-clamp-7 whitespace-pre-line text-sm [overflow-wrap:anywhere]'
            }
          >
            {words}
          </span>
        ) : null}
        {(final?.cut && done) || more > 0 ? (
          <span className="mt-1 block text-xs text-muted-foreground">
            {[final?.cut && done ? 'Open to read more' : null, more > 0 ? `${more} more` : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        ) : null}
      </RowButton>
      <TalkingAvatar
        talking={live.pending}
        name={title}
        kind="agent"
        face={faceOf({
          kind: 'agent',
          id: chat,
          slug: agentSlug ?? null,
          avatar: null,
          photoVersion: null,
        })}
        size="md"
        className="absolute -left-3 -top-3 rounded-full ring-2 ring-card"
      />
      <div className="absolute right-1.5 top-1.5 flex">
        {live.pending && live.turnId ? (
          <Button
            variant="ghost"
            size="icon-2xs"
            onClick={stop}
            disabled={stopping}
            data-bubble-control
            data-testid="bubble-stop"
            aria-label={`Stop ${title}`}
            title="Stop"
          >
            <Square aria-hidden />
          </Button>
        ) : null}
        {/* A finished card turns into the reply's own card in a moment, so it
            has no X: a close now would show the same reply twice. */}
        {done ? null : (
          <Button
            variant="ghost"
            size="icon-2xs"
            onClick={onClose}
            data-bubble-control
            data-testid="bubble-pop"
            aria-label={
              live.pending ? `Hide ${title} while it works` : `Close the message from ${title}`
            }
            title={live.pending ? 'Hide' : 'Close'}
            className={REVEAL}
          >
            <X aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}
