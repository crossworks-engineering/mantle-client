'use client';

/**
 * A chat's details, as an inspector beside the transcript (style guide 8,
 * "A detail pane with an inspector"): everything ABOUT the chat, never its
 * messages. The title (an admin renames a group), the group's info (what it
 * is for and its rules; an admin writes it, everyone reads it), the people
 * with their admin marks (an admin adds and removes them), my mute and my
 * pin, and the ends: clear for me, leave a group, delete a group's history
 * for everyone (admins). Every destructive one confirms.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, UserPlus, X } from 'lucide-react';
import { ApiError } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { Checkbox } from '@mantle/web-ui/ui/checkbox';
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
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Separator } from '@mantle/web-ui/ui/separator';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Switch } from '@mantle/web-ui/ui/switch';
import { useToast } from '@mantle/web-ui/ui/toast';
import { HeaderPill } from '@/components/layout/item-header';
import { ItemSearch } from '@/components/item-list/item-list-header';
import { AppLookPicker, type AppLook } from '@/components/app-nav/app-look-picker';
import { ChatAvatar } from '@/components/messenger/chat-avatar';
import { GroupInfoField } from '@/components/messenger/group-info-field';
import { useChatFaces } from '@/components/messenger/chat-faces';
import { messengerApi, messengerKeys } from '@/lib/messenger/api';
import type { MessengerConversation } from '@/lib/messenger/dto';
import { groupLook, type GroupLook } from '@/lib/messenger/faces';
import {
  canEditInfo,
  infoChanged,
  infoCounter,
  infoShown,
  infoToSend,
  keepsGroupInfo,
} from '@/lib/messenger/group-info';

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
  // The group's info: its text on the form while an admin edits it.
  const [editingInfo, setEditingInfo] = useState(false);
  const [infoText, setInfoText] = useState('');
  // The info as it was when the form opened: a change by another admin
  // meanwhile is said before it is written over.
  const infoWas = useRef<string | null>(null);
  const [savingInfo, setSavingInfo] = useState(false);
  const infoButton = useRef<HTMLButtonElement>(null);
  const doneInfo = () => {
    setEditingInfo(false);
    requestAnimationFrame(() => infoButton.current?.focus());
  };
  // The Add button gives way to the form and takes the focus back after it.
  const addButton = useRef<HTMLButtonElement>(null);
  const doneAdding = () => {
    setAdding(false);
    requestAnimationFrame(() => addButton.current?.focus());
  };
  const faceOf = useChatFaces();
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

  // The group's look, shown at once as it is picked; the chat's answer
  // takes over when it comes back.
  const saved = groupLook(conversation);
  const [look, setLook] = useState<GroupLook>(saved);
  const { icon: savedIcon, color: savedColor } = saved;
  // Picks go out one after another, in order, and the chat's answer only
  // takes over once none is left in flight (no snap back between picks).
  const lookQueue = useRef<Promise<unknown>>(Promise.resolve());
  const lookInFlight = useRef(0);
  // The first failure of a run of picks: one message at the end, not one
  // per pick.
  const lookError = useRef<string | null>(null);
  useEffect(() => {
    if (lookInFlight.current === 0) setLook({ icon: savedIcon, color: savedColor });
  }, [savedIcon, savedColor]);
  const changeLook = (l: AppLook) => {
    const patch: { icon?: string | null; color?: string | null } = {};
    if (l.icon !== undefined) patch.icon = l.icon || null;
    if (l.color !== undefined) patch.color = l.color;
    setLook((cur) => ({
      icon: patch.icon !== undefined ? patch.icon : cur.icon,
      color: l.color !== undefined ? (l.color ?? null) : cur.color,
    }));
    lookInFlight.current += 1;
    const step = async () => {
      try {
        // After a refusal the rest of the run would be refused as well.
        if (!lookError.current) await messengerApi.update(id, patch);
      } catch (err) {
        // A brain before the group look refuses a look-only patch.
        lookError.current =
          err instanceof ApiError && err.status === 400 && /nothing to change/i.test(err.message)
            ? 'This brain does not keep a group’s icon and colour yet.'
            : err instanceof Error
              ? err.message
              : 'That did not work';
      } finally {
        lookInFlight.current -= 1;
        if (lookInFlight.current === 0) {
          // The run settled: the chat's own answer is the truth now, read
          // fresh (a change that landed mid-run was skipped above).
          if (lookError.current) toast.error(lookError.current);
          lookError.current = null;
          refresh();
          void queryClient.refetchQueries({ queryKey: messengerKeys.conversation(id) }).then(() => {
            if (lookInFlight.current > 0) return;
            setLook(
              groupLook(
                queryClient.getQueryData<MessengerConversation>(messengerKeys.conversation(id)),
              ),
            );
          });
        }
      }
    };
    // `step` never throws, and a rejection could not stop the chain either.
    lookQueue.current = lookQueue.current.then(step, step);
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

  /**
   * Save the info. The brain's answer is the truth: the chat it sends back
   * replaces the one held, so the details show what it kept (a brain before
   * 0343 keeps nothing and says so once). The form stays until then.
   */
  const saveInfo = async () => {
    if (infoCounter(infoText).over) return;
    if (!infoChanged(conversation.info, infoText)) {
      doneInfo();
      return;
    }
    const held = conversation.info ?? null;
    if (held !== infoWas.current) {
      // Someone else changed it while this form was open: say so once,
      // with what it says now; the next Save writes over it knowingly.
      infoWas.current = held;
      const now = held ? (held.split('\n').find((l) => l.trim()) ?? '').trim() : '';
      toast.push({
        kind: 'info',
        message: now
          ? `The info was changed meanwhile and now starts "${now.length > 80 ? `${now.slice(0, 79)}…` : now}". Save again to replace it.`
          : 'The info was cleared meanwhile. Save again to write it.',
      });
      return;
    }
    const sent = infoToSend(infoText);
    setSavingInfo(true);
    const ok = await act('info', async () => {
      let fresh: MessengerConversation;
      try {
        fresh = await messengerApi.update(id, { info: sent });
      } catch (err) {
        // A brain before 0343 drops the key and finds nothing to change.
        if (
          err instanceof ApiError &&
          err.status === 400 &&
          /nothing to change/i.test(err.message)
        ) {
          throw new Error('This brain does not keep a group’s info yet.', { cause: err });
        }
        throw err;
      }
      queryClient.setQueryData(messengerKeys.conversation(id), fresh);
      if (sent && !keepsGroupInfo(fresh)) {
        toast.push({ kind: 'info', message: 'This brain does not keep a group’s info yet.' });
      }
    });
    setSavingInfo(false);
    if (ok) doneInfo();
  };
  const infoEditable = canEditInfo(conversation);
  const info = infoShown(conversation);
  // Demoted or left while editing: the form goes, and stays gone.
  useEffect(() => {
    if (!infoEditable) setEditingInfo(false);
  }, [infoEditable]);

  const peer = group ? null : people.find((p) => p.id !== me && p.kind === 'login');
  const avatar = (
    <ChatAvatar
      name={title}
      kind={group ? 'group' : 'person'}
      look={group ? look : null}
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
    />
  );
  return (
    <aside aria-label="Chat details" className="space-y-5 p-5" data-testid="chat-inspector">
      <div className="flex flex-col items-center gap-2 text-center">
        {admin && !left ? (
          // An admin picks the group's icon and colour as a folder's: the
          // tree's own look popup, opened from the group's face.
          <AppLookPicker
            icon={look.icon}
            color={look.color}
            kind="group"
            label={title}
            align="center"
            onChange={changeLook}
            trigger={
              <RowButton
                aria-label="Change the group's icon and colour"
                title="Change the group's icon and colour"
                className="flex rounded-full"
              >
                {avatar}
              </RowButton>
            }
          />
        ) : (
          avatar
        )}
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

      {group ? (
        <>
          <Separator />

          {/* What the group is for and its rules, at the top under the
              title: plain text, line breaks kept, never rendered as
              markdown or links. An admin edits it in place. */}
          <section aria-labelledby="chat-info" className="space-y-2" data-testid="chat-info">
            <div className="flex items-center justify-between gap-2">
              <h4 id="chat-info" className="text-sm font-semibold">
                Info
              </h4>
              {infoEditable && !editingInfo ? (
                <Button
                  ref={infoButton}
                  variant="outline"
                  size="xs"
                  aria-label={info ? "Edit the group's info" : "Add the group's info"}
                  onClick={() => {
                    setInfoText(conversation.info ?? '');
                    infoWas.current = conversation.info ?? null;
                    setEditingInfo(true);
                  }}
                >
                  <Pencil /> {info ? 'Edit' : 'Add'}
                </Button>
              ) : null}
            </div>
            {infoEditable && editingInfo ? (
              <form
                className="space-y-2"
                noValidate
                onKeyDown={(e) => {
                  // Escape anywhere on the form cancels the edit (and stops
                  // there, not closing the narrow overlay around it); not
                  // while a save runs, so a failed one keeps the text.
                  if (e.key === 'Escape' && !e.defaultPrevented) {
                    e.preventDefault();
                    if (!savingInfo) doneInfo();
                  }
                }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveInfo();
                }}
              >
                <GroupInfoField
                  id="chat-info-text"
                  value={infoText}
                  onChange={setInfoText}
                  autoFocus
                  readOnly={savingInfo}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={savingInfo}
                    onClick={doneInfo}
                  >
                    Cancel
                  </Button>
                  <SubmitButton
                    size="sm"
                    pending={savingInfo}
                    disabled={infoCounter(infoText).over}
                  >
                    Save info
                  </SubmitButton>
                </div>
              </form>
            ) : info ? (
              <p
                className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]"
                data-testid="chat-info-text"
              >
                {info}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {infoEditable
                  ? 'What this group is for and its rules. Agents in the group read it too.'
                  : 'Nothing yet.'}
              </p>
            )}
          </section>
        </>
      ) : null}

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
          {admin && !left && !adding ? (
            <Button ref={addButton} variant="outline" size="xs" onClick={() => setAdding(true)}>
              <UserPlus /> Add
            </Button>
          ) : null}
        </div>
        {admin && !left && adding ? (
          <AddPeople
            inChat={new Set(people.map((p) => p.id))}
            onAdd={(ids) => act('add', () => messengerApi.addPeople(id, ids), 'Added')}
            onDone={doneAdding}
          />
        ) : null}
        <ul className="space-y-1">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-2 py-1" data-testid="chat-person">
              <ChatAvatar
                name={p.name}
                kind={p.kind === 'agent' ? 'agent' : 'person'}
                face={faceOf({
                  kind: p.kind,
                  id: p.id,
                  avatar: p.avatar,
                  photoVersion: p.photoVersion,
                })}
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

