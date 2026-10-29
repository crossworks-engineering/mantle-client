'use client';

import { shortModelName } from '@mantle/web-ui/lib/model-name';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  canResetPassword,
  isNotAPasswordLogin,
  resetPasswordErrorMessage,
} from '@/lib/password-reset';
import {
  Anchor,
  Bot,
  KeyRound,
  MailPlus,
  Monitor,
  MonitorSmartphone,
  Plus,
  Smartphone,
  Trash2,
  Users,
} from 'lucide-react';
import { apiFetch, apiSend, ApiError } from '@mantle/web-ui/api-fetch';
import { ListCard, ListCardMeta } from '@mantle/web-ui/ui/list-card';
import { Badge } from '@mantle/web-ui/ui/badge';
import { Button } from '@mantle/web-ui/ui/button';
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
  AlertDialogTrigger,
} from '@mantle/web-ui/ui/alert-dialog';
import { Input } from '@mantle/web-ui/ui/input';
import { Textarea } from '@mantle/web-ui/ui/textarea';
import { cn } from '@mantle/web-ui/lib/utils';
import { Switch } from '@mantle/web-ui/ui/switch';
import { SecretInput } from '@mantle/web-ui/ui/secret-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { Field, FieldError, FieldLabel } from '@mantle/web-ui/ui/field';
import { FieldHint, hintId } from '@mantle/web-ui/ui/field-hint';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { PERSON_DESCRIPTION_MAX } from '@/lib/messenger/dto';
import { useToast } from '@mantle/web-ui/ui/toast';
import { formatDateTime } from '@mantle/web-ui/lib/format-datetime';
import { signOutActive } from '@mantle/web-ui/session-switch';
import {
  EVERYWHERE_CONFIRM,
  OTHER_LOGIN_EVERYWHERE_TEXT,
  signLoginOutEverywhere,
  signOutEverywhere,
} from '@/lib/sign-out-everywhere';
import { initialSelection, inviteIdOf, inviteKey } from '@/lib/logins-nav';
import { loginRefusalText, refusalReason } from '@/lib/login-refusals';
import { HeaderIconButton, HeaderInfoButton, ItemHeader } from '@/components/layout/item-header';
import { InviteDetail, InviteDialog, stateLine, useInvites } from './invites';
import { inviteName, newLinkSeed, openInvites } from '@/lib/user-invites';
import { PairPhoneCard } from './pair-phone-card';
import { LoginWorkspaces } from './login-workspaces';

/** What the delete confirm says. */
export const LOGIN_DELETE_TEXT =
  'Their login stops working immediately. Nothing in the brain is removed: everything they created stays, and their past actions remain in the audit log.';

/** The role a new login is made with. Not a choice on this screen: the
 *  brain's least (workspaces W5a). */
export const NEW_LOGIN_ROLE = 'member';

type UserRow = {
  id: string;
  email: string;
  displayName: string | null;
  isOwner: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  /** This login's personal assistant, or null when it shares the brain default. */
  agent: { id: string; slug: string; name: string } | null;
  /** The brain's role for the login. Not a control here: what a login reads
   *  comes from its workspaces. Read only for what it changes on this screen:
   *  Reset password (a password login) and the personal assistant (an admin
   *  login). No Chat view: each user reads only their own chats (W7c). */
  role: string;
  contactId: string | null;
  disabledAt: string | null;
  /** Who the person is to the team, on their card (everyone on the brain
   *  reads it, agents included); null: none set. Absent: a brain before
   *  descriptions, so the field is not shown. */
  description?: string | null;
};

/** One option in the "copy from" picker. */
type SourceAgent = { id: string; slug: string; name: string; role: string; model: string };

/**
 * Agents a personal assistant can be copied from: the brain's ENTRY-POINT
 * agents only (role assistant/responder), highest priority first, so the
 * canonical persona is the default pick.
 *
 * Specialists (role `custom`: researcher, appsmith, …) are deliberately absent.
 * They're delegation targets, not chat entry points, and only responder/assistant
 * rows get the manifest's persona convergence on upgrade
 * (`reconcilePersonaCapabilitiesByRole`) and new specialists wired into their
 * delegation (`wireDelegation`), a `custom` clone would quietly drift.
 */
