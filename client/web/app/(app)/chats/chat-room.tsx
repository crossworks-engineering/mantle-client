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
import { useDefaultLayout } from 'react-resizable-panels';
import { ArrowDown, Bell, BellOff, PanelRight, Pin, PinOff } from 'lucide-react';
import { ApiError } from '@mantle/web-ui/api-fetch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@mantle/web-ui/ui/alert-dialog';
import { Button } from '@mantle/web-ui/ui/button';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@mantle/web-ui/ui/resizable';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { useToast } from '@mantle/web-ui/ui/toast';
import { ItemHeader } from '@/components/layout/item-header';
import { ChatAvatar } from '@/components/messenger/chat-avatar';
import { useChatFaces } from '@/components/messenger/chat-faces';
import {
  receipts,
  useMessengerBus,
  useReadByAll,
  useTyping,
} from '@/components/messenger/messenger-live';
import { messengerApi, messengerKeys } from '@/lib/messenger/api';
import type {
  MessengerConversation,
  MessengerListRow,
  MessengerMention,
  MessengerMessage,
} from '@/lib/messenger/dto';
import { otherPeople, presenceLine, stampLabel } from '@/lib/messenger/format';
import { shouldSendTyping, typingLine } from '@/lib/messenger/live';
import {
  EMPTY_TRANSCRIPT,
  PAGE_SIZE,
  authorReadSeqs,
  contiguousTop,
  refetchPlacement,
  seqsCutAbove,
  lowestSeq,
  newClientMsgId,
  readCursorToSend,
  readerSeesNewest,
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
import { ChatInspector } from './chat-inspector';
import { ChatMessage, MessageEditor, OutboxMessage } from './chat-message';

/** Within this of the bottom the transcript follows new messages. */
const STICK_PX = 80;
/** Within this of the top the next older page loads. */
const LOAD_OLDER_PX = 80;
/** The catch-up's page: the brain's ceiling. */
const CATCH_UP_LIMIT = 100;
/** What `useDefaultLayout` reads on the server. */
const NO_STORAGE = { getItem: () => null, setItem: () => {} };
/** The inspector's open state, remembered for the next chat. */
const INSPECTOR_KEY = 'mantle:chats:inspector';

function readInspectorOpen(): boolean {
  try {
    return window.localStorage.getItem(INSPECTOR_KEY) === '1';
  } catch {
    return false;
  }
}

/** The room's width under which the inspector lies over the transcript
 *  instead of taking a column (the two columns' minimums, and a margin). */
const ROOM_WITH_INSPECTOR = 680;
/** The read cursor goes at most this often. */
const READ_DEBOUNCE_MS = 400;

/** The first message of a chat just made in the New message form. */
export type FirstMessage = {
  c: string;
  body: string;
  mentions: MessengerMention[];
  clientMsgId: string;
};

export function ChatRoom({
  id,
  row,
  me,
  online,
  firstMessages,
  onFirstSent,
  onGone,
}: {
  id: string;
  /** The list's row, while the list has it (title, people, presence). */
  row: MessengerListRow | null;
  me: string | null;
  online: ReadonlySet<string>;
  /** The New message form's lines for this chat, in order: in the outbox
   *  from the start (they show with the first page), sent once that page
   *  has landed (a refused one offers Retry with the same clientMsgId). */
  firstMessages?: readonly FirstMessage[];
  /** They went out: the screen forgets them. Until then they stay with the
   *  screen, so a room left before its first page still sends them later. */
  onFirstSent?: (c: string) => void;
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
  // `loaded`: the first page has landed. Until then a stream event loads the
  // page instead of catching up (a catch-up from nothing would pull the whole
  // history).
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);
  loadedRef.current = loaded;
  const loading = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const onGoneRef = useRef(onGone);
  onGoneRef.current = onGone;
  const [loadingOlder, setLoadingOlder] = useState(false);

  // An older page that failed stops the auto-fill below until the reader
  // scrolls, a page load or a gap (no request loop while offline).
  const [olderFailed, setOlderFailed] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  // Set before an older page lands: the message the reader's place is kept
  // on (the page grows above it), and where it sat in the view.
  const keepFrom = useRef<{ seq: number; offset: number; height: number } | null>(null);
  const scrollToBottom = useRef(true);
  // Bumped by every page load: a catch-up, an older page or a refetch that
  // was asked for before it belongs to the old window and is dropped.
  const epoch = useRef(0);
  // A reload that failed after the first page: the next event or gap tries
  // it again (its error is not the first load's, and blocks nothing).
  const reloadPending = useRef(false);
  const reloadRef = useRef<() => Promise<void>>(async () => {});

  // One catch-up at a time; a second request while one runs runs again after.
  // It asks for what is above the top of the unbroken run held, so a seq
  // merged early (my own send) never hides the one under it.
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
          const ep = epoch.current;
          const after = contiguousTop(tRef.current.messages);
          const page = await messengerApi.messages(id, { afterSeq: after, limit: CATCH_UP_LIMIT });
          // A page load replaced the window meanwhile: drop this page. A
          // catch-up it asked for since (`again`) runs on the new window;
          // one still in flight asks once it lands.
          if (ep !== epoch.current) break;
          // The seqs right above the window are gone (a history delete, or I
          // was out of the group): what is held is stale, load the chat again.
          if (seqsCutAbove(after, page.messages)) {
            void reloadRef.current();
            return;
          }
          tRef.current = withNewer(tRef.current, page.messages);
          if (page.messages.length > 0) setT((cur) => withNewer(cur, page.messages));
          more =
            page.hasMore &&
            page.messages.length > 0 &&
            contiguousTop(tRef.current.messages) > after;
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

  // The last page: on open, after a failed first load, and on a reload
  // (people, history, my clear from another tab). A page served before a
  // message committed can land after a catch-up merged that message, so a
  // catch-up always follows it.
  // A reload asked for while one is in flight runs again once it lands: the
  // page in flight may predate what asked (a history delete).
  const loadAgain = useRef(false);
  const loadLatest = useCallback(async () => {
    if (loading.current) {
      loadAgain.current = true;
      return;
    }
    loading.current = true;
    try {
      do {
        loadAgain.current = false;
        epoch.current += 1;
        const page = await messengerApi.messages(id, { limit: PAGE_SIZE });
        epoch.current += 1;
        tRef.current = withLatestPage(tRef.current, page);
        setT((cur) => withLatestPage(cur, page));
      } while (loadAgain.current);
      reloadPending.current = false;
      setOlderFailed(false);
      setLoadError(null);
      if (!loadedRef.current) scrollToBottom.current = true;
      loadedRef.current = true;
      setLoaded(true);
      void catchUp();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) onGoneRef.current();
      else if (loadedRef.current) reloadPending.current = true;
      else setLoadError(err instanceof Error ? err.message : 'Could not load the chat');
    } finally {
      loading.current = false;
    }
  }, [id, catchUp]);
  reloadRef.current = loadLatest;

  const refetchSeq = useCallback(
    async (seq: number) => {
      const where = refetchPlacement(tRef.current.messages, seq);
      if (where === 'ignore') return;
      if (where === 'catch-up') {
        void catchUp();
        return;
      }
      try {
        const page = await messengerApi.messages(id, { afterSeq: seq - 1, limit: 1 });
        const hit = page.messages.filter((m) => m.seq === seq);
        // Placed against the window as it is now: a page load may have
        // replaced it while this was in flight.
        const now = refetchPlacement(tRef.current.messages, seq);
        if (now === 'catch-up') void catchUp();
        if (now !== 'merge' || !hit.length) return;
        tRef.current = withNewer(tRef.current, hit);
        setT((cur) => withNewer(cur, hit));
      } catch {
        /* the next load shows it */
      }
    },
    [id, catchUp],
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
    if (e.kind === 'effect' && e.effect.c !== id) return;
    // No first page yet (in flight, or it failed): load it; it catches up
    // after itself.
    if (!loadedRef.current || reloadPending.current) {
      if (e.kind === 'gap' || e.effect.reload) {
        void queryClient.invalidateQueries({ queryKey: messengerKeys.conversation(id) });
      }
      void loadLatest();
      return;
    }
    if (e.kind === 'gap') {
      setOlderFailed(false);
      void catchUp();
      void queryClient.invalidateQueries({ queryKey: messengerKeys.conversation(id) });
      return;
    }
    const fx = e.effect;
    if (fx.catchUp) void catchUp();
    if (fx.refetchSeq !== null) void refetchSeq(fx.refetchSeq);
    if (fx.reload) reload();
  });

  // ── Scrolling ─────────────────────────────────────────────────────────
  const loadOlder = useCallback(async () => {
    const before = lowestSeq(tRef.current.messages);
    if (loadingOlder || !tRef.current.hasOlder || before === null) return;
    setLoadingOlder(true);
    try {
      const ep = epoch.current;
      const page = await messengerApi.messages(id, { beforeSeq: before, limit: PAGE_SIZE });
      if (ep !== epoch.current) return;
      const el = scroller.current;
      const anchor = el?.querySelector<HTMLElement>(`[data-seq="${before}"]`);
      keepFrom.current = el
        ? {
            seq: before,
            offset: anchor ? anchor.offsetTop - el.scrollTop : 0,
            height: anchor ? -1 : el.scrollHeight,
          }
        : null;
      setOlderFailed(false);
      setT((cur) => withOlderPage(cur, page));
    } catch {
      setOlderFailed(true);
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
      // The message that was at the top stays where it was in the view,
      // whatever else landed in the same render (a catch-up at the bottom).
      const keep = keepFrom.current;
      keepFrom.current = null;
      const anchor =
        keep.height < 0 ? el.querySelector<HTMLElement>(`[data-seq="${keep.seq}"]`) : null;
      if (anchor) el.scrollTop = anchor.offsetTop - keep.offset;
      // No anchor to hold on to: keep the distance from the bottom instead.
      else if (keep.height >= 0) el.scrollTop += el.scrollHeight - keep.height;
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
    if (!el || !loaded || !t.hasOlder || loadingOlder || olderFailed) return;
    if (el.scrollHeight <= el.clientHeight + LOAD_OLDER_PX) void loadOlder();
  }, [loaded, t, loadingOlder, loadOlder, olderFailed]);

  // ── The read cursor ───────────────────────────────────────────────────
  // Sent when the newest message is on screen and the tab is visible, at
  // most once per READ_DEBOUNCE_MS, never for my own newest message (my
  // send moved my cursor), never before the first page or behind an error.
  const readSent = useRef(0);
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const myRead = conversation?.me.lastReadSeq ?? 0;
  const myReadRef = useRef(myRead);
  myReadRef.current = myRead;
  const loadErrorRef = useRef(loadError);
  loadErrorRef.current = loadError;
  const sendRead = useCallback(() => {
    readTimer.current = null;
    const seen = readerSeesNewest({
      loaded: loadedRef.current,
      error: loadErrorRef.current,
      visible: typeof document === 'undefined' || document.visibilityState === 'visible',
      atBottom: atBottom.current,
    });
    if (!seen) return;
    const messages = tRef.current.messages;
    const newest = messages.length ? messages[messages.length - 1]! : null;
    const seq = readCursorToSend(
      newest ? newest.seq : null,
      Math.max(myReadRef.current, readSent.current),
      !!newest && newest.authorKind === 'login' && newest.authorId === me,
    );
    if (seq === null) return;
    readSent.current = seq;
    void messengerApi
      .read(id, seq)
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: messengerKeys.list });
        void queryClient.invalidateQueries({ queryKey: messengerKeys.unread });
      })
      .catch((err) => {
        // A refusal (I left, the chat is gone) will not change by retrying;
        // a timeout or the rate limit will.
        const refused =
          err instanceof ApiError &&
          err.status >= 400 &&
          err.status < 500 &&
          err.status !== 408 &&
          err.status !== 429;
        if (!refused) readSent.current = 0;
      });
  }, [id, me, queryClient]);
  const markRead = useCallback(() => {
    if (readTimer.current) return;
    readTimer.current = setTimeout(sendRead, READ_DEBOUNCE_MS);
  }, [sendRead]);
  useEffect(
    () => () => {
      if (readTimer.current) clearTimeout(readTimer.current);
      readTimer.current = null;
    },
    [],
  );

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottom.current = fromBottom < STICK_PX;
    setShowJump(!atBottom.current);
    if (el.scrollTop < LOAD_OLDER_PX) {
      setOlderFailed(false);
      void loadOlder();
    }
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
    async (body: string, mentions: MessengerMention[] = [], clientMsgId = newClientMsgId()) => {
      const line: OutboxLine = {
        clientMsgId,
        body,
        createdAt: new Date().toISOString(),
        state: 'sending',
        mentions,
      };
      scrollToBottom.current = true;
      setT((cur) => withOutbox(cur, line));
      try {
        const out = await messengerApi.send(id, {
          body,
          clientMsgId,
          ...(mentions.length ? { mentions } : {}),
        });
        const top = contiguousTop(tRef.current.messages);
        scrollToBottom.current = true;
        tRef.current = withNewer(tRef.current, [out.message]);
        setT((cur) => withNewer(cur, [out.message]));
        // Someone wrote between the last seq held and mine: fetch it.
        if (out.message.seq > top + 1) void catchUp();
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
    [id, queryClient, catchUp],
  );

  // The New message form's lines wait in the outbox and go out, in order,
  // once the room holds its window, so they land under what is already
  // there (a catch-up before the first page would pull the whole history).
  const firstSent = useRef(false);
  const onFirstSentRef = useRef(onFirstSent);
  onFirstSentRef.current = onFirstSent;
  const firsts = useMemo(
    () => (firstMessages ?? []).filter((f) => f.c === id),
    [firstMessages, id],
  );
  useEffect(() => {
    if (firsts.length === 0 || firstSent.current) return;
    if (!loaded) {
      setT((cur) =>
        firsts.reduce(
          (acc, f) =>
            acc.outbox.some((o) => o.clientMsgId === f.clientMsgId)
              ? acc
              : withOutbox(acc, {
                  clientMsgId: f.clientMsgId,
                  body: f.body,
                  createdAt: new Date().toISOString(),
                  state: 'sending',
                  mentions: f.mentions,
                }),
          cur,
        ),
      );
      return;
    }
    firstSent.current = true;
    onFirstSentRef.current?.(id);
    void (async () => {
      for (const f of firsts) await send(f.body, f.mentions, f.clientMsgId);
    })();
  }, [loaded, firsts, id, send]);

  const lastTyping = useRef<number | null>(null);
  const onTyping = useCallback(() => {
    const now = Date.now();
    if (!shouldSendTyping(lastTyping.current, now)) return;
    lastTyping.current = now;
    void messengerApi.typing(id).catch(() => {});
  }, [id]);

  // ── Message actions ───────────────────────────────────────────────────
  const toast = useToast();
  const [editingSeq, setEditingSeq] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<MessengerMessage | null>(null);
  const failed = (err: unknown, what: string) =>
    toast.error(err instanceof Error ? err.message : what);

  const react = useCallback(
    (seq: number, emoji: string) => {
      void messengerApi
        .react(id, seq, emoji)
        .then(() => refetchSeq(seq))
        .catch((err) => failed(err, 'Could not react'));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `failed` is the toast
    [id, refetchSeq],
  );

  const saveEdit = async (seq: number, body: string) => {
    try {
      const message = await messengerApi.edit(id, seq, body);
      if (refetchPlacement(tRef.current.messages, seq) === 'merge') {
        tRef.current = withNewer(tRef.current, [message]);
        setT((cur) => withNewer(cur, [message]));
      }
      setEditingSeq(null);
    } catch (err) {
      failed(err, 'Could not save the edit');
    }
  };

  const confirmDelete = async () => {
    const m = deleting;
    setDeleting(null);
    if (!m) return;
    try {
      await messengerApi.remove(id, m.seq);
      await refetchSeq(m.seq);
      void queryClient.invalidateQueries({ queryKey: messengerKeys.list });
    } catch (err) {
      failed(err, 'Could not delete the message');
    }
  };

  // The room's own width: below ROOM_WITH_INSPECTOR the inspector lies over
  // the transcript's right edge instead of taking a column (style guide 8:
  // the frame measures itself, not the window).
  const frame = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const roomShown = !!conversation;
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = (w: number) => setNarrow(w < ROOM_WITH_INSPECTOR);
    measure(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => entry && measure(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
    // The frame mounts again when the chat comes back after a failed load.
  }, [roomShown]);
  // ── The inspector and my settings ─────────────────────────────────────
  const [inspectorOpen, setInspectorOpen] = useState(false);
  useEffect(() => setInspectorOpen(readInspectorOpen()), []);
  // A narrow room's inspector lies over the transcript and the composer, so
  // it opens only when asked, is never remembered, and Escape closes it.
  const [overlayOpen, setOverlayOpen] = useState(false);
  useEffect(() => {
    if (!narrow) setOverlayOpen(false);
  }, [narrow]);
  const overlay = useRef<HTMLDivElement>(null);
  const detailsOpen = narrow ? overlayOpen : inspectorOpen;
  const toggleInspector = () => {
    if (narrow) {
      setOverlayOpen((open) => !open);
      return;
    }
    setInspectorOpen((open) => {
      try {
        window.localStorage.setItem(INSPECTOR_KEY, open ? '0' : '1');
      } catch {
        /* a private window keeps it for this visit */
      }
      return !open;
    });
  };
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'chats:inspector',
    panelIds: inspectorOpen && !narrow ? ['room', 'inspector'] : ['room'],
    onlySaveAfterUserInteractions: true,
    storage: typeof window === 'undefined' ? NO_STORAGE : window.localStorage,
  });
  const setting = async (run: () => Promise<unknown>) => {
    try {
      await run();
      void queryClient.invalidateQueries({ queryKey: messengerKeys.conversation(id) });
      void queryClient.invalidateQueries({ queryKey: messengerKeys.list });
    } catch (err) {
      failed(err, 'That did not work');
    }
  };

  // ── Drawing ───────────────────────────────────────────────────────────
  const people = useMemo(
    () => conversation?.participants ?? row?.participants ?? [],
    [conversation?.participants, row?.participants],
  );
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
  const faceOf = useChatFaces();
  const peer = group ? null : (others.find((p) => p.kind === 'login') ?? null);
  /** A message's author in a group: the participant (an author who left
   *  still has a row) and the face they chose. */
  const authorFace = (m: MessengerMessage) => {
    const p = people.find((x) => x.id === m.authorId);
    return faceOf({
      kind: m.authorKind === 'agent' ? 'agent' : 'login',
      id: m.authorId,
      avatar: p?.avatar,
      photoVersion: p?.photoVersion,
    });
  };
  const left = conversation?.me.leftSeq != null;
  const isAdmin = group && !!conversation?.me.admin;
  const muted = conversation?.me.muted ?? row?.muted ?? false;
  const pinned = row?.favourite ?? false;
  const mentionNames = useMemo(() => people.map((p) => p.name), [people]);

  // Say a newly arrived message from someone else, once (the transcript
  // itself is not a live region: an older page would be read out whole).
  const [announce, setAnnounce] = useState('');
  // The highest seq of someone else's message already said (or, at the first
  // page, already there): my own send landing first cannot hide theirs.
  const announced = useRef<number | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const theirs = t.messages.filter(
      (m) => m.authorId !== me && m.authorKind !== 'system' && !m.deletedAt,
    );
    const top = theirs.length ? theirs[theirs.length - 1]!.seq : 0;
    if (announced.current === null) {
      announced.current = top;
      return;
    }
    if (top <= announced.current) return;
    announced.current = top;
    const m = theirs[theirs.length - 1]!;
    setAnnounce(`${m.authorName ?? 'Someone'}: ${m.body.slice(0, 200)}`);
  }, [loaded, t.messages, me]);

  // An edit open on a message that was deleted meanwhile closes.
  useEffect(() => {
    if (editingSeq === null) return;
    if (t.messages.find((m) => m.seq === editingSeq)?.deletedAt) setEditingSeq(null);
  }, [editingSeq, t.messages]);

  // A reader at the bottom stays there when the transcript's width changes.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [roomShown]);
  const inspectorColumn = inspectorOpen && !!conversation && !narrow;
  const inspectorOverlay = overlayOpen && !!conversation && narrow;
  // Focus moves into the overlay as it opens, so Escape reaches it.
  useEffect(() => {
    if (inspectorOverlay) overlay.current?.focus();
  }, [inspectorOverlay]);

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
            face={
              peer
                ? faceOf({
                    kind: 'login',
                    id: peer.id,
                    avatar: peer.avatar,
                    photoVersion: peer.photoVersion,
                  })
                : null
            }
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
        tools={[
          {
            key: 'details',
            label: detailsOpen ? 'Hide details' : 'Details',
            icon: <PanelRight />,
            pressed: detailsOpen,
            onSelect: toggleInspector,
          },
        ]}
        more={[
          ...(left
            ? []
            : [
                {
                  key: 'mute',
                  label: muted ? 'Unmute' : 'Mute',
                  icon: muted ? <Bell /> : <BellOff />,
                  onSelect: () => void setting(() => messengerApi.update(id, { muted: !muted })),
                },
              ]),
          {
            key: 'pin',
            label: pinned ? 'Unpin' : 'Pin',
            icon: pinned ? <PinOff /> : <Pin />,
            onSelect: () => void setting(() => messengerApi.pin('conversation', id, !pinned)),
          },
        ]}
      />
      <div ref={frame} className="relative flex min-h-0 flex-1 flex-col">
        <ResizablePanelGroup
          orientation="horizontal"
          id="chats:inspector"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
          className="min-h-0 flex-1 items-stretch overflow-hidden"
        >
          <ResizablePanel id="room" minSize="360px">
            <div className="flex h-full min-h-0 flex-col">
              <p className="sr-only" aria-live="polite">
                {announce}
              </p>
              {/* No browser scroll anchoring: the place after an older page is kept
          by hand (useLayoutEffect), and anchoring would add its own shift. */}
              <div
                ref={scroller}
                onScroll={onScroll}
                className="relative min-h-0 flex-1 overflow-y-auto scrollbar-thin [overflow-anchor:none]"
                data-testid="chat-transcript"
              >
                {loadingOlder ? (
                  // Out of the flow, so it moves nothing under the reader.
                  <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
                    <Spinner />
                  </div>
                ) : null}
                <div className="flex min-h-full flex-col justify-end gap-1 px-6 py-4">
                  {loadError && !loaded ? (
                    <div className="flex flex-col items-center gap-3 py-6 text-center text-sm text-muted-foreground">
                      <p>{loadError}</p>
                      <Button variant="outline" size="sm" onClick={() => void loadLatest()}>
                        Retry
                      </Button>
                    </div>
                  ) : !loaded ? (
                    <div className="flex justify-center py-6">
                      <Spinner />
                    </div>
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
                          author={
                            // Theirs in a group: the author's face beside the
                            // first bubble of a run, the same gutter under it.
                            group && !it.mine && it.message.authorKind !== 'system' ? (
                              it.showAuthor ? (
                                <ChatAvatar
                                  name={it.message.authorName ?? 'Someone'}
                                  kind={it.message.authorKind === 'agent' ? 'agent' : 'person'}
                                  face={authorFace(it.message)}
                                  size="sm"
                                />
                              ) : null
                            ) : undefined
                          }
                          read={it.mine && readByAll >= it.message.seq}
                          mentionNames={mentionNames}
                          actions={
                            left
                              ? undefined
                              : {
                                  onReact: (emoji) => react(it.message.seq, emoji),
                                  onEdit: it.mine ? () => setEditingSeq(it.message.seq) : undefined,
                                  onDelete:
                                    it.mine || isAdmin ? () => setDeleting(it.message) : undefined,
                                }
                          }
                          editing={
                            editingSeq === it.message.seq ? (
                              <MessageEditor
                                initial={it.message.body}
                                onSave={(body) => void saveEdit(it.message.seq, body)}
                                onCancel={() => setEditingSeq(null)}
                              />
                            ) : undefined
                          }
                        />
                      ) : (
                        <OutboxMessage
                          key={it.key}
                          line={it.line}
                          onRetry={() =>
                            void send(it.line.body, it.line.mentions ?? [], it.line.clientMsgId)
                          }
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
                  <ChatComposer
                    onSend={(body, mentions) => void send(body, mentions)}
                    onTyping={onTyping}
                    people={others}
                  />
                )}
              </div>
            </div>
          </ResizablePanel>
          {inspectorColumn ? <ResizableHandle withHandle /> : null}
          {inspectorColumn && conversation ? (
            <ResizablePanel id="inspector" defaultSize="320px" minSize="260px" maxSize="480px">
              <div className="h-full min-h-0 overflow-y-auto border-l border-border scrollbar-thin">
                <ChatInspector
                  conversation={conversation}
                  title={title}
                  me={me}
                  online={online}
                  pinned={pinned}
                  onLeft={onGone}
                  onCleared={reload}
                />
              </div>
            </ResizablePanel>
          ) : null}
        </ResizablePanelGroup>
        {inspectorOverlay && conversation ? (
          <div
            ref={overlay}
            tabIndex={-1}
            role="region"
            aria-label="Chat details"
            className="absolute inset-y-0 right-0 z-10 w-[min(320px,100%)] overflow-y-auto border-l border-border bg-background shadow-md outline-none scrollbar-thin"
            onKeyDown={(e) => {
              // Not an Escape from a dialog it opened (a portal bubbles here).
              if (e.key !== 'Escape' || e.defaultPrevented) return;
              if (e.currentTarget.contains(e.target as Node)) setOverlayOpen(false);
            }}
          >
            <ChatInspector
              conversation={conversation}
              title={title}
              me={me}
              online={online}
              pinned={pinned}
              onLeft={onGone}
              onCleared={reload}
            />
          </div>
        ) : null}
      </div>
      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this message?</AlertDialogTitle>
            <AlertDialogDescription>
              It is deleted for everyone in the chat and shows as &ldquo;This message was
              deleted&rdquo;.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void confirmDelete()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
