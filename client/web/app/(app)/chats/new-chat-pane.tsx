'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, SquarePen, Users, X } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { Checkbox } from '@mantle/web-ui/ui/checkbox';
import { Field, FieldError, FieldLabel } from '@mantle/web-ui/ui/field';
import { Input } from '@mantle/web-ui/ui/input';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@mantle/web-ui/ui/toggle-group';
import { useToast } from '@mantle/web-ui/ui/toast';
import { cn } from '@mantle/web-ui/lib/utils';
import { ItemHeader } from '@/components/layout/item-header';
import { ChatAvatar } from '@/components/messenger/chat-avatar';
import { messengerApi, messengerKeys } from '@/lib/messenger/api';
import type { MessengerDirectoryEntry, MessengerMention } from '@/lib/messenger/dto';
import type { ChatFace, FaceOf } from '@/lib/messenger/faces';
import { rowAddress } from '@/lib/messenger/format';
import { newClientMsgId } from '@/lib/messenger/transcript';
import { ChatComposer } from './chat-composer';
import { ColumnSearch } from './column-search';

type Filter = 'all' | 'people' | 'agents' | 'groups';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'people', label: 'People' },
  { id: 'agents', label: 'Agents' },
  { id: 'groups', label: 'Groups' },
];

/**
 * New message, in the chat pane where the transcript goes (no dialog): the
 * filter (All, People, Agents, Groups), a search, the pick list, and the
 * composer under it, so the first message is written and sent in one go.
 *
 * - A person: picked as the recipient ("To"); Send makes our direct chat (the
 *   brain answers the existing one) and the room sends the line through its
 *   outbox. Open chat goes there without a message.
 * - An agent: its thread opens at once. It is the assistant's own thread, not
 *   a messenger chat, so it takes the first line in its own composer.
 * - Groups: New group, a name and its members; Send creates it with the
 *   line, Create group without one. I am its first admin; a group of one
 *   ("message yourself") is allowed.
 */