function useSourceAgents() {
  return useQuery({
    queryKey: ['users', 'source-agents'],
    queryFn: async () => {
      const { agents } = await apiFetch<{ agents: SourceAgent[] }>('/api/agents');
      return agents.filter((a) => a.role === 'assistant' || a.role === 'responder');
    },
  });
}

/** A small section heading in the list column, with an optional count and
 *  one small text action on the right. */
function ListSectionHeading({
  id,
  title,
  count,
  action,
}: {
  id: string;
  title: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-1 pt-2">
      <h2 id={id} className="flex items-center gap-1.5 text-xs font-semibold">
        {title}
        {count ? (
          <>
            {/* The dot is for the eye; the heading's name stays the word. */}
            <span
              aria-hidden
              className="inline-flex min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-medium text-muted-foreground"
            >
              {count}
            </span>
            <span className="sr-only">({count})</span>
          </>
        ) : null}
      </h2>
      {action}
    </div>
  );
}

/** One login's card in the list. */
function LoginCard({
  user,
  selected,
  onSelect,
}: {
  user: UserRow;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <ListCard onClick={onSelect} selected={selected}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {user.displayName || user.email}
        </span>
        {user.disabledAt && (
          <Badge variant="outline" className="shrink-0">
            Disabled
          </Badge>
        )}
        {user.agent && (
          <Badge variant="outline" className="shrink-0" title={user.agent.name}>
            <Bot className="size-3" /> {user.agent.name}
          </Badge>
        )}
        {user.isOwner && (
          <Badge variant="secondary" className="shrink-0">
            Anchor
          </Badge>
        )}
      </div>
      <ListCardMeta>
        {user.displayName
          ? user.email
          : user.lastLoginAt
            ? `Last login ${formatDateTime(user.lastLoginAt)}`
            : 'Never signed in'}
      </ListCardMeta>
    </ListCard>
  );
}

/**
 * Users: ways INTO the one brain, not tenants. Account actions only: what a
 * login reads comes from its workspaces (Settings > Workspaces). The list
 * column holds, top to bottom: Open invites (while any is open), then the
 * logins. Invite and Add user head the column. One detail pane shows whatever is selected, under its one
 * header (ItemHeader).
 *
 * Kept brain route (W5c contract): /api/team-admin/invites (INVITES_PATH).
 * There is no code sign-in since workspaces W8. The server enforces
 * the invariants (anchor undeletable, no self-delete); the UI just mirrors
 * them.
 */