/**
 * Add people, inline in the People section (no dialog in Chats): a search
 * (it takes the focus), the directory's people not in the chat yet, Add and
 * Cancel. They read the group from now on, not what was said before.
 */
function AddPeople({
  inChat,
  onAdd,
  onDone,
}: {
  inChat: ReadonlySet<string>;
  /** True when the people were added. */
  onAdd: (ids: string[]) => Promise<boolean>;
  onDone: () => void;
}) {
  const faceOf = useChatFaces();
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, []);
  const directory = useQuery({
    queryKey: messengerKeys.directory,
    queryFn: () => messengerApi.directory(),
  });
  const people = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (directory.data ?? []).filter(
      (e) => e.kind === 'login' && !inChat.has(e.id) && (!q || e.name.toLowerCase().includes(q)),
    );
  }, [directory.data, inChat, query]);

  return (
    <form
      ref={form}
      noValidate
      aria-label="Add people"
      className="space-y-2 rounded-md bg-muted/40 p-2"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          onDone();
        }
      }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (chosen.size === 0) return;
        setPending(true);
        const ok = await onAdd([...chosen]);
        setPending(false);
        if (ok) onDone();
      }}
    >
      <p className="px-1 text-xs text-muted-foreground">
        They read the group from now on, not what was said before.
      </p>
      <SearchNoSubmit value={query} onChange={setQuery} />
      <div className="max-h-64 overflow-y-auto scrollbar-thin">
        {directory.isPending ? (
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        ) : people.length === 0 ? (
          <p className="px-1 py-3 text-sm text-muted-foreground">Nobody else to add.</p>
        ) : (
          <ul className="space-y-px">
            {people.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-foreground/[0.06]">
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
                  <ChatAvatar
                    name={p.name}
                    face={faceOf({
                      kind: 'login',
                      id: p.id,
                      avatar: p.avatar,
                      photoVersion: p.photoVersion,
                    })}
                    online={p.online}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton size="sm" pending={pending} disabled={chosen.size === 0}>
          Add people
        </SubmitButton>
      </div>
    </form>
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
