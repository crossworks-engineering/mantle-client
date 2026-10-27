'use client';

import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AtSign, SendHorizontal, Smile } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Textarea } from '@mantle/web-ui/ui/textarea';
import { cn } from '@mantle/web-ui/lib/utils';
import { EmojiPicker } from '@/components/emoji-picker';
import { ChatAvatar } from '@/components/messenger/chat-avatar';
import type { MessengerMention, MessengerParticipant } from '@/lib/messenger/dto';
import {
  applyMention,
  mentionAt,
  mentionCandidates,
  mentionsInBody,
  type PickedMention,
} from '@/lib/messenger/mentions';
import { BODY_MAX, sendableBody } from '@/lib/messenger/transcript';

/** The text area's tallest, in lines, before it scrolls. */
const MAX_ROWS = 8;
/** At most this many people in the mention picker. */
const MENTION_ROWS = 6;

/**
 * The composer under the transcript, on the boxed composer surface (style
 * guide 6c: bordered, `bg-card/70`, `shadow-sm`): the text area, then the
 * emoji button, the mention button and Send. Enter sends, Shift+Enter starts
 * a new line; an input method's Enter (composing) never sends.
 *
 * Typing "@" (or the @ button) opens the mention picker over the box: the
 * chat's other people, narrowed as the name is typed; arrows move, Enter or
 * Tab picks, Escape closes. A send carries the mentions still written in it.
 */
export function ChatComposer({
  onSend,
  onTyping,
  people = [],
  disabled = false,
}: {
  onSend: (body: string, mentions: MessengerMention[]) => void;
  onTyping: () => void;
  /** Who may be mentioned: the chat's other people. */
  people?: readonly MessengerParticipant[];
  disabled?: boolean;
}) {
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [picked, setPicked] = useState<PickedMention[]>([]);
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const body = sendableBody(text);
  const tooLong = text.length > BODY_MAX;

  const typing = mentionAt(text, caret);
  const candidates = useMemo(
    () => (typing ? mentionCandidates(people, typing.query).slice(0, MENTION_ROWS) : []),
    [people, typing],
  );
  const pickerOpen = !!typing && candidates.length > 0 && dismissedAt !== typing.start;

  const grow = () => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.style.height = `${Math.min(el.scrollHeight, line * MAX_ROWS + 16)}px`;
  };

  const place = (next: string, at: number) => {
    setText(next);
    setCaret(at);
    requestAnimationFrame(() => {
      const el = area.current;
      el?.focus();
      el?.setSelectionRange(at, at);
      grow();
    });
  };

  const submit = () => {
    if (!body || disabled) return;
    onSend(body, mentionsInBody(body, picked));
    setPicked([]);
    setDismissedAt(null);
    place('', 0);
  };

  const pick = (p: MessengerParticipant) => {
    if (!typing) return;
    const out = applyMention(text, typing.start, caret, p.name);
    setPicked((cur) => [...cur, { kind: p.kind, id: p.id, name: p.name }]);
    setActive(0);
    // The space after the name ends the mention (mentionAt), so the picker
    // shuts without a dismissal that would keep it shut at this "@".
    place(out.text, out.caret);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // An input method's keys are its own while it composes.
    if (pickerOpen && !e.nativeEvent.isComposing) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive((a) => (a + step + candidates.length) % candidates.length);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        pick(candidates[Math.min(active, candidates.length - 1)]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissedAt(typing!.start);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const insert = (s: string) => {
    const el = area.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    // An "@" needs a space before it to start a mention.
    const lead = s === '@' && start > 0 && !/\s/.test(text[start - 1]!) ? ' ' : '';
    place(text.slice(0, start) + lead + s + text.slice(end), start + lead.length + s.length);
  };

  return (
    <div
      data-slot="chat-composer"
      className="relative rounded-lg border border-border bg-card/70 shadow-sm focus-within:ring-2 focus-within:ring-ring"
    >
      {pickerOpen ? (
        <ul
          id="chat-mention-list"
          role="listbox"
          aria-label="Mention someone"
          className="absolute inset-x-2 bottom-full mb-1 space-y-0.5 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {candidates.map((p, i) => (
            <li key={p.id} id={`chat-mention-${p.id}`} role="option" aria-selected={i === active}>
              <RowButton
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                  i === active ? 'bg-muted' : 'hover:bg-foreground/[0.04]',
                )}
              >
                <ChatAvatar name={p.name} size="sm" />
                {p.name}
              </RowButton>
            </li>
          ))}
        </ul>
      ) : null}
      <label htmlFor="chat-composer-text" className="sr-only">
        Message
      </label>
      <Textarea
        id="chat-composer-text"
        ref={area}
        rows={1}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value;
          const at = e.target.selectionStart ?? next.length;
          // An Escape holds for its "@" until the "@" or the whole name after
          // it is gone: then a mention typed there opens the picker again.
          if (dismissedAt !== null && (next[dismissedAt] !== '@' || at <= dismissedAt + 1)) {
            setDismissedAt(null);
          }
          setText(next);
          setCaret(at);
          setActive(0);
          grow();
          if (e.target.value.trim()) onTyping();
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={onKeyDown}
        placeholder="Type a message…"
        aria-invalid={tooLong || undefined}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={pickerOpen ? 'chat-mention-list' : undefined}
        aria-expanded={pickerOpen}
        aria-activedescendant={
          pickerOpen
            ? `chat-mention-${candidates[Math.min(active, candidates.length - 1)]!.id}`
            : undefined
        }
        className="max-h-60 min-h-0 resize-none rounded-lg border-0 px-4 pb-1 pt-3 focus-visible:ring-0 focus-visible:ring-offset-0"
      />
      <div className="flex items-center gap-1 px-2 pb-2">
        <span
          className={cn(
            'ml-2 text-xs tabular-nums',
            tooLong ? 'text-destructive-ink' : 'text-muted-foreground',
            text.length < BODY_MAX - 500 && 'invisible',
          )}
          aria-live="polite"
        >
          {text.length} / {BODY_MAX}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <EmojiPicker
            set="chat"
            align="end"
            onSelect={insert}
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Insert an emoji"
                disabled={disabled}
              >
                <Smile />
              </Button>
            }
          />
          {people.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Mention someone"
              disabled={disabled}
              onClick={() => {
                setDismissedAt(null);
                insert('@');
              }}
            >
              <AtSign />
            </Button>
          ) : null}
          <Button type="button" size="sm" onClick={submit} disabled={!body || disabled}>
            <SendHorizontal />
            Send
          </Button>
        </span>
      </div>
    </div>
  );
}
