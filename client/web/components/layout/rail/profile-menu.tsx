'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ChevronsUpDown,
  Dices,
  IdCard,
  KeyRound,
  LogOut,
  MonitorOff,
  Plus,
  Search as SearchIcon,
  SunMoon,
  User as UserIcon,
} from 'lucide-react';
import { currentBrainOrigin } from '@mantle/web-ui/session-registry';
import { signInAgainPath, signOutActive, switchSession } from '@mantle/web-ui/session-switch';
import { useSessions, type HeldSession } from '@mantle/web-ui/use-sessions';
import { RowButton } from '@mantle/web-ui/ui/row-button';
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
import { useToast } from '@mantle/web-ui/ui/toast';
import { cn } from '@mantle/web-ui/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@mantle/web-ui/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@mantle/web-ui/ui/avatar';
import { GeneratedAvatar } from '@mantle/web-ui/generated-avatar';
import { ProfilePhoto } from '@/components/profile-photo';
import { ThemeModeItems } from '@mantle/web-ui/theme-toggle';
import { useColorTheme } from '@mantle/web-ui/color-theme-provider';
import { themeLabel } from '@mantle/web-ui/lib/themes';
import { RandomThemeItems } from '@/components/random-theme-toggle';
import { agentInitials } from '@/lib/agent-color';
import { hasArea } from '@/lib/workspaces';
import { useViewerAreas } from '@/components/workspaces/use-shell-workspaces';
import { useShellRole } from '@/components/layout/shell-role';
import { MemberPasswordDialog } from '@/components/member/member-password-dialog';
import { MemberDescriptionDialog } from '@/components/member/member-description-dialog';
import { EVERYWHERE_CONFIRM_TEXT, signOutEverywhere } from '@/lib/sign-out-everywhere';

export type ProfileIdentity = {
  /** The actor's display name, when they have set one. */
  displayName?: string | null;
  /** The actor's email — the fallback label, and the menu's secondary line. */
  email?: string | null;
  avatar?: { style: string; seed: string; parts?: Record<string, string | null> | null } | null;
  /** Uploaded profile photo's cache-buster — when set, the photo IS the face
   *  (photo → generated seed → initials). */
  photoVersion?: string | null;
};

/** Whichever of name/email is the better thing to call this person, plus the
 *  initials to fall back to when they have no generated avatar. */
function identityOf({ displayName, email }: ProfileIdentity) {
  const primary = displayName?.trim() || email?.trim() || 'Signed in';
  // Initials via the ONE shared algorithm (agentInitials): the profile
  // settings preview uses the same helper, so what a user sees there is what
  // the rail draws — a local variant here showed a different monogram for the
  // same person ("Ada B Lovelace" → AL in settings, AB in the rail). An email
  // has no whitespace, so it falls through to the first two characters
  // ("jason@…" → JA), the same shape as a one-word name.
  const initials = agentInitials(displayName?.trim() || email?.trim() || 'M');
  return { primary, initials };
}

/**
 * Who you are signed in as, and the two things you can do about it. The old
 * header's right-hand cluster, rebuilt as a row that fits a 16rem column.
 *
 * Two shapes, because the rail and the mobile bar want different things from
 * the same control:
 *  - `rail` — a full-width row: avatar, name, and the up/down chevron that says
 *    "this opens a menu". Collapses to the avatar alone in the icon rail, where
 *    the name has nowhere to go.
 *  - `bar` — the avatar alone, for the slim mobile bar.
 *
 * The identity shown is the ACTOR (see GET /api/shell): on a brain with more
 * than one login, this names the person at the keyboard rather than the account
 * that owns the data.
 */
/**
 * How this keyboard spells the search chord. The shortcut is registered on
 * `metaKey || ctrlKey` either way, so this only decides what the badge says.
 *
 * Each platform gets its own notation, not a substituted word: ⌘ is a modifier
 * GLYPH and sits flush against the letter, while "Ctrl" is a word and needs the
 * plus or it reads as "CtrlK".
 *
 * Starts as the Mac spelling and corrects after mount rather than reading the
 * platform during render — the server has no `navigator`, and a first client
 * render that disagrees with the HTML is a hydration mismatch.
 *
 * Moved here from `rail-controls.tsx` with the search control itself.
 */
function useSearchChord(): string {
  const [chord, setChord] = useState('⌘K');
  useEffect(() => {
    if (!/Mac|iPhone|iPad|iPod/.test(navigator.userAgent)) setChord('Ctrl+K');
  }, []);
  return chord;
}

