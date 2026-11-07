'use client';

import { useState } from 'react';
import Link from 'next/link';
import { KeyRound, LogOut, Plus, Repeat, Trash2 } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { useToast } from '@mantle/web-ui/ui/toast';
import { ListCard, ListCardMeta, ListCardTitle } from '@mantle/web-ui/ui/list-card';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
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
import { formatDateTime } from '@mantle/web-ui/lib/format-datetime';
import { currentBrainOrigin } from '@mantle/web-ui/session-registry';
import {
  forgetSession,
  signInAgainPath,
  signOutSession,
  switchSession,
} from '@mantle/web-ui/session-switch';
import { useSessions, type HeldSession } from '@mantle/web-ui/use-sessions';

const ADD_LOGIN_PATH = '/login?add=1&next=%2Fsettings%2Fsessions';

const ACTIVE_PILL =
  'shrink-0 rounded-full border border-success/50 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success-ink';
const SIGNED_OUT_PILL =
  'shrink-0 rounded-full border border-warning/50 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning-ink';

function nameOf(s: HeldSession): string {
  return s.siteName?.trim() || hostOf(s.origin);
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** What a session's bearer says about itself. The brain is the only judge of
 *  whether it still works; this is what the device can tell without asking. */
function expiryOf(s: HeldSession): string {
  if (!s.hasToken) return 'Signed out. Sign in again to use it.';
  if (!s.tokenExpiresAt) return 'Unknown';
  return formatDateTime(new Date(s.tokenExpiresAt * 1000).toISOString());
}

/**
 * The logins this device holds. Selection is client state: every row carries
 * its whole detail, there is nothing to fetch and nothing worth deep-linking.
 */
export function SessionsClient() {
  const toast = useToast();
  const { ready, sessions, canHoldSeveral } = useSessions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'switch' | 'signout' | 'forget' | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'signout' | 'forget'; session: HeldSession }>();

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const selected = sessions.find((s) => s.id === selectedId) ?? sessions[0] ?? null;
  const here = currentBrainOrigin();

  async function onSwitch(s: HeldSession) {
    setBusy('switch');
    const outcome = await switchSession(s.id);
    if (outcome === 'switched') return; // the page is on its way out
    setBusy(null);
    if (outcome === 'needs-sign-in') {
      window.location.assign(signInAgainPath(s.id));
    } else if (outcome === 'unreachable') {
      toast.error(`${nameOf(s)} did not answer. Nothing was changed.`);
    } else if (outcome === 'other-brain') {
      toast.error('That login is held for a different brain than the one this app is open on.');
    } else {
      toast.error('This app cannot switch logins here.');
    }
  }

  async function onConfirm() {
    if (!confirm) return;
    const { kind, session } = confirm;
    setConfirm(undefined);
    setBusy(kind);
    if (kind === 'signout') await signOutSession(session.id);
    else await forgetSession(session.id);
    // Either may have ended in a page load (the active login left). If this
    // line runs, the login that left was one at rest.
    setBusy(null);
    toast.success(kind === 'signout' ? 'Signed out of that login.' : 'Login forgotten.');
  }

  return (
    <>
      <MasterDetail
        id="settings-sessions"
        defaultListSize="340px"
        list={
          <>
            <div className="flex items-center justify-between gap-2 border-b border-border p-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Logins on this device
              </h2>
              {canHoldSeveral && (
                // data-agent-risk on every control here that adds, switches,
                // signs out or forgets a login: the user's own (lib/agent-ui).
                <Button asChild size="sm" data-agent-risk="session">
                  <a href={ADD_LOGIN_PATH}>
                    <Plus /> Add
                  </a>
                </Button>
              )}
            </div>
            <div className="space-y-2 p-3 md:flex-1 md:overflow-y-auto md:scrollbar-thin">
              {!canHoldSeveral && (
                <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  This version of the desktop app holds one login per brain. Update the app to hold
                  several, or open another brain from the tray.
                </p>
              )}
              {sessions.length === 0 ? (
                <p className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
                  The login you are using was signed in before this device could hold more than one,
                  so it is not listed. Sign out and in again once and it will be.
                </p>
              ) : (
                sessions.map((s) => (
                  <ListCard
                    key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    selected={selected?.id === s.id}
                  >
                    <div className="flex items-center gap-2">
                      <ListCardTitle>{nameOf(s)}</ListCardTitle>
                      {s.active && <span className={ACTIVE_PILL}>Active</span>}
                      {!s.hasToken && <span className={SIGNED_OUT_PILL}>Signed out</span>}
                    </div>
                    <ListCardMeta>
                      <span className="truncate">{s.email || 'Login not known yet'}</span>
                    </ListCardMeta>
                    <ListCardMeta>
                      <span className="truncate">{hostOf(s.origin)}</span>
                    </ListCardMeta>
                  </ListCard>
                ))
              )}
            </div>
          </>
        }
        detail={
          selected ? (
            <div className="space-y-6 p-6">
              <div className="flex items-start gap-3">
                <h2 className="flex min-w-0 flex-1 items-center gap-2 text-xl font-semibold">
                  <KeyRound className="size-5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{nameOf(selected)}</span>
                  {selected.active && <span className={ACTIVE_PILL}>Active</span>}
                </h2>
                <div className="flex shrink-0 gap-2">
                  {!selected.active && selected.hasToken && selected.origin === here && (
                    <Button
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => onSwitch(selected)}
                      data-agent-risk="session"
                    >
                      <Repeat /> Switch
                    </Button>
                  )}
                  {!selected.hasToken && (
                    <Button asChild size="sm" data-agent-risk="session">
                      <a href={signInAgainPath(selected.id)}>Sign in again</a>
                    </Button>
                  )}
                </div>
              </div>

              <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Login</dt>
                <dd className="min-w-0 truncate">{selected.email || 'Not known yet'}</dd>
                {selected.displayName && (
                  <>
                    <dt className="text-muted-foreground">Name</dt>
                    <dd className="min-w-0 truncate">{selected.displayName}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">Address</dt>
                <dd className="min-w-0 truncate">{selected.origin}</dd>
                <dt className="text-muted-foreground">Added</dt>
                <dd>{formatDateTime(new Date(selected.addedAt).toISOString())}</dd>
                <dt className="text-muted-foreground">Last used</dt>
                <dd>{formatDateTime(new Date(selected.lastUsedAt).toISOString())}</dd>
                <dt className="text-muted-foreground">Stays signed in until</dt>
                <dd>{expiryOf(selected)}</dd>
              </dl>

              <p className="text-xs text-muted-foreground">
                A login that is used stays signed in: the app renews every login held here each time
                it opens. To see every device a login is signed in on, open{' '}
                <Link href="/settings/users" className="underline underline-offset-2">
                  Logins
                </Link>{' '}
                on its brain.
              </p>

              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => setConfirm({ kind: 'signout', session: selected })}
                  data-agent-risk="session"
                >
                  <LogOut /> Sign out
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  className="text-destructive-ink hover:text-destructive-ink"
                  onClick={() => setConfirm({ kind: 'forget', session: selected })}
                  data-agent-risk="session"
                >
                  <Trash2 /> Forget
                </Button>
              </div>
            </div>
          ) : (
            <div className="p-6 text-sm text-muted-foreground">
              Add a login to hold it on this device and switch to it without signing in again.
            </div>
          )
        }
      />

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === 'forget' ? 'Forget this login?' : 'Sign out of this login?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === 'forget'
                ? 'It is removed from this device without telling its brain, which is for a brain that is gone. If the brain is still there, the login stays signed in on its side until it expires or is removed from its device list. Use Sign out instead when you can.'
                : confirm?.session.active
                  ? 'You are using this login now. Signing out moves you to the next login held on this device, or to the sign-in screen. Other logins here are not affected.'
                  : 'Its brain is told to end it, and it is removed from this device. Other logins here are not affected.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onConfirm}
              data-agent-risk="session"
            >
              {confirm?.kind === 'forget' ? 'Forget login' : 'Sign out'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
