'use client';

/**
 * /chats: the messenger (Messenger V1 Phase 2). A two-pane master-detail in
 * the shell: the list of chats on the left (a "Chats" card with New chat and
 * a search), the open chat on the right at its own address (`/chats/<id>`),
 * or a centred empty state while none is open. Live delivery is
 * `MessengerLiveSync` (components/messenger/messenger-live.tsx).
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageSquareText, Plus } from 'lucide-react';
import { ApiError } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { useItemAddress } from '@/components/layout/use-item-address';
import { useZenMode } from '@/components/layout/zen-mode';
import { ItemListEmpty, ItemListHeader } from '@/components/item-list/item-list-header';
import { useListQuery } from '@/components/list-search';
import { useShellWorkspaces } from '@/components/workspaces/use-shell-workspaces';
import { MessengerLiveSync } from '@/components/messenger/messenger-live';
import { messengerApi, messengerKeys } from '@/lib/messenger/api';
import { rowMatches } from '@/lib/messenger/format';
import { ChatRow } from './chat-row';
import { ChatRoom } from './chat-room';
import { NewChatDialog } from './new-chat-dialog';

/** A slow safety net under the stream (which refreshes the list itself). */
const LIST_REFRESH_MS = 60_000;
/** Who is online moves slowly (the brain's two-minute window). */
const DIRECTORY_REFRESH_MS = 60_000;

export function ChatsClient() {
  const { zen } = useZenMode();
  const address = useItemAddress('chats');
  const me = useShellWorkspaces()?.loginId ?? null;
  const { query, setQuery } = useListQuery();
  const [creating, setCreating] = useState(false);

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

  // People chats and groups. Agent threads join the list in M3.
  const rows = useMemo(
    () => (listQuery.data ?? []).filter((r) => r.kind !== 'agent'),
    [listQuery.data],
  );
  const shown = useMemo(() => rows.filter((r) => rowMatches(r, query)), [rows, query]);
  const selectedId = address.id;
  const selectedRow = rows.find((r) => r.id === selectedId) ?? null;

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
    <div className="flex h-full flex-col p-3">
      <section
        aria-label="Chats"
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card/70 shadow-sm"
      >
        <ItemListHeader
          heading={
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Chats</h2>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="New chat"
                title="New chat"
                onClick={() => setCreating(true)}
              >
                <Plus />
              </Button>
            </div>
          }
          search={query}
          onSearch={setQuery}
          placeholder="Search chats…"
        />
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin" data-testid="chat-list">
          {listQuery.isPending ? (
            <div className="flex justify-center p-6">
              <Spinner />
            </div>
          ) : shown.length === 0 ? (
            <div className="p-3">
              <ItemListEmpty>
                {query.trim() ? 'No chats match' : 'No chats yet. Start one with New chat.'}
              </ItemListEmpty>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {shown.map((row) => (
                <li key={`${row.kind}:${row.id}`}>
                  <ChatRow
                    row={row}
                    me={me}
                    online={online}
                    selected={row.id === selectedId}
                    onOpen={() => address.open(row.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );

  return (
    <>
      <MessengerLiveSync />
      <NewChatDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(id) => address.open(id)}
      />
      <MasterDetail
        id="chats"
        detailFills
        listCollapsed={zen}
        defaultListSize="380px"
        list={list}
        detail={
          selectedId ? (
            <ChatRoom
              key={selectedId}
              id={selectedId}
              row={selectedRow}
              me={me}
              online={online}
              onGone={address.close}
            />
          ) : (
            <NoChatSelected onStart={() => setCreating(true)} />
          )
        }
      />
    </>
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