export function ProfileMenu({
  identity,
  variant = 'rail',
  onNavigate,
  onSearchClick,
}: {
  identity: ProfileIdentity;
  variant?: 'rail' | 'bar';
  onNavigate?: () => void;
  /** Opens the search palette. Absent on surfaces that have no palette to open
   *  — the item is then not rendered rather than rendered inert. */
  onSearchClick?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [everywhereOpen, setEverywhereOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const toast = useToast();
  // The Profile screen, its photo route and Manage logins are the
  // settings area's (phase W5c: one shell for every login). A brain that
  // names no areas leaves them all on.
  const manages = hasArea(useViewerAreas(), 'settings');
  // A member's account is its password (POST /api/auth/change-password
  // serves every login): no owner screen offers a self-serve change.
  const member = useShellRole() === 'member';
  const { primary, initials } = identityOf(identity);
  const { avatar, email, photoVersion } = identity;
  const { colorTheme } = useColorTheme();
  const chord = useSearchChord();

  // The other logins this device holds for THIS brain. One that its brain has
  // signed out stays in the list on purpose: it leads to signing back in.
  const held = useSessions();
  const holdsLogins = held.canHoldSeveral;
  const others =
    held.ready && holdsLogins
      ? held.sessions.filter((s) => !s.active && s.origin === currentBrainOrigin())
      : [];

  // Ends in a page load either way: on the next login held here, or on the
  // sign-in screen. The router is not used because a client navigation would
  // carry this login's cache into whoever comes next (sign-out.ts).
  async function signOut() {
    setBusy(true);
    await signOutActive();
  }

  async function switchTo(s: HeldSession) {
    if (!s.hasToken) {
      window.location.assign(signInAgainPath(s.id));
      return;
    }
    setBusy(true);
    const outcome = await switchSession(s.id);
    if (outcome === 'switched') return;
    setBusy(false);
    if (outcome === 'needs-sign-in') window.location.assign(signInAgainPath(s.id));
    else if (outcome === 'unreachable') toast.error('The brain did not answer. Nothing changed.');
    else toast.error('Could not switch to that login.');
  }

  // Every session this login holds ends, this one too: then the ordinary
  // sign-out clears what this tab kept. A 401 means this session had ended
  // already, so the ordinary sign-out is all that is left to do.
  async function signOutEverywhereNow() {
    setBusy(true);
    const outcome = await signOutEverywhere();
    if (outcome.kind === 'error') {
      setBusy(false);
      setEverywhereOpen(false);
      toast.error(outcome.message);
      return;
    }
    await signOut();
  }

  // photo → generated seed → initials, with each rung falling to the next:
  // ProfilePhoto steps down to `generated` itself when the bytes won't load
  // (storage down, token race on a detached first paint) — never a broken
  // image glyph in the rail.
  const generated = avatar ? (
    <GeneratedAvatar seed={avatar.seed} parts={avatar.parts} size={28} />
  ) : (
    <Avatar className="size-7">
      <AvatarFallback className="text-[10px] font-semibold">{initials}</AvatarFallback>
    </Avatar>
  );
  // The photo route is the settings area's: without it the face starts at
  // the generated rung.
  const face =
    photoVersion && manages ? (
      <ProfilePhoto version={photoVersion} size={28} fallback={generated} />
    ) : (
      generated
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <RowButton
          title={primary}
          data-tour="profile"
          aria-label={`Account: ${primary}`}
          className={cn(
            'flex items-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
            'hover:bg-foreground/[0.06] data-[state=open]:bg-foreground/[0.06]',
            variant === 'rail'
              ? 'w-full gap-2.5 px-2 py-1.5 text-left group-data-[nav-collapsed=true]/shell:justify-center group-data-[nav-collapsed=true]/shell:gap-0 group-data-[nav-collapsed=true]/shell:px-0'
              : 'gap-1 p-1',
          )}
        >
          <span className="shrink-0">{face}</span>
          {variant === 'rail' && (
            <>
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground group-data-[nav-collapsed=true]/shell:hidden">
                {primary}
              </span>
              <ChevronsUpDown
                className="size-3.5 shrink-0 text-muted-foreground group-data-[nav-collapsed=true]/shell:hidden"
                aria-hidden
              />
            </>
          )}
        </RowButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={variant === 'rail' ? 'start' : 'end'}
        side="bottom"
        className="w-56"
      >
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm font-medium text-foreground">{primary}</span>
          {/* Only when it adds something: with no display name set, the primary
              line already IS the email and repeating it is noise. */}
          {email && email !== primary && (
            <span className="block truncate text-xs text-muted-foreground">{email}</span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Search lives here rather than as its own rail row. It was a
            full-width button pretending to be a field, permanently occupying a
            column that has to hold the entire nav — and sitting a few pixels
            from the nav's real "Filter menu…" input, which is a different
            thing that looks the same. One of the two had to go, and the one
            with a keyboard shortcut is the one that can afford to.
            The chord stays visible: it is how anyone learns the shortcut
            exists, and after that they never open this menu for it again. */}
        {onSearchClick && (
          <DropdownMenuItem
            onClick={onSearchClick}
            className="cursor-pointer"
            aria-keyshortcuts="Meta+K Control+K"
          >
            <SearchIcon className="size-4" />
            <span className="flex-1">Search everywhere…</span>
            <DropdownMenuShortcut>{chord}</DropdownMenuShortcut>
          </DropdownMenuItem>
        )}

        {manages ? (
          <DropdownMenuItem asChild>
            <Link href="/settings/profile" onClick={onNavigate} className="cursor-pointer">
              <UserIcon className="size-4" /> Profile
            </Link>
          </DropdownMenuItem>
        ) : null}
        {/* The Profile screen holds the description; a login without it
            (a member) edits its own here. */}
        {!manages ? (
          <DropdownMenuItem onSelect={() => setDescriptionOpen(true)} className="cursor-pointer">
            <IdCard className="size-4" /> Your description
          </DropdownMenuItem>
        ) : null}
        {member ? (
          <DropdownMenuItem onSelect={() => setPasswordOpen(true)} className="cursor-pointer">
            <KeyRound className="size-4" /> Change password
          </DropdownMenuItem>
        ) : null}

        {/* Appearance lives here rather than as its own rail row: it is a
            once-a-month decision sitting permanently in a column that has to
            hold the whole nav. Submenus, not nested DropdownMenus — a menu
            inside a menu ITEM opens a second popup that the parent's own
            dismiss logic then fights. */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="cursor-pointer">
            <SunMoon className="size-4" /> Appearance
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              <ThemeModeItems />
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="cursor-pointer">
            <Dices className="size-4" />
            <span className="flex-1">Theme</span>
            {/* The name the rail's theme row used to carry, kept as the
                trigger's trailing text so the current palette is still legible
                without opening anything. */}
            <span className="ml-2 max-w-24 truncate text-xs text-muted-foreground">
              {themeLabel(colorTheme)}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className="w-52">
              <DropdownMenuLabel>Random theme</DropdownMenuLabel>
              <RandomThemeItems />
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        <DropdownMenuSeparator />

        {/* The logins this device holds. Plain anchors for the two links, not
            <Link>: adding a login ends in a page load, and the list screen is
            reached from a menu that has just closed over a sheet on mobile. */}
        {holdsLogins && (
          <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
            Switch login
          </DropdownMenuLabel>
        )}
        {others.map((s) => (
          <DropdownMenuItem
            key={s.id}
            disabled={busy}
            onClick={() => void switchTo(s)}
            className="cursor-pointer"
          >
            <Avatar className="size-5">
              <AvatarFallback className="text-[9px] font-semibold">
                {agentInitials(s.displayName?.trim() || s.email || 'M')}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">
                {s.displayName?.trim() || s.email || 'Login'}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {s.hasToken ? s.siteName?.trim() || s.email : 'Signed out. Sign in again'}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
        {holdsLogins && (
          <DropdownMenuItem asChild>
            <a href="/login?add=1" className="cursor-pointer">
              <Plus className="size-4" /> Add login…
            </a>
          </DropdownMenuItem>
        )}
        {/* /settings/sessions is the settings area's. */}
        {manages ? (
          <DropdownMenuItem asChild>
            <Link href="/settings/sessions" onClick={onNavigate} className="cursor-pointer">
              <KeyRound className="size-4" /> Manage logins…
            </Link>
          </DropdownMenuItem>
        ) : null}
        {holdsLogins || manages ? <DropdownMenuSeparator /> : null}

        <DropdownMenuItem
          onClick={signOut}
          disabled={busy}
          className="cursor-pointer text-destructive-ink focus:text-destructive-ink"
        >
          <LogOut className="size-4" />{' '}
          {busy ? 'Working…' : others.length > 0 ? 'Sign out of this login' : 'Sign out'}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => setEverywhereOpen(true)}
          disabled={busy}
          className="cursor-pointer"
        >
          <MonitorOff className="size-4" /> Sign out everywhere
        </DropdownMenuItem>
      </DropdownMenuContent>
      {/* Beside the menu content, not inside it: the dialog outlives the
          menu closing. The menu root renders no element of its own. */}
      {member ? <MemberPasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} /> : null}
      {!manages ? (
        <MemberDescriptionDialog open={descriptionOpen} onOpenChange={setDescriptionOpen} />
      ) : null}
      <AlertDialog open={everywhereOpen} onOpenChange={(o) => !busy && setEverywhereOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out everywhere?</AlertDialogTitle>
            <AlertDialogDescription>{EVERYWHERE_CONFIRM_TEXT}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void signOutEverywhereNow();
              }}
            >
              {busy ? 'Signing out…' : 'Sign out everywhere'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DropdownMenu>
  );
}
