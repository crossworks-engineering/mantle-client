'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { SendHorizontal, Smile } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { Textarea } from '@mantle/web-ui/ui/textarea';
import { cn } from '@mantle/web-ui/lib/utils';
import { EmojiPicker } from '@/components/emoji-picker';
import { BODY_MAX, sendableBody } from '@/lib/messenger/transcript';

/** The text area's tallest, in lines, before it scrolls. */
const MAX_ROWS = 8;

/**
 * The composer under the transcript, on the boxed composer surface (style
 * guide 6c: bordered, `bg-card/70`, `shadow-sm`): the text area, then the
 * emoji button and Send. Enter sends, Shift+Enter starts a new line; an
 * input method's Enter (composing) never sends.
 */
export function ChatComposer({
  onSend,
  onTyping,
  disabled = false,
}: {
  onSend: (body: string) => void;
  onTyping: () => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  const body = sendableBody(text);
  const tooLong = text.length > BODY_MAX;

  const grow = () => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.style.height = `${Math.min(el.scrollHeight, line * MAX_ROWS + 16)}px`;
  };

  const submit = () => {
    if (!body || disabled) return;
    onSend(body);
    setText('');
    requestAnimationFrame(() => {
      grow();
      area.current?.focus();
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const insert = (s: string) => {
    const el = area.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + s + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + s.length, start + s.length);
      grow();
    });
  };

  return (
    <div
      data-slot="chat-composer"
      className="rounded-lg border border-border bg-card/70 shadow-sm focus-within:ring-2 focus-within:ring-ring"
    >
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
          setText(e.target.value);
          grow();
          if (e.target.value.trim()) onTyping();
        }}
        onKeyDown={onKeyDown}
        placeholder="Type a message…"
        aria-invalid={tooLong || undefined}
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
          <Button type="button" size="sm" onClick={submit} disabled={!body || disabled}>
            <SendHorizontal />
            Send
          </Button>
        </span>
      </div>
    </div>
  );
}