export function NewChatPane({
  directory,
  directoryError,
  faceOf,
  me,
  onOpen,
  onCreated,
  onCancel,
}: {
  /** null while it loads. */
  directory: MessengerDirectoryEntry[] | null;
  directoryError: boolean;
  faceOf: (who: FaceOf) => ChatFace;
  me: string | null;
  /** Opens an address without creating anything (an agent's thread). */
  onOpen: (address: string) => void;
  /** The chat exists; the room sends `first` once it has its window. */
  onCreated: (
    conversationId: string,
    first: { body: string; mentions: MessengerMention[]; clientMsgId: string } | null,
  ) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [to, setTo] = useState<MessengerDirectoryEntry | null>(null);
  const [title, setTitle] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [members, setMembers] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const q = query.trim().toLowerCase();
  const matches = (e: MessengerDirectoryEntry) => !q || e.name.toLowerCase().includes(q);
  const people = useMemo(
    () =>
      (directory ?? [])
        .filter((e) => e.kind === 'login' && e.id !== me)
        .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)),
    [directory, me],
  );
  const agents = useMemo(
    () =>
      (directory ?? [])
        .filter((e) => e.kind === 'agent')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [directory],
  );
  const shownPeople = people.filter(matches);
  const shownAgents = agents.filter(matches);
  const grouping = filter === 'groups';

  const face = (e: MessengerDirectoryEntry) =>
    faceOf({
      kind: e.kind,
      id: e.id,
      avatar: e.avatar,
      photoVersion: e.photoVersion,
      slug: e.slug,
    });

  /** Make the chat, then hand the line to its room. false keeps the text. */
  const create = async (line: { body: string; mentions: MessengerMention[] } | null) => {
    if (busy) return false;
    let request: Parameters<typeof messengerApi.create>[0];
    if (grouping) {
      const name = title.trim();
      if (!name) {
        setTitleError('Give the group a name.');
        return false;
      }
      request = { kind: 'group', participants: [...members], title: name };
    } else {
      if (!to) return false;
      request = { kind: 'direct', participants: [to.id] };
    }
    setBusy(true);
    try {
      const out = await messengerApi.create(request);
      void queryClient.invalidateQueries({ queryKey: messengerKeys.list });
      onCreated(out.conversation.id, line ? { ...line, clientMsgId: newClientMsgId() } : null);
      return true;
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : grouping
            ? 'Could not create the group'
            : 'Could not start the chat',
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const pickRow = (e: MessengerDirectoryEntry) => {
    if (e.kind === 'agent') {
      onOpen(rowAddress({ kind: 'agent', id: e.id }));
      return;
    }
    setTo((cur) => (cur?.id === e.id ? null : e));
    requestAnimationFrame(() => document.getElementById('new-chat-text')?.focus());
  };

  const entryRow = (e: MessengerDirectoryEntry) => {
    const chosen = to?.id === e.id;
    return (
      <li key={`${e.kind}:${e.id}`}>
        <RowButton
          onClick={() => pickRow(e)}
          aria-pressed={e.kind === 'login' ? chosen : undefined}
          className={cn(
            'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors',
            chosen ? 'bg-accent text-accent-foreground' : 'hover:bg-foreground/[0.06]',
          )}
        >
          <ChatAvatar
            name={e.name}
            kind={e.kind === 'agent' ? 'agent' : 'person'}
            face={face(e)}
            online={e.kind === 'login' && e.online}
            size="sm"
          />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{e.name}</span>
          {chosen ? (
            <Check className="size-4 shrink-0" aria-hidden />
          ) : e.kind === 'login' && e.online ? (
            <span className="text-xs text-success-ink">Online</span>
          ) : e.kind === 'agent' ? (
            <span className="text-xs text-muted-foreground">Assistant</span>
          ) : null}
        </RowButton>
      </li>
    );
  };

  const section = (label: string, entries: MessengerDirectoryEntry[]) =>
    entries.length > 0 ? (
      <section aria-label={label} className="space-y-1">
        {filter === 'all' ? (
          <h3 className="px-2 pt-2 text-xs font-medium text-muted-foreground">{label}</h3>
        ) : null}
        <ul className="space-y-px">{entries.map(entryRow)}</ul>
      </section>
    ) : null;

  const pickList =
    directory === null ? (
      directoryError ? (
        <p className="p-6 text-center text-sm text-muted-foreground">
          Could not load who you can chat with.
        </p>
      ) : (
        <div className="flex justify-center p-6">
          <Spinner />
        </div>
      )
    ) : (
      <>
        {filter === 'all' && !q ? (
          <RowButton
            onClick={() => setFilter('groups')}
            className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-foreground/[0.06]"
          >
            <ChatAvatar name="New group" kind="group" size="sm" />
            <span className="text-sm font-medium">New group</span>
          </RowButton>
        ) : null}
        {filter !== 'people' ? section('Agents', shownAgents) : null}
        {filter !== 'agents' ? section('People', shownPeople) : null}
        {(filter === 'agents'
          ? shownAgents
          : filter === 'people'
            ? shownPeople
            : [...shownAgents, ...shownPeople]
        ).length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            {q
              ? 'Nobody matches'
              : filter === 'agents'
                ? 'No assistants to chat with.'
                : 'Nobody to chat with yet.'}
          </p>
        ) : null}
      </>
    );

  const groupForm = (
    <div className="space-y-4 px-2 py-2">
      <Field data-invalid={!!titleError || undefined}>
        <FieldLabel htmlFor="new-group-title">Group name</FieldLabel>
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
      <section aria-labelledby="new-group-members" className="space-y-1">
        <h3 id="new-group-members" className="text-sm font-medium">
          Members
          <span className="ml-2 font-normal text-muted-foreground">
            {members.size === 0 ? 'Just you for now' : `${members.size} and you`}
          </span>
        </h3>
        {directory === null ? (
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        ) : shownPeople.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            {q ? 'Nobody matches' : 'Nobody else to add yet.'}
          </p>
        ) : (
          <ul className="space-y-px">
            {shownPeople.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-foreground/[0.06]">
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
                  <ChatAvatar name={p.name} face={face(p)} online={p.online} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );

  const ready = grouping ? !!title.trim() : !!to;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="new-chat">
      <ItemHeader
        sticky
        section="Chats"
        visual={<SquarePen className="size-4" aria-hidden />}
        title="New message"
        tools={[{ key: 'cancel', label: 'Cancel', icon: <X />, onSelect: onCancel }]}
      />
      <div className="flex flex-col gap-2 border-b border-border px-6 py-3">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={filter}
          onValueChange={(v) => {
            if (!v) return;
            setFilter(v as Filter);
          }}
          aria-label="Who to show"
          className="flex w-full max-w-md"
        >
          {FILTERS.map((f) => (
            <ToggleGroupItem key={f.id} value={f.id} className="h-8 flex-auto px-2 text-xs">
              {f.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ColumnSearch
          value={query}
          onChange={setQuery}
          placeholder={grouping ? 'Search people to add…' : 'Search people and agents…'}
          label={grouping ? 'Search people to add' : 'Search people and agents'}
          autoFocus
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-4 py-2">
        {grouping ? groupForm : pickList}
      </div>
      <div className="space-y-2 px-6 pb-4 pt-2">
        <div className="flex min-h-8 items-center gap-2 text-sm">
          {grouping ? (
            <>
              <span className="text-muted-foreground">To</span>
              <span className="inline-flex min-w-0 items-center gap-1.5 font-medium">
                <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{title.trim() || 'The new group'}</span>
              </span>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                disabled={busy}
                onClick={() => void create(null)}
              >
                Create group
              </Button>
            </>
          ) : to ? (
            <>
              <span className="text-muted-foreground">To</span>
              <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border py-0.5 pl-0.5 pr-1 font-medium">
                <ChatAvatar name={to.name} face={face(to)} size="xs" />
                <span className="truncate">{to.name}</span>
                <Button
                  variant="ghost"
                  size="icon-2xs"
                  aria-label={`Remove ${to.name}`}
                  onClick={() => setTo(null)}
                >
                  <X aria-hidden />
                </Button>
              </span>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                disabled={busy}
                onClick={() => void create(null)}
              >
                Open chat
              </Button>
            </>
          ) : (
            <span className="text-muted-foreground">Pick who to message.</span>
          )}
        </div>
        <ChatComposer
          id="new-chat-text"
          canSend={ready && !busy}
          placeholder={
            grouping
              ? 'The group’s first message…'
              : to
                ? `Message ${to.name}…`
                : 'Type the first message…'
          }
          onSend={(body, mentions) => create({ body, mentions })}
        />
      </div>
    </div>
  );
}
