'use client';

/**
 * /chats: the messenger (Messenger V1 Phase 2). A two-pane master-detail in
 * the shell: the list of chats on the left (the item tree's column: the
 * search and New on one row, then the rows, edge to edge), the open chat on
 * the right at its own address (`/chats/<id>`), the New message form in its
 * place, or a centred empty state while none is open. Live delivery is
 * `MessengerLiveSync`, mounted once by the shell (components/messenger/
 * messenger-shell.tsx).
 *
 * An assistant thread is a row of the same list (kind `agent`); it opens
 * at `/chats/agent:<agent id>` as the assistant's own thread, behind a
 * dynamic import so the editor bundle stays off every other route.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageSquareText, Plus } from 'lucide-react';
import { ApiError } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { useItemAddress } from '@/components/layout/use-item-address';
import { useZenMode } from '@/components/layout/zen-mode';
import { useListQuery } from '@/components/list-search';
import { useShellWorkspaces } from '@/components/workspaces/use-shell-workspaces';
import { messengerApi, messengerKeys } from '@/lib/messenger/api';
import { rowMatches } from '@/lib/messenger/format';
import { ChatRow } from './chat-row';
import { AgentThread } from './agent-thread';
import { agentIdOf, rowAddress } from '@/lib/messenger/format';
import { ChatRoom, type FirstMessage } from './chat-room';
import { ColumnSearch } from './column-search';
import { NewChatPane } from './new-chat-pane';
import { useChatFaces } from '@/components/messenger/chat-faces';

/** A slow safety net under the stream (which refreshes the list itself). */
const LIST_REFRESH_MS = 60_000;
/** Who is online moves slowly (the brain's two-minute window). */
const DIRECTORY_REFRESH_MS = 60_000;

export function ChatsClient() {
  const { zen } = useZenMode();
  const address = useItemAddress('chats');
  const me = useShellWorkspaces()?.loginId ?? null;
  const { query, setQuery } = useListQuery();
  // The New message form fills the chat pane (no dialog); opening a chat
  // from anywhere (a row, a toast, the address) closes it.
  const [composing, setComposing] = useState(false);
  const startNew = () => setComposing(true);
  // Cancel hands the focus back to New (the empty state's button is gone
  // by then).
  const newButton = useRef<HTMLButtonElement>(null);
  const cancelNew = () => {
    setComposing(false);
    requestAnimationFrame(() => newButton.current?.focus());
  };
  // The first lines typed in the form, by chat, until each chat's room has
  // sent its own through the outbox (clock, Retry, the same clientMsgId).
  // Kept here, so a room left before its first page still finds it later.
  const [firstMessages, setFirstMessages] = useState<ReadonlyMap<string, FirstMessage>>(
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
  const faceOf = useChatFaces();

  const listQuery = useQuery({
    queryKey: messengerKeys.list,
    queryFn: messengerApi.list,
    refetchInterval: LIST_REFRESH_MS,
  });
  const directory = useQuery({
    queryKey: messengerKeys.directory,
    queryFn: () => messengerApi.directory(),
    refetchInterval: DIRECTORY_REFRESH_MS,
  });
  const online = useMemo(
    () => new Set((directory.data ?? []).filter((e) => e.online).map((e) => e.id)),
    [directory.data],
  );

  // People chats, groups and assistant threads, in the brain's order.
  const rows = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const shown = useMemo(() => rows.filter((r) => rowMatches(r, query)), [rows, query]);
  const selectedId = address.id;
  // Opening a chat closes the form once the address has moved, so the old
  // room never flashes in between.
  useEffect(() => setComposing(false), [selectedId]);
  /** Go to a chat from the form or the list; the address change closes the
   *  form, or this does when the chat is the one already in the address. */
  const go = (to: string) => {
    if (to === selectedId) setComposing(false);
    address.open(to);
  };
  const selectedRow = rows.find((r) => rowAddress(r) === selectedId) ?? null;
  const agentId = agentIdOf(selectedId);
  // An assistant opened from New message has no row until its thread has a
  // message: its slug comes from the directory then.
  const agentSlug =
    selectedRow?.agentSlug ??
    (agentId ? (directory.data ?? []).find((e) => e.id === agentId)?.slug : undefined) ??
    null;

  if (listQuery.isError && !listQuery.data) {
    const missing = listQuery.error instanceof ApiError && listQuery.error.status === 404;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm">
        <p className="text-muted-foreground">
          {missing
            ? 'This brain has no chats yet. It needs a newer version of MantleOS.'
            : listQuery.error instanceof Error
              ? listQuery.error.message
              : 'Failed to load the chats.'}
        </p>
        {missing ? null : (
          <Button variant="outline" size="sm" onClick={() => listQuery.refetch()}>
            Retry
          </Button>
        )}
      </div>
    );
  }

  const list = (
    <aside aria-label="Chats" className="flex h-full min-h-0 flex-col bg-muted/20">
      <div className="flex items-center gap-1.5 border-b border-border p-2">
        <ColumnSearch
          value={query}
          onChange={setQuery}
          placeholder="Search chats…"
          label="Search chats"
        />
        <Button
          ref={newButton}
          size="icon-sm"
          onClick={startNew}
          aria-label="New chat"
          title="New chat"
        >
          <Plus aria-hidden />
        </Button>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-2 py-1"
        data-testid="chat-list"
      >
        {listQuery.isPending ? (
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        ) : shown.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            {query.trim() ? 'No chats match' : 'No chats yet. Start one with New chat.'}
          </p>
        ) : (
          <ul className="space-y-px">
            {shown.map((row) => (
              <li key={`${row.kind}:${row.id}`}>
                <ChatRow
                  row={row}
                  me={me}
                  online={online}
                  selected={!composing && rowAddress(row) === selectedId}
                  faceOf={faceOf}
                  onOpen={() => go(rowAddress(row))}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );

  return (
    <MasterDetail
      id="chats"
      detailFills
      listCollapsed={zen}
      defaultListSize="380px"
      list={list}
      detail={
        composing ? (
          <NewChatPane
            directory={directory.data ?? null}
            directoryError={directory.isError}
            faceOf={faceOf}
            me={me}
            onOpen={go}
            onCreated={(c, first) => {
              if (first) setFirstMessages((cur) => new Map(cur).set(c, { c, ...first }));
              go(c);
            }}
            onCancel={cancelNew}
          />
        ) : agentId ? (
          agentSlug ? (
            <AgentThread key={agentId} slug={agentSlug} />
          ) : listQuery.isPending || directory.isPending ? (
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
              This assistant is not available.
            </div>
          )
        ) : selectedId ? (
          <ChatRoom
            key={selectedId}
            id={selectedId}
            row={selectedRow}
            me={me}
            online={online}
            firstMessage={firstMessages.get(selectedId) ?? null}
            onFirstSent={firstSent}
            onGone={address.close}
          />
        ) : (
          <NoChatSelected onStart={startNew} />
        )
      }
    />
  );
}

function NoChatSelected({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <span className="mb-2 inline-flex size-10 items-center justify-center rounded-lg border border-border bg-card/70">
        <MessageSquareText className="size-5 text-muted-foreground" aria-hidden />
      </span>
      <h2 className="text-base font-semibold">No chat selected</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Select a conversation from the list to read and reply, or start a new chat.
      </p>
      <Button className="mt-3" size="sm" onClick={onStart}>
        Start new chat
      </Button>
    </div>
  );
}
