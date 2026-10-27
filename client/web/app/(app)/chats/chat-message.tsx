'use client';

import { useState, type ReactNode } from 'react';
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  MoreHorizontal,
  Pencil,
  SmilePlus,
  Trash2,
} from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@mantle/web-ui/ui/dropdown-menu';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Textarea } from '@mantle/web-ui/ui/textarea';
import { cn } from '@mantle/web-ui/lib/utils';
import { ChatBubble } from '@/components/chat-bubble';
import { EmojiPicker } from '@/components/emoji-picker';
import type { MessengerMessage } from '@/lib/messenger/dto';
import { bubbleTime } from '@/lib/messenger/format';
import { splitMentions } from '@/lib/messenger/mentions';
import { sendableBody, type OutboxLine } from '@/lib/messenger/transcript';

/** The bubble's shape: rounded, mine in the primary fill, theirs on the
 *  muted surface (ChatBubble's own treatment, the muted fill for theirs). */
const BUBBLE = 'max-w-full rounded-2xl px-3.5 py-2';
const THEIRS = 'border-transparent bg-muted text-foreground';

function Row({
  mine,
  seq,
  author,
  children,
}: {
  mine: boolean;
  seq?: number;
  /** The author's face column: a face, null for the empty gutter under it,
   *  undefined for none (a direct chat, mine). */
  author?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex w-full gap-2', mine ? 'justify-end' : 'justify-start')} data-seq={seq}>
      {author !== undefined ? (
        <div className="w-8 shrink-0 pt-6" aria-hidden>
          {author}
        </div>
      ) : null}
      <div className={cn('flex max-w-[75%] flex-col', mine ? 'items-end' : 'items-start')}>
        {children}
      </div>
    </div>
  );
}

/** What a reader may do to a message (M2): react, and edit or delete. */
export type MessageActions = {
  onReact: (emoji: string) => void;
  /** Mine and not deleted. */
  onEdit?: () => void;
  /** Mine, or any in a group I administer. */
  onDelete?: () => void;
};

/**
 * One message of the transcript: the author's name above it in a group, the
 * bubble, then its time, an "edited" mark and, on mine, the ticks (one sent,
 * two read by everyone else), and the reactions under it (a chip toggles
 * mine). Its actions sit beside the bubble, shown on hover and on keyboard
 * focus: React (the emoji picker) and More (Edit, Delete).
 */
export function ChatMessage({
  message,
  mine,
  showAuthor,
  author,
  read,
  mentionNames = [],
  actions,
  editing,
}: {
  message: MessengerMessage;
  mine: boolean;
  showAuthor: boolean;
  /** The author's face in a group (`Row`). */
  author?: ReactNode;
  read: boolean;
  /** The chat's people, to draw "@Name" in the mention ink. */
  mentionNames?: readonly string[];
  actions?: MessageActions;
  /** The inline editor, while this message is being edited. */
  editing?: ReactNode;
}) {
  if (message.authorKind === 'system') {
    return (
      <p
        className="py-1 text-center text-xs text-muted-foreground"
        data-testid="chat-system"
        data-seq={message.seq}
      >
        {message.body}
      </p>
    );
  }
  const deleted = message.deletedAt !== null;
  const Tick = read ? CheckCheck : Check;
  const tools =
    actions && !deleted && !editing ? <MessageTools mine={mine} actions={actions} /> : null;
  return (
    <Row mine={mine} seq={message.seq} author={author}>
      {showAuthor ? (
        <span className="mb-0.5 mt-2 px-1 text-xs text-muted-foreground">
          {message.authorName ?? 'Someone'}
        </span>
      ) : null}
      {(!deleted && editing) || (
        <div className={cn('group flex items-center gap-1', mine && 'flex-row-reverse')}>
          <ChatBubble
            role={mine ? 'user' : 'assistant'}
            className={cn(BUBBLE, !mine && THEIRS, deleted && 'opacity-80')}
          >
            <span data-testid="chat-message">
              {deleted ? (
                <em className="opacity-80">This message was deleted</em>
              ) : (
                <MessageBody body={message.body} names={mentionNames} mine={mine} />
              )}
            </span>
          </ChatBubble>
          {tools}
        </div>
      )}
      {message.reactions.length > 0 && !deleted ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {message.reactions.map((r) => (
            <RowButton
              key={r.emoji}
              onClick={() => actions?.onReact(r.emoji)}
              disabled={!actions}
              aria-pressed={r.mine}
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors',
                r.mine
                  ? 'border-primary/40 bg-primary/10 hover:bg-primary/15'
                  : 'border-border bg-card/70 hover:bg-foreground/[0.06]',
              )}
              aria-label={`${r.emoji} ${r.count}${r.mine ? ', including you. Remove yours' : '. Add yours'}`}
            >
              <span aria-hidden>{r.emoji}</span>
              <span className="tabular-nums text-muted-foreground">{r.count}</span>
            </RowButton>
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

/** The body, with each "@Name" of the chat's people in the mention ink. */
function MessageBody({
  body,
  names,
  mine,
}: {
  body: string;
  names: readonly string[];
  mine: boolean;
}) {
  const parts = splitMentions(body, names);
  if (parts.length === 1 && !parts[0]!.mention) return <>{body}</>;
  return (
    <>
      {parts.map((p, i) =>
        p.mention ? (
          <span
            key={i}
            className={cn(
              'font-semibold',
              mine ? 'underline underline-offset-2' : 'text-primary-ink',
            )}
          >
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

function MessageTools({ mine, actions }: { mine: boolean; actions: MessageActions }) {
  const more = actions.onEdit || actions.onDelete;
  return (
    <span className="flex items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 has-[[data-state=open]]:opacity-100">
      <EmojiPicker
        set="chat"
        align={mine ? 'end' : 'start'}
        onSelect={actions.onReact}
        trigger={
          <Button variant="ghost" size="icon-xs" aria-label="React">
            <SmilePlus />
          </Button>
        }
      />
      {more ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label="Message actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={mine ? 'end' : 'start'}>
            {actions.onEdit ? (
              <DropdownMenuItem onSelect={actions.onEdit}>
                <Pencil /> Edit
              </DropdownMenuItem>
            ) : null}
            {actions.onDelete ? (
              <DropdownMenuItem
                onSelect={actions.onDelete}
                className="text-destructive-ink focus:text-destructive-ink"
              >
                <Trash2 /> Delete
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </span>
  );
}

/** Editing my message in place: the same box as the composer, Enter saves,
 *  Escape cancels. */
export function MessageEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (body: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const body = sendableBody(text);
  const save = () => {
    if (!body) return;
    if (body === initial) onCancel();
    else onSave(body);
  };
  return (
    <div className="w-[min(32rem,100%)] rounded-lg border border-border bg-card/70 p-2 shadow-sm">
      <label htmlFor="chat-edit-text" className="sr-only">
        Edit message
      </label>
      <Textarea
        id="chat-edit-text"
        autoFocus
        value={text}
        rows={Math.min(8, Math.max(2, text.split('\n').length))}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            save();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        className="min-h-0 resize-none border-0 px-2 focus-visible:ring-0 focus-visible:ring-offset-0"
      />
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={!body}>
          Save edit
        </Button>
      </div>
    </div>
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
