'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  AtSign,
  FileText,
  Loader2,
  Paperclip,
  Reply,
  SendHorizontal,
  Smile,
  X,
} from 'lucide-react';
import { desktopShell } from '@mantle/web-ui/desktop-shell';
import { APP_VERSION } from '@mantle/web-ui/version';
import { Button } from '@mantle/web-ui/ui/button';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Textarea } from '@mantle/web-ui/ui/textarea';
import { cn } from '@mantle/web-ui/lib/utils';
import { useToast } from '@mantle/web-ui/ui/toast';
import { EmojiPicker } from '@/components/emoji-picker';
import { ChatAvatar } from '@/components/messenger/chat-avatar';
import { useChatFaces } from '@/components/messenger/chat-faces';
import type {
  MessengerAttachment,
  MessengerMention,
  MessengerParticipant,
} from '@/lib/messenger/dto';
import { clientErrors } from '@/lib/client-errors';
import { decideComposerPaste } from '@/lib/composer-paste';
import { TASK_FILE_ACCEPT, TASK_FILE_TYPES_TEXT, TASK_PASTE_ACCEPT } from '@/lib/task-files';
import {
  addDraftFiles,
  clearDraftFiles,
  draftPayload,
  draftSettled,
  removeDraftFile,
  useDraftFiles,
} from '@/lib/messenger/draft-files';
import {
  addedLines,
  addressLabel,
  addressProblem,
  addressesOf,
  bodyWithLines,
  answersToSend,
  formatBytes,
  intakeOf,
  leftOutNote,
  type AddedLine,
  type AddressPick,
} from '@/lib/messenger/fleet';
import {
  applyMention,
  mentionAt,
  mentionCandidates,
  mentionsInBody,
  type PickedMention,
} from '@/lib/messenger/mentions';
import { BODY_MAX, sendableBody, type SendExtra } from '@/lib/messenger/transcript';
import { getDraft, setDraft } from '@/lib/messenger/drafts';
import { SendPreview, TOO_BIG } from './send-preview';

/** The text area's tallest, in lines, before it scrolls. */
const MAX_ROWS = 8;
/** At most this many people in the mention picker. */
const MENTION_ROWS = 6;

/** A row of the mention picker: one of the chat's people, or (fleet chat)
 *  a handle or an IT desk of the box. */
type Candidate =
  | { key: string; name: string; person: MessengerParticipant }
  | { key: string; name: string; address: AddressPick };

/** The line a Reply answers, shown over the composer. */
export type ReplyTarget = {
  seq: number;
  name: string;
  snippet: string;
  /** Where the reply also goes (a copy line's sender), or null. */
  note: string | null;
};

/**
 * The composer under the transcript, on the boxed composer surface (style
 * guide 6c: bordered, `bg-card/70`, `shadow-sm`): the text area (fading out
 * above the row instead of a hard edge), then one action row inside the box,
 * the emoji and mention buttons at its left and Send at its right end.
 * Enter sends, Shift+Enter starts a new line; an input method's Enter
 * (composing) never sends.
 *
 * Typing "@" (or the @ button) opens the mention picker over the box: the
 * chat's other people, and the box's handles and IT desks, narrowed as the
 * name is typed; arrows move, Enter or Tab picks, Escape closes. A send
 * carries the mentions still written in it.
 *
 * Fleet chat: the paperclip (or a pasted picture) adds files to the draft
 * (draft-files.ts); a file over 10 MB is marked and named in `leftOut`. A
 * Reply shows its line over the box. A line that names a handle or a desk,
 * or any line of my own "To @qa" thread (`target`), opens the send screen
 * first (send-preview.tsx).
 */
