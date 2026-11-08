'use client';

/**
 * The list of chats: people, groups and assistant threads in the brain's
 * order, with the search and New on one row above them. ONE list for the
 * Chats screen and the Chats window (Bubble Chat phase 5), so the two never
 * drift: the same rows, faces, unread, pins and highlight.
 *
 * `useChatListData` holds the queries both read: the one list entry, the
 * directory (who is online, an assistant's slug before its first message)
 * and the faces. React Query shares each entry, so two lists on one page
 * make one request each.
 */

import { forwardRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { useShellWorkspaces } from '@/components/workspaces/use-shell-workspaces';
import { useChatFaces } from '@/components/messenger/chat-faces';
import { messengerApi, messengerKeys } from '@/lib/messenger/api';
import type { MessengerListRow } from '@/lib/messenger/dto';
import { rowAddress, rowMatches } from '@/lib/messenger/format';
import { ChatRow } from './chat-row';
import { ColumnSearch } from './column-search';

/** A slow safety net under the stream (which refreshes the list itself). */
const LIST_REFRESH_MS = 60_000;
/** Who is online moves slowly (the brain's two-minute window). */
const DIRECTORY_REFRESH_MS = 60_000;

/** `active` false (a minimised Chats window): no polling. The cached list
 *  still answers. */
export function useChatListData(active = true) {
  const me = useShellWorkspaces()?.loginId ?? null;
  const faceOf = useChatFaces();
  const listQuery = useQuery({
    queryKey: messengerKeys.list,
    queryFn: messengerApi.list,
    // A brain without the messenger answers 404: no polling after that.
    refetchInterval: (q) =>
      (q.state.error as { status?: number } | null)?.status === 404 ? false : LIST_REFRESH_MS,
    retry: (n, err) => (err as { status?: number } | null)?.status !== 404 && n < 2,
    enabled: active,
  });
  const directory = useQuery({
    queryKey: messengerKeys.directory,
    queryFn: () => messengerApi.directory(),
    refetchInterval: DIRECTORY_REFRESH_MS,
    enabled: active,
  });
  const online = useMemo(
    () => new Set((directory.data ?? []).filter((e) => e.online).map((e) => e.id)),
    [directory.data],
  );
  const rows = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  return { me, faceOf, listQuery, directory, online, rows };
}

export type ChatListData = ReturnType<typeof useChatListData>;

export const ChatList = forwardRef<
  HTMLButtonElement,
  {
    data: ChatListData;
    query: string;
    onQuery: (q: string) => void;
    onNew: () => void;
    /** The address of the open chat (`rowAddress`), or null. */
    selected: string | null;
    onOpen: (row: MessengerListRow) => void;
  }
>(function ChatList({ data, query, onQuery, onNew, selected, onOpen }, newButton) {
  const { me, faceOf, listQuery, online, rows } = data;
  const shown = useMemo(() => rows.filter((r) => rowMatches(r, query)), [rows, query]);
  return (
    <aside aria-label="Chats" className="flex h-full min-h-0 flex-col bg-muted/20">
      <div className="flex items-center gap-1.5 border-b border-border p-2">
        <ColumnSearch
          value={query}
          onChange={onQuery}
          placeholder="Search chats…"
          label="Search chats"
        />
        <Button
          ref={newButton}
          size="icon-sm"
          onClick={onNew}
          aria-label="New chat"
          title="New chat"
        >
          <Plus aria-hidden />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-2" data-testid="chat-list">
        {listQuery.isError && !listQuery.data ? (
          <div className="flex flex-col items-center gap-3 px-2 py-6 text-center text-sm">
            <p className="text-muted-foreground">Could not load the chats.</p>
            <Button variant="outline" size="sm" onClick={() => listQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : listQuery.isPending ? (
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        ) : shown.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            {query.trim() ? 'No chats match' : 'No chats yet. Start one with New chat.'}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {shown.map((row) => (
              <li key={`${row.kind}:${row.id}`}>
                <ChatRow
                  row={row}
                  me={me}
                  online={online}
                  selected={rowAddress(row) === selected}
                  faceOf={faceOf}
                  onOpen={() => onOpen(row)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
});
