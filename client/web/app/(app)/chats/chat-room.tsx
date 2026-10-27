'use client';

/**
 * One open chat: the header, the transcript and the composer. The transcript
 * holds a window of messages by seq (lib/messenger/transcript.ts): the last
 * 20 on open, 20 more each time the reader scrolls to the top (the scroll
 * position kept), and whatever is above the highest seq held after each
 * stream event, reconnect, focus or silent-stream poll. The read cursor
 * moves when the newest message is on screen and the tab is visible.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown } from 'lucide-react';
import { ApiError } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { ItemHeader } from '@/components/layout/item-header';
import { ChatAvatar } from '@/components/messenger/chat-avatar';
import {
  receipts,
  useMessengerBus,
  useReadByAll,
  useTyping,
} from '@/components/messenger/messenger-live';
import { messengerApi, messengerKeys } from '@/lib/messenger/api';
import type { MessengerConversation, MessengerListRow } from '@/lib/messenger/dto';
import { otherPeople, presenceLine, stampLabel } from '@/lib/messenger/format';
import { shouldSendTyping, typingLine } from '@/lib/messenger/live';
import {
  EMPTY_TRANSCRIPT,
  PAGE_SIZE,
  authorReadSeqs,
  highestSeq,
  lowestSeq,
  newClientMsgId,
  readCursorToSend,
  transcriptItems,
  withLatestPage,
  withNewer,
  withOlderPage,
  withOutbox,
  withoutOutbox,
  type OutboxLine,
  type Transcript,
} from '@/lib/messenger/transcript';
import { ChatComposer } from './chat-composer';
import { ChatMessage, OutboxMessage } from './chat-message';

/** Within this of the bottom the transcript follows new messages. */
const STICK_PX = 80;
/** Within this of the top the next older page loads. */
const LOAD_OLDER_PX = 80;
/** The catch-up's page: the brain's ceiling. */
const CATCH_UP_LIMIT = 100;