export function UsersClient() {
  const queryClient = useQueryClient();
  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => apiFetch<{ users: UserRow[]; currentActorId: string }>('/api/users'),
  });
  const invitesQuery = useInvites();

  // Deep link: /settings/users?selected=<id-or-email | invite:<id>>
  // preselects (initial state only: selection stays client state after). An
  // old Clients step or the old code sign-in entry opens the plain list.
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    initialSelection(searchParams.get('selected')),
  );
  const [addOpen, setAddOpen] = useState(false);
  // The Invite dialog, empty (Invite) or for an open invite's person (New
  // link). Owned here, not by the invite pane: a New link replaces that
  // invite, and the one-time link must stay on screen meanwhile.
  const [inviteSeed, setInviteSeed] = useState<
    (ReturnType<typeof newLinkSeed> & { key: number }) | null
  >(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const select = (id: string | null) => setSelectedId(id);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  if (usersQuery.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }
  if (usersQuery.isError && !usersQuery.data) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 py-12 text-sm text-muted-foreground">
        <p>Couldn&apos;t load logins.</p>
        <Button variant="outline" size="sm" onClick={() => usersQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const { users, currentActorId } = usersQuery.data;
  const invites = openInvites(invitesQuery.data?.invites);

  // What the detail pane shows: an open invite or a login (by id or email; the first login when nothing, or something gone,
  // is selected).
  const inviteId = inviteIdOf(selectedId);
  const invite = inviteId ? (invites.find((i) => i.id === inviteId) ?? null) : null;
  const selected = invite
    ? null
    : (users.find((u) => u.id === selectedId || u.email === selectedId) ?? users[0] ?? null);
  const selectedKey = invite ? inviteKey(invite.id) : (selected?.id ?? null);

  return (
    <>
      <MasterDetail
        id="settings-users"
        // The 340px this screen has always had.
        defaultListSize="340px"
        // No `detailFills`: the detail is a form, and the 672px default measure
        // is what keeps it off 1200px line lengths (§8).
        list={
          <>
            <div className="flex items-center justify-between gap-2 border-b border-border p-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Users
              </h2>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setInviteSeed({ key: Date.now(), contact: null, email: '', name: '' })
                  }
                >
                  <MailPlus /> Invite
                </Button>
                <Button size="sm" onClick={() => setAddOpen(true)}>
                  <Plus /> Add user
                </Button>
              </div>
            </div>
            <div className="space-y-2 p-3 md:flex-1 md:overflow-y-auto md:scrollbar-thin">
              {invites.length > 0 ? (
                <section aria-labelledby="logins-open-invites" className="space-y-2 pb-2">
                  <ListSectionHeading
                    id="logins-open-invites"
                    title="Open invites"
                    count={invites.length}
                  />
                  {invites.map((i) => (
                    <ListCard
                      key={i.id}
                      onClick={() => select(inviteKey(i.id))}
                      selected={selectedKey === inviteKey(i.id)}
                    >
                      <div className="flex items-center gap-2">
                        <MailPlus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {inviteName(i)}
                        </span>
                      </div>
                      <ListCardMeta>{`${i.email} · ${stateLine(i)}`}</ListCardMeta>
                    </ListCard>
                  ))}
                </section>
              ) : null}

              {users.map((u) => (
                <LoginCard
                  key={u.id}
                  user={u}
                  selected={selectedKey === u.id}
                  onSelect={() => select(u.id)}
                />
              ))}
            </div>
          </>
        }
        // `relative` and the pane's single scroller are `MasterDetail`'s job now.
        detail={
          invite ? (
            <InviteDetail
              key={invite.id}
              invite={invite}
              onRevoked={() => select(null)}
              onNewLink={() => setInviteSeed({ key: Date.now(), ...newLinkSeed(invite) })}
            />
          ) : selected ? (
            <UserDetail
              key={selected.id}
              user={selected}
              isSelf={selected.id === currentActorId}
              onChanged={() => void invalidate()}
              onRequestDelete={() => setDeleteOpen(true)}
              onRequestReset={() => setResetOpen(true)}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
              <Users className="mr-2 size-4" /> No logins.
            </div>
          )
        }
      />

      <AddUserDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={(id) => {
          select(id);
          void invalidate();
        }}
      />
      {inviteSeed ? (
        <InviteDialog
          key={inviteSeed.key}
          open
          onOpenChange={(o) => !o && setInviteSeed(null)}
          initialContact={inviteSeed.contact}
          initialEmail={inviteSeed.email}
          initialName={inviteSeed.name}
          onCreated={(id) => select(inviteKey(id))}
        />
      ) : null}
      {selected && (
        <>
          <ResetPasswordDialog open={resetOpen} onOpenChange={setResetOpen} user={selected} />
          <DeleteUserDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            user={selected}
            onDeleted={() => {
              select(null);
              void invalidate();
            }}
          />
        </>
      )}
    </>
  );
}

/** What a login is, in a sentence: the Info button's text. */
function loginAbout(user: UserRow): string {
  if (user.isOwner) return 'The anchor login. The brain is keyed to it, so it can’t be deleted.';
  return 'A login. What it reads comes from its workspaces, not from this screen. Its actions are recorded under this identity.';
}

