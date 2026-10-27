'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@mantle/web-ui/ui/button';
import { Checkbox } from '@mantle/web-ui/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@mantle/web-ui/ui/field';
import { Input } from '@mantle/web-ui/ui/input';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@mantle/web-ui/ui/tabs';
import { useToast } from '@mantle/web-ui/ui/toast';
import { ItemListEmpty, ItemSearch } from '@/components/item-list/item-list-header';
import { ChatAvatar } from '@/components/messenger/chat-avatar';
import { messengerApi, messengerKeys } from '@/lib/messenger/api';
import { rowAddress } from '@/lib/messenger/format';
import type { MessengerDirectoryEntry } from '@/lib/messenger/dto';

/**
 * New chat: the people I may chat with (GET /api/messenger/directory, the
 * logins that share a workspace with me), online first. A Person opens our
 * direct chat (the brain answers the existing one when there is one); a
 * Group takes a name and its members, and I am its first admin. A group of
 * one, just me, is allowed ("message yourself").
 */
export function NewChatDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens what was picked: a conversation id, or an assistant's
   *  `agent:<id>` address. */
  onCreated: (address: string) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'person' | 'group'>('person');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [members, setMembers] = useState<Set<string>>(new Set());
  const [titleError, setTitleError] = useState<string | null>(null);
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
  // The assistants I may chat with: their thread opens (it is not a
  // messenger chat, nothing is created).
  const assistants = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (directory.data ?? [])
      .filter((e) => e.kind === 'agent')
      .filter((e) => !q || e.name.toLowerCase().includes(q));
  }, [directory.data, query]);

  const reset = () => {
    setQuery('');
    setTitle('');
    setMembers(new Set());
    setTitleError(null);
    setTab('person');
  };
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) reset();
  };

  const done = (id: string) => {
    void queryClient.invalidateQueries({ queryKey: messengerKeys.list });
    close(false);
    onCreated(id);
  };

  const startDirect = async (loginId: string) => {
    setBusy(loginId);
    try {
      const out = await messengerApi.create({ kind: 'direct', participants: [loginId] });
      done(out.conversation.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the chat');
    } finally {
      setBusy(null);
    }
  };

  const createGroup = async () => {
    const name = title.trim();
    if (!name) {
      setTitleError('Give the group a name.');
      return;
    }
    setBusy('group');
    try {
      const out = await messengerApi.create({
        kind: 'group',
        participants: [...members],
        title: name,
      });
      done(out.conversation.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the group');
    } finally {
      setBusy(null);
    }
  };

  const list = (render: (p: MessengerDirectoryEntry) => React.ReactNode) => (
    <div className="-mx-1 max-h-[45vh] min-h-24 overflow-y-auto px-1 scrollbar-thin">
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
            <li key={p.id}>{render(p)}</li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New chat</DialogTitle>
          <DialogDescription>Chat with people who share a workspace with you.</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'person' | 'group')}>
          <TabsList className="w-full">
            <TabsTrigger value="person" className="flex-1">
              Person
            </TabsTrigger>
            <TabsTrigger value="group" className="flex-1">
              Group
            </TabsTrigger>
          </TabsList>
          <TabsContent value="person" className="space-y-3">
            <ItemSearch value={query} onChange={setQuery} placeholder="Search people…" />
            {assistants.length > 0 ? (
              <div className="space-y-1">
                <p className="px-2 text-xs font-medium text-muted-foreground">Assistants</p>
                <ul className="space-y-0.5">
                  {assistants.map((a) => (
                    <li key={a.id}>
                      <RowButton
                        onClick={() => {
                          close(false);
                          onCreated(rowAddress({ kind: 'agent', id: a.id }));
                        }}
                        className="flex w-full items-center gap-3 rounded-md px-2 py-2 hover:bg-foreground/[0.04]"
                      >
                        <ChatAvatar name={a.name} kind="agent" size="sm" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {a.name}
                        </span>
                      </RowButton>
                    </li>
                  ))}
                </ul>
                <p className="px-2 pt-2 text-xs font-medium text-muted-foreground">People</p>
              </div>
            ) : null}
            {list((p) => (
              <RowButton
                onClick={() => void startDirect(p.id)}
                disabled={busy !== null}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 hover:bg-foreground/[0.04]"
              >
                <ChatAvatar name={p.name} online={p.online} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                {busy === p.id ? (
                  <Spinner />
                ) : (
                  <span className="text-xs text-muted-foreground">{p.online ? 'Online' : ''}</span>
                )}
              </RowButton>
            ))}
          </TabsContent>
          <TabsContent value="group">
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void createGroup();
              }}
            >
              <FieldGroup>
                <Field data-invalid={!!titleError || undefined}>
                  <FieldLabel htmlFor="new-group-title">Name</FieldLabel>
                  <Input
                    id="new-group-title"
                    value={title}
                    maxLength={200}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      setTitleError(null);
                    }}
                    aria-invalid={!!titleError || undefined}
                    aria-describedby="new-group-title-error"
                    placeholder="Design crew"
                  />
                  <FieldError id="new-group-title-error">{titleError}</FieldError>
                </Field>
                <Field>
                  <FieldLabel asChild>
                    <span>Members</span>
                  </FieldLabel>
                  <FieldDescription>
                    {members.size === 0
                      ? 'Just you for now: add people here or later.'
                      : `${members.size} chosen, and you.`}
                  </FieldDescription>
                  <div className="space-y-2">
                    <ItemSearch value={query} onChange={setQuery} placeholder="Search people…" />
                    {list((p) => (
                      <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-foreground/[0.04]">
                        <Checkbox
                          checked={members.has(p.id)}
                          onCheckedChange={(on) =>
                            setMembers((cur) => {
                              const next = new Set(cur);
                              if (on) next.add(p.id);
                              else next.delete(p.id);
                              return next;
                            })
                          }
                        />
                        <ChatAvatar name={p.name} online={p.online} size="sm" />
                        <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                      </label>
                    ))}
                  </div>
                </Field>
                <div className="flex justify-end gap-2 border-t border-border pt-4">
                  <Button type="button" variant="outline" onClick={() => close(false)}>
                    Cancel
                  </Button>
                  <SubmitButton pending={busy === 'group'}>Create group</SubmitButton>
                </div>
              </FieldGroup>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
