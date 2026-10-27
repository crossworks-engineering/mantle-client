'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { useToast } from '@mantle/web-ui/ui/toast';
import { ItemListEmpty, ItemSearch } from '@/components/item-list/item-list-header';
import { ChatAvatar } from '@/components/messenger/chat-avatar';
import { apiSend } from '@mantle/web-ui/api-fetch';
import { messengerApi, messengerKeys } from '@/lib/messenger/api';
import type { MessengerCreateRequest, MessengerCreateResponse } from '@/lib/messenger/dto';

/**
 * New chat: the people I may chat with (GET /api/messenger/directory, the
 * logins that share a workspace with me), online first. Picking one opens
 * our direct chat; the brain answers the existing one when there is one.
 */
export function NewChatDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const directory = useQuery({
    queryKey: messengerKeys.directory,
    queryFn: () => messengerApi.directory(),
    enabled: open,
  });
  const people = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (directory.data ?? [])
      .filter((e) => e.kind === 'login')
      .filter((e) => !q || e.name.toLowerCase().includes(q))
      .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  }, [directory.data, query]);

  const start = async (loginId: string) => {
    setBusy(loginId);
    try {
      const body: MessengerCreateRequest = { kind: 'direct', participants: [loginId] };
      const out = await apiSend<MessengerCreateResponse>(
        '/api/messenger/conversations',
        'POST',
        body,
      );
      void queryClient.invalidateQueries({ queryKey: messengerKeys.list });
      onOpenChange(false);
      setQuery('');
      onCreated(out.conversation.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the chat');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New chat</DialogTitle>
          <DialogDescription>Chat with someone who shares a workspace with you.</DialogDescription>
        </DialogHeader>
        <ItemSearch value={query} onChange={setQuery} placeholder="Search people…" />
        <div className="-mx-1 max-h-[55vh] min-h-24 overflow-y-auto px-1 scrollbar-thin">
          {directory.isPending ? (
            <div className="flex justify-center p-6">
              <Spinner />
            </div>
          ) : people.length === 0 ? (
            <ItemListEmpty>
              {query.trim() ? 'Nobody matches' : 'Nobody to chat with yet.'}
            </ItemListEmpty>
          ) : (
            <ul className="space-y-0.5">
              {people.map((p) => (
                <li key={p.id}>
                  <RowButton
                    onClick={() => void start(p.id)}
                    disabled={busy !== null}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-2 hover:bg-foreground/[0.04]"
                  >
                    <ChatAvatar name={p.name} online={p.online} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                    {busy === p.id ? (
                      <Spinner />
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {p.online ? 'Online' : ''}
                      </span>
                    )}
                  </RowButton>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