export function ChatRoom({
  id,
  row,
  me,
  online,
  onGone,
}: {
  id: string;
  /** The list's row, while the list has it (title, people, presence). */
  row: MessengerListRow | null;
  me: string | null;
  online: ReadonlySet<string>;
  /** The chat is not mine to read (left, removed, never in it). */
  onGone: () => void;
}) {
  const queryClient = useQueryClient();
  const conversationQuery = useQuery({
    queryKey: messengerKeys.conversation(id),
    queryFn: () => messengerApi.conversation(id),
    retry: (n, err) => !(err instanceof ApiError && err.status === 404) && n < 2,
  });
  const conversation = conversationQuery.data ?? null;

  const [t, setT] = useState<Transcript>(EMPTY_TRANSCRIPT);
  const tRef = useRef(t);
  tRef.current = t;
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);
  loadedRef.current = loaded;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  // Set before an older page lands: the scroll height to keep the reader's
  // place against (the page grows above them).
  const keepFrom = useRef<number | null>(null);
  const scrollToBottom = useRef(true);

  const loadLatest = useCallback(async () => {
    try {
      const page = await messengerApi.messages(id, { limit: PAGE_SIZE });
      setT((cur) => withLatestPage(cur, page));
      setLoadError(null);
      scrollToBottom.current = true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) onGone();
      else setLoadError(err instanceof Error ? err.message : 'Could not load the chat');
    } finally {
      setLoaded(true);
    }
  }, [id, onGone]);

  // One catch-up at a time; a second request while one runs runs again after.
  const catching = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const catchUp = useCallback(async (): Promise<void> => {
    if (catching.current) {
      again.current = true;
      return catching.current;
    }
    const run = async () => {
      do {
        again.current = false;
        let more = true;
        while (more) {
          const after = highestSeq(tRef.current.messages);
          const page = await messengerApi.messages(id, { afterSeq: after, limit: CATCH_UP_LIMIT });
          if (page.messages.length > 0) setT((cur) => withNewer(cur, page.messages));
          tRef.current = withNewer(tRef.current, page.messages);
          more = page.hasMore && page.messages.length > 0;
        }
      } while (again.current);
    };
    catching.current = run()
      .catch(() => {
        /* the next event, focus or poll tries again */
      })
      .finally(() => {
        catching.current = null;
      });
    return catching.current;
  }, [id]);

  const refetchSeq = useCallback(
    async (seq: number) => {
      try {
        const page = await messengerApi.messages(id, { afterSeq: seq - 1, limit: 1 });
        const hit = page.messages.filter((m) => m.seq === seq);
        if (hit.length) setT((cur) => withNewer(cur, hit));
      } catch {
        /* the next load shows it */
      }
    },
    [id],
  );

  const reload = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: messengerKeys.conversation(id) });
    void loadLatest();
  }, [id, loadLatest, queryClient]);

  useEffect(() => {
    void loadLatest();
  }, [loadLatest]);

  // An author has read up to its own message: seed the receipts from the
  // transcript before any read event is heard.
  useEffect(() => {
    for (const [loginId, seq] of authorReadSeqs(t.messages)) receipts.record(id, loginId, seq);
  }, [id, t.messages]);

  useMessengerBus((e) => {
    if (e.kind === 'gap') {
      if (loadedRef.current) void catchUp();
      void queryClient.invalidateQueries({ queryKey: messengerKeys.conversation(id) });
      return;
    }
    const fx = e.effect;
    if (fx.c !== id) return;
    if (fx.catchUp && loadedRef.current) void catchUp();
    if (fx.refetchSeq !== null) void refetchSeq(fx.refetchSeq);
    if (fx.reload) reload();
  });

  // ── Scrolling ─────────────────────────────────────────────────────────
  const loadOlder = useCallback(async () => {
    const before = lowestSeq(tRef.current.messages);
    if (loadingOlder || !tRef.current.hasOlder || before === null) return;
    setLoadingOlder(true);
    try {
      const page = await messengerApi.messages(id, { beforeSeq: before, limit: PAGE_SIZE });
      keepFrom.current = scroller.current?.scrollHeight ?? null;
      setT((cur) => withOlderPage(cur, page));
    } catch {
      /* scrolling up again retries */
    } finally {
      setLoadingOlder(false);
    }
  }, [id, loadingOlder]);

  // After each change of the window: keep the place after an older page,
  // follow the bottom when the reader was there.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (keepFrom.current !== null) {
      el.scrollTop += el.scrollHeight - keepFrom.current;
      keepFrom.current = null;
      return;
    }
    if (scrollToBottom.current || atBottom.current) {
      el.scrollTop = el.scrollHeight;
      scrollToBottom.current = false;
      atBottom.current = true;
      setShowJump(false);
    }
  }, [t]);

  // A short first page leaves no scrollbar to reach the top with: load more
  // until the transcript can scroll (or there is nothing older).
  useEffect(() => {
    const el = scroller.current;
    if (!el || !loaded || !t.hasOlder || loadingOlder) return;
    if (el.scrollHeight <= el.clientHeight + LOAD_OLDER_PX) void loadOlder();
  }, [loaded, t, loadingOlder, loadOlder]);

  // ── The read cursor ───────────────────────────────────────────────────
  const readSent = useRef(0);
  const myRead = conversation?.me.lastReadSeq ?? 0;
  const markRead = useCallback(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (!atBottom.current) return;
    const seq = readCursorToSend(
      tRef.current.messages.length ? highestSeq(tRef.current.messages) : null,
      Math.max(myRead, readSent.current),
    );
    if (seq === null) return;
    readSent.current = seq;
    void messengerApi
      .read(id, seq)
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: messengerKeys.list });
        void queryClient.invalidateQueries({ queryKey: messengerKeys.unread });
      })
      .catch(() => {
        readSent.current = 0;
      });
  }, [id, myRead, queryClient]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottom.current = fromBottom < STICK_PX;
    setShowJump(!atBottom.current);
    if (el.scrollTop < LOAD_OLDER_PX) void loadOlder();
    if (atBottom.current) markRead();
  };

  useEffect(() => {
    if (loaded) markRead();
  }, [loaded, t.messages, markRead]);
  useEffect(() => {
    const onVisible = () => markRead();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [markRead]);

  // ── Sending ───────────────────────────────────────────────────────────
  const send = useCallback(
    async (body: string, clientMsgId = newClientMsgId()) => {
      const line: OutboxLine = {
        clientMsgId,
        body,
        createdAt: new Date().toISOString(),
        state: 'sending',
      };
      scrollToBottom.current = true;
      setT((cur) => withOutbox(cur, line));
      try {
        const out = await messengerApi.send(id, { body, clientMsgId });
        scrollToBottom.current = true;
        setT((cur) => withNewer(cur, [out.message]));
        void queryClient.invalidateQueries({ queryKey: messengerKeys.list });
      } catch (err) {
        const error =
          err instanceof ApiError && err.status === 429
            ? err.message || 'Too many messages. Wait a moment, then retry.'
            : err instanceof Error
              ? err.message
              : 'Not sent';
        setT((cur) => withOutbox(cur, { ...line, state: 'failed', error }));
      }
    },
    [id, queryClient],
  );

  const lastTyping = useRef<number | null>(null);
  const onTyping = useCallback(() => {
    const now = Date.now();
    if (!shouldSendTyping(lastTyping.current, now)) return;
    lastTyping.current = now;
    void messengerApi.typing(id).catch(() => {});
  }, [id]);

  // ── Drawing ───────────────────────────────────────────────────────────
  const people = conversation?.participants ?? row?.participants ?? [];
  const group = (conversation?.kind ?? row?.kind) === 'group';
  const title = row?.title ?? conversation?.title ?? titleOf(conversation, me);
  const others = otherPeople(people, me);
  const readByAll = useReadByAll(
    id,
    others.map((p) => p.id),
  );
  const items = useMemo(() => transcriptItems(t, me, group), [t, me, group]);
  const typingIds = useTyping(id).filter((x) => x !== me);
  const typing = typingLine(
    typingIds.map((x) => people.find((p) => p.id === x)?.name ?? 'Someone'),
  );
  const presence = presenceLine(
    { kind: group ? 'group' : 'direct', participants: people },
    me,
    online,
  );
  const peerOnline = !group && others.some((p) => online.has(p.id));
  const left = conversation?.me.leftSeq != null;

  if (conversationQuery.isError && !conversation) {
    const gone =
      conversationQuery.error instanceof ApiError && conversationQuery.error.status === 404;
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        {gone ? 'This chat is not available.' : 'Could not load this chat.'}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="chat-room">
      <ItemHeader
        sticky
        section="Chats"
        visual={
          <ChatAvatar
            name={title}
            kind={group ? 'group' : 'person'}
            online={peerOnline}
            size="sm"
          />
        }
        title={title}
        subtitle={
          <span className={peerOnline ? 'text-success-ink' : 'text-muted-foreground'}>
            {presence}
          </span>
        }
      />
      <div
        ref={scroller}
        onScroll={onScroll}
        className="relative min-h-0 flex-1 overflow-y-auto scrollbar-thin"
        data-testid="chat-transcript"
        aria-live="polite"
      >
        <div className="flex min-h-full flex-col justify-end gap-1 px-6 py-4">
          {loadingOlder ? (
            <div className="flex justify-center py-2">
              <Spinner />
            </div>
          ) : null}
          {!loaded ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : loadError ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{loadError}</p>
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No messages yet. Say hello.
            </p>
          ) : (
            items.map((it) =>
              it.kind === 'stamp' ? (
                <div
                  key={it.key}
                  className="py-2 text-center text-xs text-muted-foreground"
                  data-testid="chat-stamp"
                >
                  {stampLabel(it.at)}
                </div>
              ) : it.kind === 'message' ? (
                <ChatMessage
                  key={it.key}
                  message={it.message}
                  mine={it.mine}
                  showAuthor={it.showAuthor}
                  read={it.mine && readByAll >= it.message.seq}
                />
              ) : (
                <OutboxMessage
                  key={it.key}
                  line={it.line}
                  onRetry={() => void send(it.line.body, it.line.clientMsgId)}
                  onDiscard={() => setT((cur) => withoutOutbox(cur, it.line.clientMsgId))}
                />
              ),
            )
          )}
        </div>
      </div>
      {showJump ? (
        <div className="pointer-events-none relative">
          <Button
            variant="outline"
            size="icon-sm"
            className="pointer-events-auto absolute -top-12 right-6 rounded-full shadow-sm"
            aria-label="Jump to the latest message"
            onClick={() => {
              const el = scroller.current;
              if (el) el.scrollTop = el.scrollHeight;
            }}
          >
            <ArrowDown />
          </Button>
        </div>
      ) : null}
      <div className="px-6 pb-4">
        <p className="h-5 text-xs text-muted-foreground" aria-live="polite">
          {typing ? `${typing}…` : ''}
        </p>
        {left ? (
          <p className="rounded-lg border border-border bg-card/70 p-3 text-center text-sm text-muted-foreground">
            You left this chat.
          </p>
        ) : (
          <ChatComposer onSend={(body) => void send(body)} onTyping={onTyping} />
        )}
      </div>
    </div>
  );
}

/** A chat's name when the list has no row for it yet: its title, or the
 *  other person's name. */
function titleOf(c: MessengerConversation | null, me: string | null): string {
  if (!c) return 'Chat';
  if (c.title) return c.title;
  const others = otherPeople(c.participants, me);
  return others.map((p) => p.name).join(', ') || 'Chat';
}