function UserDetail({
  user,
  isSelf,
  onChanged,
  onRequestDelete,
  onRequestReset,
}: {
  user: UserRow;
  isSelf: boolean;
  onChanged: () => void;
  onRequestDelete: () => void;
  onRequestReset: () => void;
}) {
  const toast = useToast();
  const [displayName, setDisplayName] = useState(user.displayName ?? '');
  const [description, setDescription] = useState(user.description ?? '');
  const [saving, setSaving] = useState(false);
  const name = user.displayName || user.email;
  const describes = user.description !== undefined;
  const descriptionLength = Array.from(description.trim()).length;
  const descriptionOver = descriptionLength > PERSON_DESCRIPTION_MAX;
  const descriptionChanged = describes && description.trim() !== (user.description ?? '');

  const saveDisplayName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (descriptionOver) {
      toast.error(`Keep the description to ${PERSON_DESCRIPTION_MAX} characters.`);
      return;
    }
    setSaving(true);
    try {
      await apiSend(`/api/users/${user.id}`, 'PATCH', {
        displayName: displayName.trim() || null,
        // Only when changed: the same body on a brain before descriptions.
        ...(descriptionChanged ? { description: description.trim() || null } : {}),
      });
      onChanged();
      toast.success('User saved');
    } catch (err) {
      toast.error(loginRefusalText(err, 'Could not save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {/* The pane's one header: name and state; Info and Delete as icons. */}
      <ItemHeader
        sticky
        title={name}
        badges={
          <>
            {user.isOwner && (
              <Badge variant="secondary">
                <Anchor className="size-3" /> Anchor
              </Badge>
            )}
            {isSelf && <Badge variant="outline">You</Badge>}
            {user.disabledAt && <Badge variant="outline">Disabled</Badge>}
          </>
        }
        iconActions={
          <>
            <HeaderInfoButton label="About this login">
              <p>{loginAbout(user)}</p>
            </HeaderInfoButton>
            {!user.isOwner && !isSelf && (
              <HeaderIconButton
                label="Delete login"
                className="text-muted-foreground hover:text-destructive-ink"
                onClick={onRequestDelete}
              >
                <Trash2 />
              </HeaderIconButton>
            )}
          </>
        }
      />

      <div className="space-y-6 p-6">
        <div className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Email</div>
            <div className="mt-0.5 break-all">{user.email}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Created</div>
            <div className="mt-0.5">{formatDateTime(user.createdAt)}</div>
          </div>
          <LoginWorkspaces loginId={user.id} />
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Last login</div>
            <div className="mt-0.5">
              {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Never signed in'}
            </div>
          </div>
        </div>

        <form onSubmit={saveDisplayName} noValidate className="space-y-3">
          <Field>
            <FieldLabel htmlFor="display-name">Display name</FieldLabel>
            <Input
              id="display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Their full name"
              aria-describedby={hintId('display-name')}
            />
            <FieldHint id="display-name">
              How this person appears in the app. Changing it doesn&apos;t affect their login.
            </FieldHint>
          </Field>
          {describes && (
            <Field>
              <FieldLabel htmlFor="person-description">Description</FieldLabel>
              <Textarea
                id="person-description"
                value={description}
                rows={2}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Developer, Project manager, Jason's wife"
                aria-describedby={hintId('person-description')}
                aria-invalid={descriptionOver || undefined}
              />
              <FieldHint id="person-description">
                Who this person is to the team: a job title, a role or a relationship. Everyone on
                this brain reads it on their card, agents included, so they know whom to message.{' '}
                <span className={cn('tabular-nums', descriptionOver && 'text-destructive-ink')}>
                  {descriptionLength}/{PERSON_DESCRIPTION_MAX}
                </span>
              </FieldHint>
            </Field>
          )}
          <SubmitButton pending={saving}>Save user</SubmitButton>
        </form>

        {!user.isOwner && !isSelf && <AccessCard user={user} onChanged={onChanged} />}

        {user.role === 'admin' && <AssistantCard user={user} onChanged={onChanged} />}

        {/* Only a password login (admin, member) has one: a role this app
            does not know gets nothing. */}
        {canResetPassword(user.role) && (
          <div className="rounded-md border border-border p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <KeyRound className="size-4 text-muted-foreground" /> Password
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Set a new password for this login. The reset is recorded in the audit log.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={onRequestReset}>
                Reset password
              </Button>
            </div>
          </div>
        )}

        <DevicesCard user={user} isSelf={isSelf} />
        {isSelf && <PairPhoneCard userId={user.id} />}
      </div>
    </div>
  );
}

/**
 * Account state for one login: a Disabled switch that stops the login at
 * once (sessions are re-checked every request; bearers are revoked). No role
 * here: what a login may do comes from its workspaces (workspaces W5a, plan
 * 21.9: logins carry no permission). Never shown for the anchor or your own
 * login.
 */
function AccessCard({ user, onChanged }: { user: UserRow; onChanged: () => void }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const setDisabled = async (disabled: boolean) => {
    setSaving(true);
    try {
      await apiSend(`/api/users/${user.id}`, 'PATCH', { disabled });
      onChanged();
      toast.success(disabled ? 'Login disabled' : 'Login enabled');
    } catch (err) {
      // Enabling a former client login is refused (409 former-client, W8).
      toast.error(loginRefusalText(err, 'Could not change the login'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-md border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Disabled</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Stops this login at once: it cannot sign in, and every session it holds ends.
          </p>
        </div>
        <Switch
          checked={!!user.disabledAt}
          disabled={saving}
          onCheckedChange={(v) => void setDisabled(v)}
          aria-label="Disable this login"
        />
      </div>
    </div>
  );
}

type Device = {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  current: boolean;
};

/**
 * This login's live bearer sessions (mobile companion, detached web client),
 * revocable one at a time. Moved here from the retired Settings → Security
 * screen so that cutting someone off (delete the login, sign its devices out)
 * is one screen's work rather than two.
 *
 * The session COOKIE isn't listed: it has no row (it's stateless), so a
 * password reset and sign-out are what govern it.
 */
function DevicesCard({ user, isSelf }: { user: UserRow; isSelf: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const devicesQuery = useQuery({
    queryKey: ['users', user.id, 'devices'],
    queryFn: () => apiFetch<{ devices: Device[] }>(`/api/users/${user.id}/devices`),
  });

  const revoke = async (device: Device) => {
    try {
      await apiSend(`/api/users/${user.id}/devices/${device.id}`, 'DELETE');
      toast.success(`Signed out “${device.label}”.`);
      void queryClient.invalidateQueries({ queryKey: ['users', user.id, 'devices'] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not revoke that device.');
    }
  };

  const devices = devicesQuery.data?.devices ?? [];

  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <MonitorSmartphone className="size-4 text-muted-foreground" /> Devices
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Live sessions signed in as {isSelf ? 'you' : user.email}. Signing one out revokes its
            token at once: the next request from it fails.
          </p>
        </div>
        <SignOutEverywhereButton user={user} isSelf={isSelf} />
      </div>

      {devicesQuery.isPending ? (
        <p className="text-sm text-muted-foreground">Loading devices…</p>
      ) : devicesQuery.isError ? (
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load devices.</p>
          <Button variant="outline" size="sm" onClick={() => devicesQuery.refetch()}>
            Retry
          </Button>
        </div>
      ) : devices.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No signed-in devices. Sessions from the mobile companion or a detached client appear here.
        </p>
      ) : (
        <div className="space-y-2">
          {devices.map((d) => (
            <div
              key={d.id}
              className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
            >
              {/Web client/i.test(d.label) ? (
                <Monitor className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <Smartphone className="size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">
                  {d.label}
                  {d.current && (
                    <Badge variant="secondary" className="ml-2">
                      This device
                    </Badge>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {d.lastUsedAt
                    ? `Last used ${formatDateTime(d.lastUsedAt)}`
                    : `Added ${formatDateTime(d.createdAt)}`}
                  {' · '}expires {formatDateTime(d.expiresAt)}
                </p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm">
                    Revoke
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Sign out “{d.label}”?</AlertDialogTitle>
                    <AlertDialogDescription>
                      The device&apos;s token is revoked at once. Its next request fails and it must
                      sign in again.
                      {d.current ? ' This is the device you are using right now.' : ''}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => void revoke(d)}
                    >
                      Revoke device
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Sign a login out on every device: its cookies, asset tokens and bearers
 * (the phone app, connected clients) all stop. Another login goes through
 * PATCH /api/users/:id `{ signOut: true }`; your own through the same route
 * the account menu uses, and then this browser signs out too.
 */
function SignOutEverywhereButton({ user, isSelf }: { user: UserRow; isSelf: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    const outcome = isSelf ? await signOutEverywhere() : await signLoginOutEverywhere(user.id);
    if (outcome.kind === 'error') {
      setBusy(false);
      setOpen(false);
      toast.error(outcome.message);
      return;
    }
    if (isSelf || outcome.kind === 'signed-out') {
      // This browser's session is gone too (or already was). Signed out the
      // way the profile menu's Sign out everywhere does it: onto the next
      // login this device holds, else /login, in a page load.
      await signOutActive();
      return;
    }
    setBusy(false);
    setOpen(false);
    toast.success(`Signed ${user.displayName || user.email} out on every device.`);
    void queryClient.invalidateQueries({ queryKey: ['users', user.id, 'devices'] });
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="shrink-0">
          Sign out everywhere
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isSelf
              ? 'Sign out everywhere?'
              : `Sign ${user.displayName || user.email} out everywhere?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isSelf ? EVERYWHERE_CONFIRM : OTHER_LOGIN_EVERYWHERE_TEXT}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              void run();
            }}
          >
            {busy ? 'Signing out…' : 'Sign out everywhere'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * A login's personal assistant: create it, rename it, or release it.
 *
 * Releasing only drops the binding, the agent and its whole chat history stay,
 * as an ordinary shared agent under /settings/agents. Nothing here ever deletes
 * an agent; that stays a deliberate act on the agents screen.
 */
function AssistantCard({ user, onChanged }: { user: UserRow; onChanged: () => void }) {
  const toast = useToast();
  const sources = useSourceAgents();
  const [name, setName] = useState(user.agent?.name ?? '');
  const [sourceAgentId, setSourceAgentId] = useState('');
  const [pending, setPending] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [nameError, setNameError] = useState<string>();

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    // §6b: was a toast naming a control, shown in a corner.
    if (!trimmed) {
      setNameError('Enter a name for the assistant.');
      document.getElementById(`user-${user.id}-agent-name`)?.focus();
      return;
    }
    setNameError(undefined);
    // With an assistant already in place and no explicit new source, this is a
    // rename, the server keeps the slug, so the existing thread survives.
    const source = user.agent ? sourceAgentId || undefined : sourceAgentId || sources.data?.[0]?.id;
    if (!user.agent && !source) {
      toast.error('No agent available to copy from.');
      return;
    }
    setPending(true);
    try {
      await apiSend(`/api/users/${user.id}/agent`, 'PUT', {
        name: trimmed,
        ...(source ? { sourceAgentId: source } : {}),
      });
      setSourceAgentId('');
      onChanged();
      toast.success(user.agent ? 'Assistant renamed' : 'Assistant created');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save the assistant');
    } finally {
      setPending(false);
    }
  };

  const release = async () => {
    setPending(true);
    try {
      await apiSend(`/api/users/${user.id}/agent`, 'DELETE');
      setName('');
      setReleaseOpen(false);
      onChanged();
      toast.success('Assistant released');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not release the assistant');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Bot className="size-4 text-muted-foreground" /> Assistant
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {user.agent ? (
              <>
                Chats open on{' '}
                <a
                  href={`/settings/agents?selected=${user.agent.id}`}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  {user.agent.name}
                </a>{' '}
                for this login, on its own thread.
              </>
            ) : (
              'Shares the brain’s default assistant. Each user’s chat with it is their own.'
            )}
          </p>
        </div>
        {user.agent && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setReleaseOpen(true)}
          >
            Release
          </Button>
        )}
      </div>
      <form onSubmit={save} noValidate className="space-y-3">
        <AssistantFields
          idPrefix={`user-${user.id}`}
          name={name}
          nameError={nameError}
          onNameChange={(v) => {
            setName(v);
            if (nameError) setNameError(undefined);
          }}
          sourceAgentId={sourceAgentId}
          onSourceAgentIdChange={setSourceAgentId}
          sources={sources.data ?? []}
          nameLabel="Assistant name"
          showSource={!user.agent}
          nameHint={
            user.agent
              ? 'Renaming keeps the same assistant and its chat history. To copy from a different agent, release this one and create a new one.'
              : undefined
          }
        />
        <SubmitButton pending={pending}>
          {user.agent ? 'Rename assistant' : 'Create assistant'}
        </SubmitButton>
      </form>

      <AlertDialog open={releaseOpen} onOpenChange={setReleaseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Release {user.agent?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It stops being this login&apos;s assistant, so a fresh sign-in lands on the
              brain&apos;s default instead. Someone already chatting to it keeps their place until
              they pick another agent. The agent and its whole chat history stay: it becomes an
              ordinary shared agent, and you can delete it from Settings → Agents if you want it
              gone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                void release();
              }}
            >
              Release assistant
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Name + source-agent inputs for a login's personal assistant. Shared by the
 * Add-login dialog and the detail panel's assistant card, so the wording of
 * what this does, and what it does NOT do, is written once.
 */
function AssistantFields({
  idPrefix,
  name,
  onNameChange,
  sourceAgentId,
  onSourceAgentIdChange,
  sources,
  nameLabel = 'Assistant name (optional)',
  nameHint,
  nameError,
  showSource = true,
}: {
  idPrefix: string;
  name: string;
  onNameChange: (v: string) => void;
  sourceAgentId: string;
  onSourceAgentIdChange: (v: string) => void;
  sources: SourceAgent[];
  nameLabel?: string;
  nameHint?: React.ReactNode;
  /**
   * §6b. The name rule lives with the caller (it differs per caller, blank is
   * legal when adding a login, and a failure when renaming an assistant), so
   * the message comes down rather than the rule going up. Same shape as
   * `ToolGroupIntegrationSection`'s `serviceError`.
   */
  nameError?: string;
  /** False once an assistant exists, then the only in-place edit is a rename,
   *  which keeps the slug and therefore the thread. Pointing a login at a
   *  different source is Release + Create, so nobody strands a live thread by
   *  nudging a dropdown. */
  showSource?: boolean;
}) {
  const nameId = `${idPrefix}-agent-name`;
  const sourceId = `${idPrefix}-agent-source`;
  const selected = sourceAgentId || sources[0]?.id || '';
  return (
    <>
      <Field data-invalid={!!nameError || undefined}>
        <FieldLabel htmlFor={nameId}>{nameLabel}</FieldLabel>
        <Input
          id={nameId}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g. Nova"
          aria-invalid={!!nameError || undefined}
          aria-describedby={nameError ? `${nameId}-error ${hintId(nameId)}` : hintId(nameId)}
        />
        <FieldHint
          id={nameId}
          warn="Not exclusive: other Admin users can chat with this assistant too, each in their own chat."
        >
          {nameHint ?? (
            <>
              Gives this login its own copy of an assistant. Leave blank to share the brain&apos;s
              default assistant. Each user&apos;s chat is their own either way.
            </>
          )}
        </FieldHint>
        <FieldError id={`${nameId}-error`}>{nameError}</FieldError>
      </Field>
      {showSource && name.trim().length > 0 && (
        <Field>
          <FieldLabel htmlFor={sourceId}>Copy from</FieldLabel>
          <Select value={selected} onValueChange={onSourceAgentIdChange}>
            <SelectTrigger id={sourceId} aria-describedby={hintId(sourceId)}>
              <SelectValue placeholder="Choose an agent" />
            </SelectTrigger>
            <SelectContent>
              {sources.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  <span className="font-medium">{a.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {shortModelName(a.model)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldHint id={sourceId}>
            The copy keeps its source&apos;s model, prompt, skills and tools, but answers to the
            name you give it here. It just gets its own chat history. Telegram bots and the rules it
            learned (in the Journal) aren&apos;t copied.
          </FieldHint>
        </Field>
      )}
    </>
  );
}

function AddUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [displayName, setDisplayName] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // §6b. `required` + `type="email"` + `minLength` were the browser's bubble:
    // announced to nothing and gone on the next click. Same rules, on the
    // controls. The form is `noValidate`.
    const errs: { email?: string; password?: string } = {};
    if (!email.trim()) errs.email = 'An email address is required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      errs.email = 'That does not look like an email address.';
    if (!password) errs.password = 'A starting password is required.';
    else if (password.length < 8) errs.password = 'Use at least 8 characters.';
    if (errs.email || errs.password) {
      setErrors(errs);
      document.getElementById(errs.email ? 'new-user-email' : 'new-user-password')?.focus();
      return;
    }
    setErrors({});
    setPending(true);
    try {
      // No role on this screen (workspaces W5a): a new login starts with the
      // least, and what it reads comes from the workspaces it is added to on
      // the Workspaces screen. The brain still takes `role` until it drops
      // roles; its default is member too (W5a contract change 21), and the
      // UI still says the least out loud so an older brain makes the same.
      const res = await apiSend<{ id: string }>('/api/users', 'POST', {
        email: email.trim(),
        password,
        displayName: displayName.trim() || undefined,
        role: NEW_LOGIN_ROLE,
      });
      toast.success('User added');
      setEmail('');
      setPassword('');
      setDisplayName('');
      onOpenChange(false);
      onCreated(res.id);
    } catch (err) {
      // A former client login's email (409 email-was-client, W8) is the
      // email field's problem; anything else is the dialog's.
      if (refusalReason(err) === 'email-was-client') {
        setErrors({ email: loginRefusalText(err, 'Could not add user') });
        document.getElementById('new-user-email')?.focus();
      } else {
        toast.error(loginRefusalText(err, 'Could not add user'));
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>
            A login for one person. Share the starting password; they can change it after they sign
            in. Then add them to workspaces on the Workspaces screen: that decides what they read.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-3">
          <Field data-invalid={!!errors.email || undefined}>
            <FieldLabel htmlFor="new-user-email">Email</FieldLabel>
            <Input
              id="new-user-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              autoComplete="off"
              aria-invalid={!!errors.email || undefined}
              aria-describedby={
                errors.email ? 'new-user-email-error new-user-email-hint' : 'new-user-email-hint'
              }
            />
            <FieldHint id="new-user-email">
              Their login. It can&apos;t be changed afterwards.
            </FieldHint>
            <FieldError id="new-user-email-error">{errors.email}</FieldError>
          </Field>
          <Field data-invalid={!!errors.password || undefined}>
            <FieldLabel htmlFor="new-user-password">Starting password</FieldLabel>
            <SecretInput
              id="new-user-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="off"
              aria-invalid={!!errors.password || undefined}
              aria-describedby={
                errors.password
                  ? 'new-user-password-error new-user-password-hint'
                  : 'new-user-password-hint'
              }
            />
            <FieldHint
              id="new-user-password"
              warn="You'll need to pass this to them yourself. It isn't emailed."
            >
              What they sign in with the first time.
            </FieldHint>
            <FieldError id="new-user-password-error">{errors.password}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor="new-user-display-name">Display name (optional)</FieldLabel>
            <Input
              id="new-user-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Their full name"
              aria-describedby={hintId('new-user-display-name')}
            />
            <FieldHint id="new-user-display-name">
              Falls back to the email address when blank.
            </FieldHint>
          </Field>
          <div className="flex justify-end pt-1">
            <SubmitButton pending={pending}>Add user</SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserRow;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Same rules `required` + `minLength={8}` already encoded (§6b).
    if (!password) {
      setError('A new password is required.');
      document.getElementById('reset-password-value')?.focus();
      return;
    }
    if (password.length < 8) {
      setError('Use at least 8 characters.');
      document.getElementById('reset-password-value')?.focus();
      return;
    }
    setError(undefined);
    setPending(true);
    try {
      await apiSend(`/api/users/${user.id}/password`, 'POST', { newPassword: password });
      toast.success(`Password reset for ${user.email}`);
      setPassword('');
      onOpenChange(false);
    } catch (err) {
      toast.error(resetPasswordErrorMessage(err));
      if (isNotAPasswordLogin(err)) {
        // Nothing to retry: this login has no password (its role moved
        // under the list). Close, and reload the list.
        setPassword('');
        onOpenChange(false);
        void queryClient.invalidateQueries({ queryKey: ['users'] });
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            Set a new password for {user.email}. Their current password stops working immediately;
            the reset is recorded in the audit log.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-3">
          <Field data-invalid={!!error || undefined}>
            <FieldLabel htmlFor="reset-password-value">New password</FieldLabel>
            <SecretInput
              id="reset-password-value"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="off"
              aria-invalid={!!error || undefined}
              aria-describedby={
                error
                  ? 'reset-password-value-error reset-password-value-hint'
                  : 'reset-password-value-hint'
              }
            />
            <FieldHint
              id="reset-password-value"
              warn="Their old password stops working the moment you save."
            >
              What they&apos;ll sign in with from now on.
            </FieldHint>
            <FieldError id="reset-password-value-error">{error}</FieldError>
          </Field>
          <div className="flex justify-end pt-1">
            <SubmitButton pending={pending}>Reset password</SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteUserDialog({
  open,
  onOpenChange,
  user,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserRow;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [pending, setPending] = useState(false);

  const confirm = async () => {
    setPending(true);
    try {
      await apiSend(`/api/users/${user.id}`, 'DELETE');
      toast.success(`Removed ${user.email}`);
      onOpenChange(false);
      onDeleted();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete user');
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {user.displayName || user.email}?</AlertDialogTitle>
          <AlertDialogDescription>{LOGIN_DELETE_TEXT}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              void confirm();
            }}
          >
            Delete user
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
