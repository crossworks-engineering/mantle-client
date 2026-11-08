'use client';

/**
 * The Chats window (Bubble Chat phase 5, plan page e3d1b641): the dock's
 * panel holds the messenger, like a phone. Two views: the list (people,
 * groups and agents, the Chats screen's own list), then one chat with a
 * way back. The parts are the Chats screen's own: `ChatList`, `ChatRoom`,
 * `NewChatPane` and the assistant thread. Nothing here reads or writes a
 * chat by itself, so the window shows and does only what the login may by
 * hand on the screen.
 *
 * What it shows lives in the dock (`windowView`), so a bubble or ⌘I can
 * open it on a chat, and a reload comes back to it.
 *
 * The agent thread stays mounted once opened (hidden while another view
 * shows), as it was in the old panel: its draft, scroll and a live reply
 * survive a trip to the list. A room unmounts; its draft is kept in memory
 * by chat (lib/messenger/drafts.ts).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { skipToken, useQuery } from '@tanstack/react-query';
import { ChevronLeft, MessagesSquare, Minus, Sparkles, SquareArrowOutUpRight } from 'lucide-react';
import { ApiError } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { useToast } from '@mantle/web-ui/ui/toast';
import { cn } from '@mantle/web-ui/lib/utils';
import { ItemHeader, type HeaderTool } from '@/components/layout/item-header';
import { ChatList, useChatListData } from '@/app/(app)/chats/chat-list';
import { ChatRoom, type FirstMessage } from '@/app/(app)/chats/chat-room';
import { NewChatPane } from '@/app/(app)/chats/new-chat-pane';
import { AssistantThreadClient } from '@/app/(app)/assistant/assistant-thread-client';
import { SHAPE_ICONS } from '@/app/(app)/assistant/assistant-header-controls';
import { switchableShapes } from '@/app/(app)/assistant/assistant-shapes';
import type { MessengerListRow } from '@/lib/messenger/dto';
import { agentIdOf } from '@/lib/messenger/format';
import { useDockActions, useDockLayout, useDockSession } from './assistant-dock';
import { LIST_VIEW, othersUnread, type WindowView } from './window-view';

const AGENT_VIEW: WindowView = { kind: 'agent' };

/** The shapes only differ from lg up (below lg every shape is the overlay). */
const WIDE = '(min-width: 64rem)';

function useWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

