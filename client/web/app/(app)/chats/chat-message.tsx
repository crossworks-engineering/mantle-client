'use client';

import type { ReactNode } from 'react';
import { AlertCircle, Check, CheckCheck, Clock } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { cn } from '@mantle/web-ui/lib/utils';
import { ChatBubble } from '@/components/chat-bubble';
import type { MessengerMessage } from '@/lib/messenger/dto';
import { bubbleTime } from '@/lib/messenger/format';
import type { OutboxLine } from '@/lib/messenger/transcript';

/** The bubble's shape: rounded, mine in the primary fill, theirs on the
 *  muted surface (ChatBubble's own treatment, the muted fill for theirs). */
const BUBBLE = 'max-w-full rounded-2xl px-3.5 py-2';
const THEIRS = 'border-transparent bg-muted text-foreground';

function Row({ mine, children }: { mine: boolean; children: ReactNode }) {
  return (
    <div className={cn('flex w-full', mine ? 'justify-end' : 'justify-start')}>
      <div className={cn('flex max-w-[75%] flex-col', mine ? 'items-end' : 'items-start')}>
        {children}
      </div>
    </div>
  );
}

/**
 * One message of the transcript: the author's name above it in a group, the
 * bubble, then its time, an "edited" mark and, on mine, the ticks (one sent,
 * two read by everyone else), and the reactions under it.
 */
export function ChatMessage({
  message,
  mine,
  showAuthor,
  read,
}: {
  message: MessengerMessage;
  mine: boolean;
  showAuthor: boolean;
  read: boolean;
}) {
  if (message.authorKind === 'system') {
    return (
      <p className="py-1 text-center text-xs text-muted-foreground" data-testid="chat-system">
        {message.body}
      </p>
    );
  }
  const deleted = message.deletedAt !== null;
  const Tick = read ? CheckCheck : Check;
  return (
    <Row mine={mine}>
      {showAuthor ? (
        <span className="mb-0.5 mt-2 px-1 text-xs text-muted-foreground">
          {message.authorName ?? 'Someone'}
        </span>
      ) : null}
      <ChatBubble
        role={mine ? 'user' : 'assistant'}
        className={cn(BUBBLE, !mine && THEIRS, deleted && 'opacity-80')}
      >
        <span data-testid="chat-message" data-seq={message.seq}>
          {deleted ? <em className="opacity-80">This message was deleted</em> : message.body}
        </span>
      </ChatBubble>
      {message.reactions.length > 0 && !deleted ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {message.reactions.map((r) => (
            <span
              key={r.emoji}
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs',
                r.mine ? 'border-primary/40 bg-primary/10' : 'border-border bg-card/70',
              )}
              aria-label={`${r.emoji} ${r.count}${r.mine ? ', including you' : ''}`}
            >
              <span aria-hidden>{r.emoji}</span>
              <span className="tabular-nums text-muted-foreground">{r.count}</span>
            </span>
          ))}
        </div>
      ) : null}
      <span className="mt-0.5 flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
        {bubbleTime(message.createdAt)}
        {message.editedAt && !deleted ? <span>· edited</span> : null}
        {mine && !deleted ? (
          <Tick
            className={cn('size-3.5', read ? 'text-success-ink' : 'text-muted-foreground')}
            role="img"
            aria-label={read ? 'Read' : 'Sent'}
          />
        ) : null}
      </span>
    </Row>
  );
}

/** A send of mine not stored yet: a clock while it goes, a retry once it
 *  failed. */
export function OutboxMessage({
  line,
  onRetry,
  onDiscard,
}: {
  line: OutboxLine;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const failed = line.state === 'failed';
  return (
    <Row mine>
      <ChatBubble role="user" className={cn(BUBBLE, failed ? 'opacity-60' : 'opacity-80')}>
        <span data-testid="chat-outbox">{line.body}</span>
      </ChatBubble>
      {failed ? (
        <span className="mt-0.5 flex flex-wrap items-center justify-end gap-1 px-1 text-[11px] text-destructive-ink">
          <AlertCircle className="size-3.5" aria-hidden />
          {line.error ?? 'Not sent'}
          <Button variant="link" size="2xs" className="h-auto px-1" onClick={onRetry}>
            Retry
          </Button>
          <Button
            variant="link"
            size="2xs"
            className="h-auto px-1 text-muted-foreground"
            onClick={onDiscard}
          >
            Discard
          </Button>
        </span>
      ) : (
        <span className="mt-0.5 flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
          <Clock className="size-3" role="img" aria-label="Sending" />
        </span>
      )}
    </Row>
  );
}
