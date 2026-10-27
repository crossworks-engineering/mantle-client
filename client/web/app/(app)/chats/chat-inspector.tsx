'use client';

/**
 * A chat's details, as an inspector beside the transcript (style guide 8,
 * "A detail pane with an inspector"): everything ABOUT the chat, never its
 * messages. The title (an admin renames a group), the people with their
 * admin marks (an admin adds and removes them), my mute and my pin, and the
 * ends: clear for me, leave a group, delete a group's history for everyone
 * (admins). Every destructive one confirms.
 */

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, UserPlus, X } from 'lucide-react';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@mantle/web-ui/ui/alert-dialog';
import { Input } from '@mantle/web-ui/ui/input';
import { Label } from '@mantle/web-ui/ui/label';
import { Separator } from '@mantle/web-ui/ui/separator';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Switch } from '@mantle/web-ui/ui/switch';
import { useToast } from '@mantle/web-ui/ui/toast';
import { HeaderPill } from '@/components/layout/item-header';
import { ItemListEmpty, ItemSearch } from '@/components/item-list/item-list-header';
import { ChatAvatar } from '@/components/messenger/chat-avatar';
import { messengerApi, messengerKeys } from '@/lib/messenger/api';
import type { MessengerConversation } from '@/lib/messenger/dto';

type Confirm = {
  title: string;
  body: string;
  action: string;
  run: () => Promise<unknown>;
};

export function ChatInspector({
  conversation,
  title,
  me,
  online,
  pinned,
  onLeft,
  onCleared,
}: {
  conversation: MessengerConversation;
  title: string;
  me: string | null;
  online: ReadonlySet<string>;
  pinned: boolean;
  /** I left the group: the screen closes the chat. */
  onLeft: () => void;
  /** The history I see changed (cleared, deleted): load the chat again. */
  onCleared: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const id = conversation.id;
  const group = conversation.kind === 'group';
  const admin = group && conversation.me.admin;
  const left = conversation.me.leftSeq !== null;
  const people = conversation.participants.filter((p) => p.leftAt === null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(conversation.title ?? '');
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: messengerKeys.conversation(id) });
    void queryClient.invalidateQueries({ queryKey: messengerKeys.list });
    void queryClient.invalidateQueries({ queryKey: messengerKeys.unread });
  };

  /** Run an action; true when it worked (a failure toasts and leaves the
   *  form as it was). */
  const act = async (key: string, run: () => Promise<unknown>, done?: string): Promise<boolean> => {
    setBusy(key);
    try {
      await run();
      refresh();
      if (done) toast.success(done);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That did not work');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const rename = async () => {
    const next = name.trim();
    if (!next || next === conversation.title) {
      setRenaming(false);
      return;
    }
    setSaving(true);
    const ok = await act('rename', () => messengerApi.update(id, { title: next }), 'Renamed');
    setSaving(false);
    if (ok) setRenaming(false);
  };

  return (
    <aside aria-label="Chat details" className="space-y-5 p-5" data-testid="chat-inspector">
      <div className="flex flex-col items-center gap-2 text-center">
        <ChatAvatar name={title} kind={group ? 'group' : 'person'} />
        {renaming ? (
          <form
            className="flex w-full items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void rename();
            }}
            noValidate
          >
            <Label htmlFor="chat-title" className="sr-only">
              Group name
            </Label>
            <Input
              id="chat-title"
              value={name}
              maxLength={200}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                // Escape cancels the rename (and stops there, not closing
                // the narrow overlay around it).
                if (e.key !== 'Escape') return;
                e.preventDefault();
                setRenaming(false);
              }}
            />
            <SubmitButton size="sm" pending={saving}>
              Save name
            </SubmitButton>
          </form>
        ) : (
          <div className="flex items-center gap-1">
            <h3 className="text-base font-semibold">{title}</h3>
            {admin && !left ? (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Rename the group"
                onClick={() => {
                  setName(conversation.title ?? '');
                  setRenaming(true);
                }}
              >
                <Pencil />
              </Button>
            ) : null}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {group
            ? `Group, ${people.length} ${people.length === 1 ? 'member' : 'members'}`
            : 'Direct chat'}
        </p>
      </div>

      <Separator />

      <div className="space-y-3">
        <SwitchRow
          id="chat-mute"
          label="Mute"
          hint="Counts unread, never pops up."
          checked={conversation.me.muted}
          disabled={busy !== null || left}
          onChange={(muted) => void act('mute', () => messengerApi.update(id, { muted }))}
        />
        <SwitchRow
          id="chat-pin"
          label="Pin"
          hint="Keeps the chat at the top of the list."
          checked={pinned}
          disabled={busy !== null}
          onChange={(on) => void act('pin', () => messengerApi.pin('conversation', id, on))}
        />
      </div>

      <Separator />

      <section aria-labelledby="chat-people" className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 id="chat-people" className="text-sm font-semibold">
            People
          </h4>
          {admin && !left ? (
            <Button variant="outline" size="xs" onClick={() => setAdding(true)}>
              <UserPlus /> Add
            </Button>
          ) : null}
        </div>
        <ul className="space-y-1">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-2 py-1" data-testid="chat-person">
              <ChatAvatar
                name={p.name}
                kind={p.kind === 'agent' ? 'agent' : 'person'}
                online={online.has(p.id)}
                size="sm"
              />
              <span className="min-w-0 flex-1 truncate text-sm">
                {p.name}
                {p.id === me ? <span className="text-muted-foreground"> (you)</span> : null}
              </span>
              {group && p.admin ? <HeaderPill>admin</HeaderPill> : null}
              {admin && !left && p.id !== me && p.kind === 'login' ? (
                <Button
                  variant="ghost"
                  size="icon-2xs"
                  className="text-muted-foreground hover:text-destructive-ink"
                  aria-label={`Remove ${p.name}`}
                  disabled={busy !== null}
                  onClick={() =>
                    setConfirm({
                      title: `Remove ${p.name}?`,
                      body: `${p.name} stops getting this group's messages and keeps what they already read.`,
                      action: 'Remove',
                      run: () => messengerApi.removePerson(id, p.id),
                    })
                  }
                >
                  <X />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <Separator />

      <div className="flex flex-col items-stretch gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() =>
            setConfirm({
              title: 'Clear this chat for you?',
              body: 'You will not see the messages so far. Nobody else is affected.',
              action: 'Clear for me',
              run: async () => {
                await messengerApi.clear(id);
                onCleared();
              },
            })
          }
        >
          Clear for me
        </Button>
        {group && !left ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              setConfirm({
                title: 'Leave this group?',
                body: 'You stop getting its messages. You keep reading what was said while you were in it.',
                action: 'Leave',
                run: async () => {
                  await messengerApi.leave(id);
                  onLeft();
                },
              })
            }
          >
            Leave group
          </Button>
        ) : null}
        {admin && !left ? (
          <Button
            variant="outline"
            size="sm"
            className="text-destructive-ink hover:text-destructive-ink"
            disabled={busy !== null}
            onClick={() =>
              setConfirm({
                title: 'Delete the history for everyone?',
                body: 'Every message so far is deleted for every member of the group. This cannot be undone.',
                action: 'Delete history',
                run: async () => {
                  await messengerApi.deleteHistory(id);
                  onCleared();
                },
              })
            }
          >
            Delete history
          </Button>
        ) : null}
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const c = confirm;
                setConfirm(null);
                if (c) void act('confirm', c.run);
              }}
            >
              {confirm?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {admin ? (
        <AddPeopleDialog
          open={adding}
          onOpenChange={setAdding}
          inChat={new Set(people.map((p) => p.id))}
          onAdd={(ids) => act('add', () => messengerApi.addPeople(id, ids), 'Added')}
        />
      ) : null}
    </aside>
  );
}

function SwitchRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-describedby={`${id}-hint`}
      />
    </div>
  );
}

/** Add people to a group: the directory, less who is in it already. */
function AddPeopleDialog({
  open,
  onOpenChange,
  inChat,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inChat: ReadonlySet<string>;
  /** True when the people were added. */
  onAdd: (ids: string[]) => Promise<boolean>;
}) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const directory = useQuery({
    queryKey: messengerKeys.directory,
    queryFn: () => messengerApi.directory(),
    enabled: open,
  });
  const people = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (directory.data ?? []).filter(
      (e) => e.kind === 'login' && !inChat.has(e.id) && (!q || e.name.toLowerCase().includes(q)),
    );
  }, [directory.data, inChat, query]);

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setChosen(new Set());
      setQuery('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add people</DialogTitle>
          <DialogDescription>
            They read the group from now on, not what was said before.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (chosen.size === 0) return;
            setPending(true);
            const ok = await onAdd([...chosen]);
            setPending(false);
            if (ok) close(false);
          }}
        >
          <SearchNoSubmit value={query} onChange={setQuery} />
          <div className="-mx-1 max-h-[45vh] min-h-20 overflow-y-auto px-1 scrollbar-thin">
            {directory.isPending ? (
              <div className="flex justify-center p-6">
                <Spinner />
              </div>
            ) : people.length === 0 ? (
              <ItemListEmpty>Nobody else to add.</ItemListEmpty>
            ) : (
              <ul className="space-y-0.5">
                {people.map((p) => (
                  <li key={p.id}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-foreground/[0.04]">
                      <Checkbox
                        checked={chosen.has(p.id)}
                        onCheckedChange={(on) =>
                          setChosen((cur) => {
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
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <SubmitButton pending={pending} disabled={chosen.size === 0}>
              Add people
            </SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The people search inside a form: Enter filters, it never submits. */
export function SearchNoSubmit({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.preventDefault();
      }}
    >
      <ItemSearch value={value} onChange={onChange} placeholder="Search people…" />
    </div>
  );
}