export function WindowChats() {
  const { windowView, display, panel } = useDockLayout();
  const open = panel === 'open';
  const { setWindowView, setActiveAgentSlug, minimize, setDisplay, startPopoutMove, popoutElRef } =
    useDockActions();
  const { activeAgentSlug } = useDockSession();
  const data = useChatListData(open);
  const toast = useToast();
  const { rows, directory, faceOf, me, online } = data;
  const router = useRouter();
  const wide = useWide();
  const [query, setQuery] = useState('');
  const newButton = useRef<HTMLButtonElement>(null);
  // The first lines typed in New chat, until the room has sent them.
  const [firstMessages, setFirstMessages] = useState<ReadonlyMap<string, readonly FirstMessage[]>>(
    () => new Map(),
  );
  const firstSent = useCallback(
    (c: string) =>
      setFirstMessages((cur) => {
        if (!cur.has(c)) return cur;
        const next = new Map(cur);
        next.delete(c);
        return next;
      }),
    [],
  );

  // A brain without the messenger (its list answers 404) has no list to
  // show: the window is the assistant's thread, as before.
  // The dock holds it too, so the reply dot and the question alarm see the
  // thread on screen.
  const noMessenger =
    data.listQuery.error instanceof ApiError && data.listQuery.error.status === 404;
  useEffect(() => {
    if (noMessenger && windowView.kind !== 'agent') setWindowView(AGENT_VIEW);
  }, [noMessenger, windowView.kind, setWindowView]);
  const view: WindowView = noMessenger ? AGENT_VIEW : windowView;
  const [agentMounted, setAgentMounted] = useState(view.kind === 'agent');
  const [agentKey, setAgentKey] = useState(0);
  useEffect(() => {
    if (view.kind === 'agent') setAgentMounted(true);
  }, [view.kind]);
  // New chat is a view of its own, so a line in the chat left behind is not
  // taken as on screen (components/messenger/messenger-shell.tsx).
  const composing = view.kind === 'new';
  // A row or the back button unmounts or hides as the view changes: the
  // focus comes back to the window (so Escape still minimises it) when it
  // fell to the page body or sits in a hidden part. Focus on the screen
  // beside the window stays where it is.
  useEffect(() => {
    const el = popoutElRef.current;
    if (!open || !el) return;
    const at = document.activeElement;
    const lost =
      !at ||
      at === document.body ||
      (el.contains(at) && at !== el && at instanceof HTMLElement && !at.offsetParent);
    if (lost) el.focus();
  }, [view, open, popoutElRef]);

  const toList = useCallback(() => setWindowView(LIST_VIEW), [setWindowView]);
  const openAgent = (slug: string) => {
    setActiveAgentSlug(slug);
    setWindowView({ kind: 'agent' });
  };
  const openRow = (row: MessengerListRow) => {
    if (row.kind === 'agent') {
      if (row.agentSlug) openAgent(row.agentSlug);
      else toast.error('This assistant is not available.');
    } else {
      setWindowView({ kind: 'chat', id: row.id });
    }
  };
  /** New chat hands back an address: an agent's, or a conversation's. */
  const openAddress = (to: string) => {
    const agentId = agentIdOf(to);
    if (!agentId) return setWindowView({ kind: 'chat', id: to });
    const slug =
      rows.find((r) => r.kind === 'agent' && r.id === agentId)?.agentSlug ??
      (directory.data ?? []).find((e) => e.id === agentId)?.slug;
    if (!slug) return toast.error('This assistant is not available.');
    // New chat hands its typed line to the thread's composer, which reads it
    // when it mounts: mount it fresh, as /chats does (AgentThread's key).
    setAgentKey((k) => k + 1);
    openAgent(slug);
  };

  // The agent the thread shows: the dock's pick, or before any pick the
  // brain's default, as the thread's own query resolved it (a cache read).
  const threadAgent = useQuery<{ agent?: { slug: string } | null }>({
    queryKey: ['assistant', 'thread', activeAgentSlug ?? ''],
    queryFn: skipToken,
  }).data?.agent?.slug;
  const shownAgentSlug = activeAgentSlug ?? threadAgent;
  const isCurrent = useMemo(() => {
    if (view.kind === 'chat')
      return (r: MessengerListRow) => r.kind !== 'agent' && r.id === view.id;
    if (view.kind === 'agent')
      return (r: MessengerListRow) => r.kind === 'agent' && r.agentSlug === shownAgentSlug;
    return () => false;
  }, [view, shownAgentSlug]);
  const others = othersUnread(rows, isCurrent);

  // The window's own buttons: the shapes it can switch to (wide screens
  // only), then Minimise. Header tools, so they fold into More as it narrows.
  const windowTools: HeaderTool[] = [
    ...(wide ? switchableShapes(display) : []).map((shape) => {
      const Icon = SHAPE_ICONS[shape.value];
      return {
        key: `shape-${shape.value}`,
        label: shape.title,
        icon: <Icon />,
        onSelect: () => setDisplay(shape.value),
      };
    }),
    { key: 'minimise', label: 'Minimise (Esc)', icon: <Minus />, onSelect: minimize },
  ];
  const dragHeader = display === 'popout' ? startPopoutMove : undefined;
  const back = noMessenger ? null : <WindowBack others={others} onBack={toList} />;

  let body: React.ReactNode = null;
  if (composing) {
    body = (
      <NewChatPane
        directory={directory.data ?? null}
        directoryError={directory.isError}
        faceOf={faceOf}
        me={me}
        onOpen={openAddress}
        onCreated={(c, first) => {
          if (first) {
            setFirstMessages((cur) =>
              new Map(cur).set(c, [...(cur.get(c) ?? []), { c, ...first }]),
            );
          }
          openAddress(c);
        }}
        windowBack={back}
        onCancel={() => {
          toList();
          requestAnimationFrame(() => newButton.current?.focus());
        }}
      />
    );
  } else if (view.kind === 'list') {
    body = (
      <div className="flex h-full min-h-0 flex-col">
        <div
          onPointerDown={dragHeader}
          className={cn(dragHeader && 'cursor-grab select-none active:cursor-grabbing')}
        >
          <ItemHeader
            title="Chats"
            visual={<MessagesSquare className="size-4 text-muted-foreground" aria-hidden />}
            focus={false}
            tools={windowTools}
          />
        </div>
        {/* The brain lists an agent's thread once it has a line: before that,
            one way to the assistant (the dock's own, or the brain's default). */}
        {!data.listQuery.isPending && !rows.some((r) => r.kind === 'agent') ? (
          <div className="border-b border-border p-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setWindowView(AGENT_VIEW)}
            >
              <Sparkles aria-hidden />
              Ask the assistant
            </Button>
          </div>
        ) : null}
        <div className="min-h-0 flex-1">
          <ChatList
            ref={newButton}
            data={data}
            query={query}
            onQuery={setQuery}
            onNew={() => setWindowView({ kind: 'new' })}
            selected={null}
            onOpen={openRow}
          />
        </div>
      </div>
    );
  } else if (view.kind === 'chat' && open) {
    // Only while the window is open: a minimised room would mark new lines
    // read that nobody saw (its draft waits in lib/messenger/drafts.ts).
    const id = view.id;
    body = (
      <ChatRoom
        key={id}
        id={id}
        row={rows.find((r) => r.kind !== 'agent' && r.id === id) ?? null}
        me={me}
        online={online}
        firstMessages={firstMessages.get(id)}
        onFirstSent={firstSent}
        onGone={toList}
        inWindow={{
          back,
          onHeaderPointerDown: dragHeader,
          tools: [
            {
              key: 'open-in-chats',
              label: 'Open in Chats',
              icon: <SquareArrowOutUpRight />,
              onSelect: () => {
                // The window goes back to its list, so the chat is not open
                // twice; its draft goes with it (lib/messenger/drafts.ts).
                setWindowView(LIST_VIEW);
                router.push(`/chats/${encodeURIComponent(id)}`);
              },
            },
            ...windowTools,
          ],
        }}
      />
    );
  }

  return (
    <div className="relative h-full min-h-0" data-testid="window-chats" data-view={view.kind}>
      {body}
      {agentMounted ? (
        <div
          className={cn('h-full min-h-0', view.kind !== 'agent' && 'hidden')}
          data-testid="window-agent-thread"
        >
          <AssistantThreadClient
            key={agentKey}
            slugHint={activeAgentSlug}
            back={back}
            shown={view.kind === 'agent'}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Back to the list, with the unread lines of the other chats on it, so a
 *  line elsewhere is seen from inside a chat (plan section 5, D5). */
function WindowBack({ others, onBack }: { others: number; onBack: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="relative shrink-0"
      onClick={onBack}
      aria-label={others > 0 ? `Back to chats, ${others} unread` : 'Back to chats'}
      title="Back to chats"
      data-testid="window-back"
    >
      <ChevronLeft aria-hidden />
      {others > 0 ? (
        <span
          // A new count restarts one short pulse (two beats). Reduced motion
          // clamps it (app/globals.css).
          key={others}
          className="animate-[pulse_1s_ease-in-out_2] absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-foreground"
          aria-hidden
          data-testid="window-back-count"
        >
          {others > 99 ? '99+' : others}
        </span>
      ) : null}
    </Button>
  );
}