export function ChatComposer({
  onSend,
  onTyping,
  people = [],
  disabled = false,
  canSend = true,
  placeholder = 'Type a message…',
  id = 'chat-composer-text',
  onTextChange,
  draftKey,
  addresses = [],
  target = null,
  site,
  upload,
  replyTo = null,
  onCancelReply,
}: {
  /** A promise keeps the text until it answers, and keeps it on false
   *  (the New message form: nothing was created). */
  onSend: (
    body: string,
    mentions: MessengerMention[],
    extra?: SendExtra,
  ) => void | Promise<boolean>;
  onTyping?: () => void;
  /** Who may be mentioned: the chat's other people. */
  people?: readonly MessengerParticipant[];
  disabled?: boolean;
  /** Typing stays open; only Send waits (no one picked yet). */
  canSend?: boolean;
  placeholder?: string;
  id?: string;
  /** The text as it changes (the New message form carries it to an
   *  assistant's own composer). */
  onTextChange?: (text: string) => void;
  /** The chat whose unsent text this is: kept in memory by chat
   *  (lib/messenger/drafts.ts), so the room can unmount and come back to
   *  it (the Chats window's back, Open in Chats, another chat). */
  draftKey?: string;
  /** The box's handles and IT desks, for the @ list. */
  addresses?: readonly AddressPick[];
  /** My own "To @qa" thread: the address every send here names. */
  target?: MessengerMention | null;
  /** The desks' site (the Control Center's name). */
  site?: string;
  /** Files: upload one to this chat (no files without it, or a draftKey). */
  upload?: (file: File) => Promise<MessengerAttachment>;
  replyTo?: ReplyTarget | null;
  onCancelReply?: () => void;
}) {
  const faceOf = useChatFaces();
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const [text, setText] = useState(() => (draftKey && getDraft(draftKey)?.text) || '');
  const [caret, setCaret] = useState(0);
  const [picked, setPicked] = useState<PickedMention[]>(() =>
    draftKey ? [...(getDraft<PickedMention>(draftKey)?.picked ?? [])] : [],
  );
  useEffect(() => {
    if (draftKey) setDraft(draftKey, { text, picked });
  }, [draftKey, text, picked]);
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const body = sendableBody(text);
  const filesOn = !!upload && !!draftKey;
  const files = useDraftFiles(filesOn ? draftKey : undefined);
  const settled = draftSettled(files);
  // The brain adds the note for files left out to the text: the cap counts
  // the line as it will be stored.
  const note = leftOutNote(draftPayload(files).leftOut);
  const lineLength = text.length + (note ? note.length + 2 : 0);
  const tooLong = lineLength > BODY_MAX;
  const [preview, setPreview] = useState<{
    to: string;
    intake: AddressPick['intake'];
    lines: AddedLine[];
    mentions: MessengerMention[];
  } | null>(null);

  const typing = mentionAt(text, caret);
  const candidates = useMemo<Candidate[]>(() => {
    if (!typing) return [];
    const all: Candidate[] = [
      ...people.map((p) => ({ key: `p:${p.id}`, name: p.name, person: p })),
      ...addresses.map((a) => ({ key: `${a.kind}:${a.id}`, name: a.name, address: a })),
    ];
    return mentionCandidates(all, typing.query).slice(0, MENTION_ROWS);
  }, [people, addresses, typing]);
  const pickerOpen = !!typing && candidates.length > 0 && dismissedAt !== typing.start;

  const grow = () => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const cs = getComputedStyle(el);
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    el.style.height = `${Math.min(el.scrollHeight, line * MAX_ROWS + pad)}px`;
  };
  // A kept draft opens at its own height.
  const grewOnce = useRef(false);
  useEffect(() => {
    if (grewOnce.current) return;
    grewOnce.current = true;
    if (area.current?.value) grow();
  });

  const place = (next: string, at: number) => {
    setText(next);
    onTextChange?.(next);
    setCaret(at);
    requestAnimationFrame(() => {
      const el = area.current;
      el?.focus();
      el?.setSelectionRange(at, at);
      grow();
    });
  };

  const clear = () => {
    setPicked([]);
    setDismissedAt(null);
    if (filesOn) clearDraftFiles(draftKey);
    onCancelReply?.();
    place('', 0);
  };
  const hasContent = !!body || files.length > 0 || !!target;
  const blocked = disabled || !canSend || sending || tooLong || !settled;
  /** The send itself: the text (with the lines kept), the mentions, the
   *  reply, the files and the answers. */
  const go = (text: string, mentions: MessengerMention[], answers?: Record<string, string>) => {
    const { attachments, leftOut } = draftPayload(files);
    const extra: SendExtra = {
      ...(replyTo ? { replyToSeq: replyTo.seq } : {}),
      ...(attachments.length ? { attachments } : {}),
      ...(leftOut.length ? { leftOut } : {}),
      ...(answers && Object.keys(answers).length ? { answers } : {}),
    };
    const out = onSend(text, mentions, Object.keys(extra).length ? extra : undefined);
    if (!out) {
      clear();
      return;
    }
    setSending(true);
    void out.then((ok) => ok && clear()).finally(() => setSending(false));
  };
  const submit = () => {
    if (!hasContent || blocked) return;
    const mentions = mentionsInBody(body ?? '', picked);
    if (target && !mentions.some((m) => m.kind === target.kind && m.id === target.id)) {
      mentions.push(target);
    }
    const problem = addressProblem(mentions);
    if (problem) {
      toast.error(problem);
      return;
    }
    const named = addressesOf(mentions);
    if (named.length > 0) {
      // A line that leaves this chat: the send screen shows the package.
      const intake = intakeOf(mentions, addresses);
      setPreview({
        to: named.map((m) => addressLabel(m, addresses, site)).join(', '),
        intake,
        lines: intake
          ? addedLines({
              appVersion: APP_VERSION,
              shell: desktopShell() ? 'desktop' : 'web',
              route: window.location.pathname,
              screen: document.title,
              errors: clientErrors(),
            })
          : [],
        mentions,
      });
      return;
    }
    go(body ?? '', mentions);
  };

  const addFiles = (list: FileList | readonly File[] | null) => {
    if (!filesOn || !list || list.length === 0) return;
    const { refused } = addDraftFiles(draftKey, [...list], (_chat, f) => upload(f));
    if (refused.length > 0) toast.error(refused.join(' '));
  };

  const pick = (c: Candidate) => {
    if (!typing) return;
    const out = applyMention(text, typing.start, caret, c.name);
    setPicked((cur) => [
      ...cur,
      'person' in c
        ? { kind: c.person.kind, id: c.person.id, name: c.name }
        : c.address.kind === 'desk'
          ? { kind: 'desk', id: c.address.id as 'bug' | 'feature' | 'request', name: c.name }
          : { kind: 'handle', id: c.address.id, name: c.name },
    ]);
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
          id={`${id}-mentions`}
          role="listbox"
          aria-label="Mention someone"
          className="absolute inset-x-2 bottom-full mb-1 space-y-0.5 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {candidates.map((c, i) => (
            <li
              key={c.key}
              id={`${id}-mention-${optionId(c.key)}`}
              role="option"
              aria-selected={i === active}
            >
              <RowButton
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                  i === active ? 'bg-muted' : 'hover:bg-foreground/[0.04]',
                )}
              >
                {'person' in c ? (
                  <>
                    <ChatAvatar
                      name={c.name}
                      kind={c.person.kind === 'agent' ? 'agent' : 'person'}
                      face={faceOf({
                        kind: c.person.kind,
                        id: c.person.id,
                        avatar: c.person.avatar,
                        photoVersion: c.person.photoVersion,
                      })}
                      size="sm"
                    />
                    {c.name}
                  </>
                ) : (
                  <>
                    <span
                      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                      aria-hidden
                    >
                      <AtSign className="size-3.5" />
                    </span>
                    <span className="font-medium">@{c.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {c.address.title}
                    </span>
                  </>
                )}
              </RowButton>
            </li>
          ))}
        </ul>
      ) : null}
      {replyTo ? (
        <div
          className="flex items-start gap-2 border-b border-border px-3 py-2 text-xs"
          data-testid="composer-reply"
        >
          <Reply className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="font-medium">Reply to {replyTo.name}</span>
            <span className="block truncate text-muted-foreground">{replyTo.snippet}</span>
            {replyTo.note ? <span className="block text-primary-ink">{replyTo.note}</span> : null}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Cancel the reply"
            onClick={onCancelReply}
          >
            <X />
          </Button>
        </div>
      ) : null}
      {files.length > 0 ? (
        <ul className="flex flex-wrap gap-2 px-3 pt-2" aria-label="Files to send">
          {files.map((f) => (
            <li
              key={f.key}
              className="flex max-w-60 items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-xs"
              data-testid="composer-file"
            >
              {f.url ? (
                // A local blob: next/image cannot optimise it.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.url} alt="" className="size-8 shrink-0 rounded object-cover" />
              ) : (
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{f.name}</span>
                <span
                  className={cn(
                    'block',
                    f.state === 'too-big' || f.state === 'failed'
                      ? 'text-destructive-ink'
                      : 'text-muted-foreground',
                  )}
                >
                  {f.state === 'too-big'
                    ? TOO_BIG
                    : f.state === 'failed'
                      ? (f.error ?? 'Not uploaded')
                      : formatBytes(f.bytes)}
                </span>
              </span>
              {f.state === 'uploading' ? (
                <Loader2 className="size-3.5 animate-spin" aria-label="Uploading" />
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${f.name}`}
                onClick={() => removeDraftFile(draftKey!, f.key)}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <label htmlFor={id} className="sr-only">
        Message
      </label>
      <Textarea
        id={id}
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
          onTextChange?.(next);
          setCaret(at);
          setActive(0);
          grow();
          if (e.target.value.trim()) onTyping?.();
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-invalid={tooLong || undefined}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={pickerOpen ? `${id}-mentions` : undefined}
        aria-expanded={pickerOpen}
        aria-activedescendant={
          pickerOpen
            ? `${id}-mention-${optionId(candidates[Math.min(active, candidates.length - 1)]!.key)}`
            : undefined
        }
        onPaste={(e) => {
          // A pasted picture (a snippet tool's) or a copied file goes in as a
          // file. Text from Word or Excel comes with a picture of itself:
          // that stays text (lib/composer-paste.ts has the traps).
          if (!filesOn) return;
          const d = decideComposerPaste(
            [...e.clipboardData.types],
            [...e.clipboardData.files],
            TASK_PASTE_ACCEPT,
            e.clipboardData.getData('text/plain'),
          );
          if (d.kind === 'text') return;
          e.preventDefault();
          if (d.kind === 'reject')
            toast.error(`That file cannot go in a chat. Use ${TASK_FILE_TYPES_TEXT}.`);
          // Every file of the paste: one of a type a chat does not take is
          // named, not dropped.
          else addFiles([...e.clipboardData.files]);
        }}
        className="max-h-60 min-h-0 resize-none rounded-lg border-0 px-4 pb-4 pt-3 [mask-image:linear-gradient(to_bottom,black_calc(100%-0.75rem),transparent)] focus-visible:ring-0 focus-visible:ring-offset-0"
      />
      {/* One action row under the text: the emoji and mention buttons at
          its left, the count and Send at its right end. */}
      <div
        className="flex items-center gap-1 px-2 pb-2"
        // A click in the row's empty space goes to the text.
        onMouseDown={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          area.current?.focus();
        }}
      >
        <EmojiPicker
          set="chat"
          align="start"
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
        {filesOn ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Add files"
              disabled={disabled}
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip />
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              accept={TASK_FILE_ACCEPT}
              data-testid="composer-file-input"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </>
        ) : null}
        {people.length > 0 || addresses.length > 0 ? (
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
        <span className="ml-auto flex items-center gap-1">
          <span
            className={cn(
              'mr-1 text-xs tabular-nums',
              tooLong ? 'text-destructive-ink' : 'text-muted-foreground',
              lineLength < BODY_MAX - 500 && 'invisible',
            )}
            aria-live="polite"
          >
            {lineLength} / {BODY_MAX}
          </span>
          <Button type="button" size="sm" onClick={submit} disabled={!hasContent || blocked}>
            <SendHorizontal />
            Send
          </Button>
        </span>
      </div>
      {preview ? (
        <SendPreview
          to={preview.to}
          intake={preview.intake}
          text={body ?? ''}
          files={files}
          lines={preview.lines}
          onRemoveFile={(key) => draftKey && removeDraftFile(draftKey, key)}
          onCancel={() => setPreview(null)}
          onSend={({ answers, lines }) => {
            setPreview(null);
            go(bodyWithLines(body ?? '', lines), preview.mentions, answersToSend(answers));
          }}
        />
      ) : null}
    </div>
  );
}

/** A picker row's DOM id part (a key holds a colon). */
const optionId = (key: string) => key.replace(/[^a-zA-Z0-9_-]/g, '-');
