'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { shellProbeFailure } from '@/lib/shell-probe';
import { goesToOnboarding, hasArea, shellAreasOf, shellRoleOf } from '@/lib/workspaces';
import { CreateWorkspaceSync } from '@/components/workspaces/create-workspace-sync';
import type { Shell } from '@mantle/client-types';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, upgradeOwnerCookie } from '@mantle/web-ui/api-fetch';
import { useColorTheme } from '@mantle/web-ui/color-theme-provider';
import { useFonts } from '@mantle/web-ui/font-provider';
import { COLOR_THEMES } from '@mantle/web-ui/lib/themes';
import { setAssetToken } from '@mantle/web-ui/asset-url';
import { assetTokenRefreshDelayMs } from '@mantle/web-ui/token-claims';
import { RailHandle } from '@mantle/web-ui/ui/rail-handle';
import {
  ACTIVITY_W_COOKIE,
  ACTIVITY_W_DEFAULT,
  NAV_W_COOKIE,
  NAV_W_DEFAULT,
  NAV_W_MAX,
  NAV_W_MIN,
} from '@/lib/nav-width';
import { recordActiveIdentity } from '@mantle/web-ui/session-registry';
import { refreshAllSessions } from '@mantle/web-ui/token-refresh';
import { AreaBackdrop } from '@mantle/web-ui/area-backdrop';
import { DriftSurface } from '@/components/drift-surface';
import { BrandBlock } from '@/components/layout/rail/brand-block';
import { RailControls } from '@/components/layout/rail/rail-controls';
import { RailToolbar } from '@/components/layout/rail/rail-toolbar';
import { MobileBar } from '@/components/layout/rail/mobile-bar';
import { SidebarNav } from '@/components/layout/sidebar-nav';
import { ChangelogLink } from '@/components/layout/changelog-link';
import { UpdateBanner } from '@/components/layout/update-banner';
import { ContractBanner } from '@/components/layout/contract-banner';
import { LiveColumn } from '@/components/layout/live-column';
import { Sheet, SheetContent, SheetTitle } from '@mantle/web-ui/ui/sheet';
import { ToastProvider } from '@mantle/web-ui/ui/toast';
import { PageTitleProvider } from '@/components/layout/page-title';
import { UploadProvider, UploadDock, useUploads } from '@/components/uploads/upload-provider';
import { AssistantDockProvider, useDockLayout } from '@/components/assistant/assistant-dock';
import { AssistantPanel } from '@/components/assistant/assistant-panel';
import { AssistantUnreadSync } from '@/components/assistant/use-assistant-unread';
import { HelpRailProvider, useHelpRail } from '@/components/help/help-rail-context';
import { HelpRail } from '@/components/help/help-rail';
import { TourProvider } from '@/components/tour/tour-provider';
import { TourOverlay } from '@/components/tour/tour-overlay';
import { PendingQuestionWatcher } from '@/components/pending/question-watcher';
import { DesktopBridge } from '@/components/desktop/desktop-bridge';
import { MessengerShell } from '@/components/messenger/messenger-shell';
import { ProviderAlertBanner } from '@/components/needs-you/provider-alert-banner';
import { PickMode } from '@/components/assistant/pick-mode';
import { ZenModeContext } from '@/components/layout/zen-mode';
import { SearchPalette } from '@/components/search/search-palette';
import { WorkspaceSwitcher } from '@/components/workspaces/workspace-switcher';
import { AreaGate } from '@/components/workspaces/area-gate';
import { ShellGate } from '@/components/layout/shell-screens';
import { clearOldRescues, loginKeyFor } from '@/lib/login-key';
import { noteRoute } from '@/lib/last-opened';
import { LastOpenedLoginProvider } from '@/components/last-opened/last-opened';

/**
 * App shell — TWO fixed regions, the left rail and the right live column,
 * framing a scrollable content area that runs the full height of the window.
 * The rail collapses into a Sheet drawer below md. The server-rendered
 * context+cost card is passed in as a prop.
 *
 * NO HEADER, NO FOOTER BAR. Both were full-width strips — 4rem and 2.75rem,
 * 108px of every screen at every window size — holding roughly a dozen
 * controls that each occupied a few hundred pixels of a bar spanning thousands.
 * They now live in the left rail (components/layout/rail/), which was already
 * on screen and had height to spare: identity at the top, account/theme/search
 * under it, the nav in the middle, the four launchers at the foot. The wider
 * the display, the better that trade gets, which is the whole reason for it.
 *
 * What survives across the top is `<MobileBar/>`, below md ONLY, where the rail
 * is a closed drawer and a phone would otherwise have no way to open it.
 *
 * Collapse: the left nav and right Activity column each collapse to an icon
 * rail. Their widths are published as the `--nav-w` / `--activity-w` CSS
 * variables on the shell root, which every framing element (rail, main,
 * FleetLayout, mail shell, live column) offsets against — so one state flip
 * reflows the whole shell. The top offset is the same idea in the other axis,
 * but it is breakpoint-dependent, so `--top-bar-h` is set in globals.css rather
 * than inline here. Collapsed state is also mirrored as
 * `data-{nav,activity}-collapsed` for descendants to restyle via
 * `group-data-[…]/shell:` (the mobile drawer portals outside this root, so
 * it always renders expanded). State is persisted to cookies and seeded
 * from them server-side (see layout.tsx) for a flash-free first paint.
 */

const NAV_COOKIE = 'mantle_nav_collapsed';
const ACTIVITY_COOKIE = 'mantle_activity_collapsed';

function writeCookie(name: string, on: boolean) {
  document.cookie = `${name}=${on ? '1' : '0'}; path=/; max-age=31536000; samesite=lax`;
}

function writeCookieValue(name: string, value: string | number) {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
}

/** GET /api/shell's answer: the brain's contract (`Shell`, @mantle/client-types). */
type ShellData = Shell;

/** The shell's avatar as the renderer takes it. The contract leaves the
 *  builder `parts` unknown: a map of part name to variant (or null) is kept,
 *  anything else reads as no parts. */
function avatarOf(a: Shell['avatar']) {
  if (!a) return null;
  const p = a.parts;
  const parts =
    p !== null &&
    typeof p === 'object' &&
    !Array.isArray(p) &&
    Object.values(p).every((v) => v === null || typeof v === 'string')
      ? (p as Record<string, string | null>)
      : null;
  return { style: a.style, seed: a.seed, parts };
}

/**
 * The shell, asked of the brain once (phase W5c: one shell for every login).
 * GET /api/shell answers every signed-in login; what it may manage comes
 * from its `areas`. A 401 is apiFetch's (on its way to /login); any other
 * failure is the failure card's (lib/shell-probe.ts).
 */
function useShell() {
  const shell = useQuery({
    queryKey: ['shell'],
    queryFn: () => apiFetch<ShellData>('/api/shell'),
    // This payload carries the asset token, and that token EXPIRES — it rides
    // in the URL, so the brain keeps its life short (two hours, "one working
    // session", for an Admin user; ten minutes for any other login, W7e: the
    // delay below then refreshes it every five). Nothing refreshed it: this
    // query ran once per mount, so a tab left open past lunch got a 401 on
    // every image, iframe and download until someone reloaded.
    //
    // The delay is read from the token's own `exp` rather than copied from the
    // brain's constant, so the two cannot drift; `false` when there is no token
    // (the ordinary same-origin box, where the session cookie does this job and
    // there is nothing to poll for).
    refetchInterval: (query) => assetTokenRefreshDelayMs(query.state.data?.assetToken),
    // Deliberately overriding the global `refetchOnWindowFocus: false`, for this
    // query only. An interval is not enough on its own: TanStack pauses it
    // while the tab is in the background, which is precisely the tab this bug
    // is about. Focus covers the one you came back to; the interval covers the
    // one that has been open in front of you for hours. It is one small
    // request, and it is the one carrying a credential with a hard expiry.
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const failure = shellProbeFailure({
    hasData: shell.data !== undefined,
    error: shell.error,
    // Offline: TanStack parks the query instead of failing it, so without
    // this the shell sat on Loading, with no way out, until the network came
    // back (the same trap build-card.tsx names).
    paused: shell.fetchStatus === 'paused',
  });
  return {
    data: shell.data,
    failure,
    retrying: shell.fetchStatus === 'fetching',
    retry: () => void shell.refetch(),
  };
}

export function AppShell(props: {
  contextCard: React.ReactNode;
  initialNavCollapsed?: boolean;
  /** Rail widths in px, seeded from cookies for the same no-flash reason. */
  initialNavWidth?: number;
  initialActivityWidth?: number;
  initialActivityCollapsed?: boolean;
  children: React.ReactNode;
}) {
  const { data, failure, retrying, retry } = useShell();
  // Providers only — the frame itself lives in <ShellFrame/>, which sits INSIDE
  // AssistantDockProvider and HelpRailProvider so it can read both dock states
  // (each open column publishes its width to the frame's CSS vars). None of it
  // mounts until the shell has answered: a neutral screen until then.
  return (
    <ShellGate ready={data !== undefined} failure={failure} retrying={retrying} onRetry={retry}>
      {data !== undefined ? (
        <ToastProvider>
          <PageTitleProvider>
            <UploadProvider>
              <AssistantDockProvider>
                <HelpRailProvider>
                  <TourProvider>
                    <ShellFrame {...props} shell={data} />
                  </TourProvider>
                </HelpRailProvider>
              </AssistantDockProvider>
            </UploadProvider>
          </PageTitleProvider>
        </ToastProvider>
      ) : null}
    </ShellGate>
  );
}

function ShellFrame({
  contextCard,
  shell,
  initialNavCollapsed = false,
  initialNavWidth = NAV_W_DEFAULT,
  initialActivityWidth = ACTIVITY_W_DEFAULT,
  initialActivityCollapsed = true,
  children,
}: {
  contextCard: React.ReactNode;
  /** GET /api/shell's answer: the gate renders the frame for nothing else. */
  shell: ShellData;
  initialNavCollapsed?: boolean;
  initialNavWidth?: number;
  initialActivityWidth?: number;
  initialActivityCollapsed?: boolean;
  children: React.ReactNode;
}) {
  // Every login runs in this one shell (phase W5c). The owner chrome (usage
  // card, update and provider banners, the activity column, the question
  // watcher, the search palette) needs the settings area: without
  // it each would only collect 403s. A brain that names no areas leaves them
  // all on. The role (the brain's) picks only the assistant: the owner one
  // for an admin, a member's own chat for a member, none for a client, until
  // phase W7.
  const manages = hasArea(shellAreasOf(shell), 'settings');
  const role = shellRoleOf(shell);
  // Every login reads bytes on the owner routes, in its own scope (W7e):
  // no path map, the asset token signs them cross-origin.
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(initialNavCollapsed);
  // Seeded from a cookie (like the collapse flags) rather than localStorage, so
  // the server renders the user's width and the rail doesn't jump on load.
  const [navWidth, setNavWidth] = useState(initialNavWidth);
  // True for the duration of a resize, by pointer OR keyboard. Published as
  // `data-resizing` on the shell root, where one CSS rule suspends transitions
  // across the frame — see the long note beside it in globals.css. Without it
  // every element that reads `--nav-w` freezes mid-drag.
  const [resizing, setResizing] = useState(false);
  const resizeIdle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [activityWidth, setActivityWidth] = useState(initialActivityWidth);

  // Suspend the frame's width transitions for the length of a POINTER drag.
  // `applyRailWidth` below covers the keyboard, where every press commits — but
  // a pointer drag now commits only on release, so without this the ease would
  // be live for the whole drag and the rail would trail the pointer by 200ms.
  // Only the grab edge is wired: the release is left to the idle timer, which
  // has to outlast the commit anyway.
  const startRailDrag = (on: boolean) => {
    if (on) setResizing(true);
  };

  // Shared by both rails. Restores the transition once the user stops, so a
  // later collapse still glides.
  const applyRailWidth = (px: number, set: (px: number) => void, cookie: string) => {
    setResizing(true);
    set(px);
    writeCookieValue(cookie, px);
    if (resizeIdle.current) clearTimeout(resizeIdle.current);
    resizeIdle.current = setTimeout(() => setResizing(false), 250);
  };
  const [activityCollapsed, setActivityCollapsed] = useState(initialActivityCollapsed);
  const pathname = usePathname();
  const router = useRouter();

  // The docked assistant column's width, published as `--assistant-w` so <main>
  // (and the bottom-right dock stack) shrink beside the open column. 0 whenever
  // the panel is minimised/closed or rendering as a full overlay.
  // The width is the reader's now (dragged by the handle on the column's inner
  // edge, kept in localStorage by the dock) rather than a hard-coded 30rem.
  const {
    panel: assistantPanel,
    docked: assistantDocked,
    dockWidth,
    dockResizing,
  } = useDockLayout();
  const assistantW = assistantPanel === 'open' && assistantDocked ? `${dockWidth}px` : '0rem';
  // The help column's width, published as `--help-w` so <main> shrinks beside it
  // exactly as it does for the assistant. 0 whenever the rail is closed.
  const { open: helpOpen } = useHelpRail();
  const helpW = helpOpen ? '22rem' : '0rem';

  // The member autosave copies kept before W6b are private drafts at rest
  // that nothing sends any more: they go at boot.
  useEffect(() => {
    clearOldRescues();
  }, []);
  const loginKey = loginKeyFor(shell);
  // The route before this one, for the workspace sections' "open the last
  // item" restore (lib/last-opened.ts): back to a section's list from one of
  // its own items is a trip to the list, not an entry.
  useEffect(() => {
    noteRoute(pathname);
  }, [pathname]);
  // What the chrome shows (brand, identity, theme, fonts, asset token).
  const brand = shell;
  const userAvatar = avatarOf(brand.avatar);
  // Hand the uploader the server's cap as soon as it is known, so an oversized
  // file is refused before a byte is sent, with the real number in the message.
  const { setMaxUploadBytes } = useUploads();
  const maxUploadBytes = shell.maxUploadBytes ?? null;
  useEffect(() => {
    setMaxUploadBytes(maxUploadBytes);
  }, [maxUploadBytes, setMaxUploadBytes]);
  const pendingApprovals = shell.pendingApprovals ?? 0;

  // First-run gate: a logged-in but not-yet-onboarded admin goes to the
  // wizard (outside the (app) group). Only a login with the settings area: the
  // wizard sends any other login home, so sending it there would loop.
  // Moved here from the server layout so the shell makes no in-process DB read.
  const toOnboarding = goesToOnboarding(shell);
  useEffect(() => {
    if (toOnboarding) router.replace('/onboarding');
  }, [toOnboarding, router]);

  // Colour-theme sync: the DB copy is the cross-browser source of truth; the
  // localStorage the pre-paint script read is only this browser's cache. Adopt
  // the server value once per shell load (a later local change wins the session
  // and writes itself back through the provider). Unknown ids — a theme removed
  // from the list — are ignored rather than applied.
  const { colorTheme: activeColorTheme, adoptServerTheme } = useColorTheme();
  const adoptedTheme = useRef(false);
  useEffect(() => {
    if (adoptedTheme.current) return;
    const stored = brand.colorTheme;
    adoptedTheme.current = true;
    if (!stored || stored === activeColorTheme) return;
    if (!COLOR_THEMES.some((t) => t.id === stored)) return;
    adoptServerTheme(stored);
  }, [brand, activeColorTheme, adoptServerTheme]);

  // Font sync — same shape as the colour theme: adopt the DB choices once per
  // shell load, reconciling to the cross-browser source of truth in case another
  // browser changed the brand mid-session. Unknown and absent keys are ignored
  // inside adoptServerFonts, so a slot the server has never stored keeps
  // whatever the server-rendered document already painted.
  const { adoptServerFonts } = useFonts();
  const adoptedFonts = useRef(false);
  useEffect(() => {
    if (adoptedFonts.current) return;
    adoptedFonts.current = true;
    adoptServerFonts(
      {
        logo: brand.fontLogo ?? null,
        title: brand.fontTitle ?? null,
        ui: brand.fontUi ?? null,
        prose: brand.fontProse ?? null,
      },
      {
        ui: brand.fontSize ?? null,
        logo: brand.fontLogoSize ?? null,
        title: brand.fontTitleSize ?? null,
        prose: brand.fontProseSize ?? null,
      },
    );
  }, [brand, adoptServerFonts]);

  // Publish the asset-access token so `assetUrl()` can sign browser-native srcs
  // (<img>/<iframe>/download) for a detached client. No-op same-origin.
  useEffect(() => {
    setAssetToken(brand.assetToken);
  }, [brand.assetToken]);

  // Same-origin bearer→cookie upgrade, once per shell load. Owners signed in
  // before the origin predicate was fixed hold ONLY a localStorage bearer, and
  // same-origin <img>/<iframe>/download srcs authenticate by COOKIE — they
  // can't carry a header. Fired here (not awaited) because the shell mounts
  // before any asset-bearing screen. No-op cross-origin and for cookie
  // sessions. See upgradeOwnerCookie.
  useEffect(() => {
    void upgradeOwnerCookie();
  }, []);

  // Bearer upkeep, piggybacked on the shell boot round-trip: every login held
  // on this device is rotated when <7d from expiry, and the active one learns
  // who its shell says it is (a bearer held from before sessions existed has
  // no email until now). No-op for a cookie-only login, which holds no bearer.
  // See @mantle/web-ui/token-refresh and session-registry.
  useEffect(() => {
    recordActiveIdentity({
      email: brand.email,
      displayName: brand.displayName,
      siteName: brand.siteName,
    });
    void refreshAllSessions();
  }, [brand]);

  // Close the drawer on navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Distraction-free ("focus") mode — hides all four chrome regions and gives
  // the content the whole viewport. Ephemeral by design (no cookie); the
  // floating exit button below is the way back.
  const [zen, setZen] = useState(false);
  const zenCtx = useMemo(() => ({ zen, toggle: () => setZen((v) => !v) }), [zen]);

  // Leaving the SECTION leaves focus mode: a screen without the item header
  // has no way OUT, so arriving there with the chrome hidden would be a trap.
  // Within a section it stays (item header contract, 2026-10-21): reading one
  // page after another, or opening one in the editor (`/pages` to
  // `/pages/<id>`), keeps the folders hidden until Focus, the back link or
  // Esc brings them back.
  const section = pathname.split('/')[1] ?? '';
  useEffect(() => {
    setZen(false);
  }, [section]);

  // Esc leaves focus mode (item header contract, 2026-10-21), as the header's
  // back link does. Not while something else owns Esc: an open dialog, menu
  // or popover closes first, and typing in a field or the editor keeps it.
  useEffect(() => {
    if (!zen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) {
        return;
      }
      if (document.querySelector('[role="dialog"], [role="menu"], [role="alertdialog"]')) return;
      setZen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zen]);

  const toggleNav = () =>
    setNavCollapsed((v) => {
      writeCookie(NAV_COOKIE, !v);
      return !v;
    });
  const toggleActivity = () =>
    setActivityCollapsed((v) => {
      writeCookie(ACTIVITY_COOKIE, !v);
      return !v;
    });

  // Keyboard shortcuts: ⌘/Ctrl+B toggles the nav, ⌘/Ctrl+J toggles Activity,
  // ⌘/Ctrl+K opens the search palette. Skipped while typing / editing so ⌘B
  // still bolds in the page editor and we don't steal keystrokes from inputs
  // (⌘K can still CLOSE the open palette — its own input would otherwise
  // swallow the toggle). (setState setters are stable, so the listener is
  // registered once.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k !== 'b' && k !== 'j' && k !== 'k') return;
      const t = e.target as HTMLElement | null;
      const typing =
        t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
      if (k === 'k') {
        if (!manages) return; // no palette: brain search is the settings area's
        // Toggle from anywhere except a real editor/input — unless the input is
        // the palette's own, where ⌘K should still close it.
        if (typing && !t.closest('[data-slot=command-input-wrapper]')) return;
        e.preventDefault();
        setSearchOpen((v) => !v);
        return;
      }
      if (typing) return;
      e.preventDefault();
      if (k === 'b') {
        setNavCollapsed((v) => {
          writeCookie(NAV_COOKIE, !v);
          return !v;
        });
      } else {
        setActivityCollapsed((v) => {
          writeCookie(ACTIVITY_COOKIE, !v);
          return !v;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [manages]);

  // Who the profile row names. Undefined until /api/shell lands, at which point
  // the row fills in — it renders a neutral "Signed in" in the meantime rather
  // than reserving an empty slot.
  const identity = {
    displayName: brand.displayName ?? null,
    email: brand.email ?? null,
    avatar: userAvatar,
    photoVersion: brand.avatarPhotoVersion ?? null,
  };

  /**
   * The rail's contents, shared by the desktop aside and the mobile drawer.
   *
   * Three bands: pinned identity + controls at the top, ONE scroll region in
   * the middle (the nav is the only part long enough to need it, and a rail
   * that scrolls its own brand away loses the thing that tells you where you
   * are), then the pinned toolbar. `min-h-0` on the scroller is what stops the
   * flex column from growing past the viewport and taking the toolbar with it.
   */
  const body = (onNavigate?: () => void, collapsed = false, inDrawer = false) => (
    <>
      <BrandBlock
        siteName={brand.siteName ?? null}
        peerName={brand.peerName ?? null}
        logoVersion={brand.logoVersion ?? null}
        logoDarkVersion={brand.logoDarkVersion ?? null}
        inDrawer={inDrawer}
        onNavigate={onNavigate}
      />
      <RailControls
        identity={identity}
        onSearchClick={
          manages
            ? () => {
                onNavigate?.();
                setSearchOpen(true);
              }
            : undefined
        }
        onNavigate={onNavigate}
        // The switcher renders nothing for a brain that sends no workspaces.
        switcher={<WorkspaceSwitcher onNavigate={onNavigate} />}
      />

      {/* `relative` is load-bearing: the menu backdrop is absolutely positioned
          and would otherwise paint OVER this in-flow content regardless of DOM
          order. Same reason the brand block and the toolbar carry it. */}
      <div className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
        {manages ? contextCard : null}
        {/* Above the update chip: incompatibility explains WHY things are
            failing right now, an available update is merely nice to have. */}
        <ContractBanner onNavigate={onNavigate} />
        {/* The owner banners: the settings area's (their routes refuse
            anyone else). */}
        {manages ? <UpdateBanner onNavigate={onNavigate} /> : null}
        {/* Embeddings or extraction failing (no credits, a refused key):
            red, above what waits, because the brain is degraded now. */}
        {manages ? <ProviderAlertBanner onNavigate={onNavigate} /> : null}
        <SidebarNav
          pendingApprovals={pendingApprovals}
          onNavigate={onNavigate}
          collapsed={collapsed}
        />
        <ChangelogLink onNavigate={onNavigate} />
      </div>

      <RailToolbar
        navCollapsed={navCollapsed}
        onToggleNav={toggleNav}
        showCollapse={!inDrawer}
        // The launchers open surfaces that live BEHIND the modal drawer
        // (assistant z-20, help z-20, pick-mode z-40 vs the Sheet's z-50), so
        // in the drawer every toolbar tap must also close it or the tap
        // appears dead. Not wired to navigation like the other bands' —
        // launchers don't navigate — hence its own prop.
        onLaunch={onNavigate}
      />
    </>
  );

  return (
    <ZenModeContext.Provider value={zenCtx}>
      <div
        // `mantle-shell` is the hook for `--top-bar-h` (globals.css): the top
        // offset is breakpoint-dependent, so unlike the widths below it cannot
        // be an inline style.
        className="mantle-shell group/shell h-screen bg-background"
        data-nav-collapsed={navCollapsed ? 'true' : 'false'}
        // The assistant column drags too, and `--assistant-w` is on the same
        // transition list as the rails — so its drag has to suspend the ease
        // for the whole frame just as theirs does.
        data-resizing={resizing || dockResizing ? 'true' : 'false'}
        data-activity-collapsed={activityCollapsed ? 'true' : 'false'}
        data-zen={zen ? 'true' : 'false'}
        style={
          {
            // Focus mode zeroes every chrome offset — the SAME vars the whole
            // frame already positions against, so one flip reflows everything.
            // Collapsed and zen keep their fixed widths: the handle is only
            // offered on the expanded rail, so a drag can never fight a toggle.
            '--nav-w': zen ? '0px' : navCollapsed ? '3.5rem' : `${navWidth}px`,
            '--activity-w':
              zen || !manages ? '0px' : activityCollapsed ? '3.5rem' : `${activityWidth}px`,
            '--assistant-w': assistantW,
            '--help-w': helpW,
          } as React.CSSProperties
        }
      >
        {/* Below md only — see <MobileBar/>. Wide screens have no top chrome. */}
        {zen ? null : (
          <MobileBar
            identity={identity}
            siteName={brand.siteName ?? null}
            logoVersion={brand.logoVersion ?? null}
            logoDarkVersion={brand.logoDarkVersion ?? null}
            onMenuClick={() => setMobileOpen(true)}
            onSearchClick={manages ? () => setSearchOpen(true) : undefined}
            switcher={<WorkspaceSwitcher variant="bar" />}
          />
        )}

        {/* Global search palette — one instance for the whole shell, summoned by
            ⌘K or the header magnifier. */}
        {manages ? <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} /> : null}

        {/* The rail. Full window height now that nothing brackets it: it owns
            the brand, the account/theme/search controls, the nav and the
            launcher toolbar. Unmounted in focus mode. */}
        {/* No `transition-[width]` on the aside: `--nav-w` animates instead
            (globals.css). A transition here would freeze it against the var. */}
        {zen ? null : (
          <aside className="fixed inset-y-0 left-0 z-30 hidden w-[var(--nav-w)] flex-col border-r bg-sidebar md:flex">
            {/* Generated backdrop for this area — renders nothing when Settings →
              Appearance has the menu switched off. See
              @mantle/web-ui/area-backdrop. */}
            <AreaBackdrop area="menu" />
            {body(undefined, navCollapsed)}
            {/* Collapsed rails aren't draggable: the toggle owns that width. */}
            {navCollapsed ? null : (
              <RailHandle
                label="Resize navigation"
                value={navWidth}
                min={NAV_W_MIN}
                max={NAV_W_MAX}
                onChange={(px) => applyRailWidth(px, setNavWidth, NAV_W_COOKIE)}
                // The drag writes `--nav-w` on this shell root directly and
                // reports once, on release. `onChange` used to fire per
                // pointermove, and it lands in state here — a re-render of the
                // whole frame per move.
                liveVar="--nav-w"
                onDraggingChange={startRailDrag}
              />
            )}
          </aside>
        )}

        {/* Mobile rail drawer — portaled outside the shell root, so it always
            renders expanded regardless of collapse state. Same three bands as
            the aside, so a phone gets every control a desktop has; `flex-col`
            + the body's own `min-h-0` scroller keep the toolbar pinned to the
            bottom of the sheet instead of scrolling away with the nav. */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          {/* `gap-0`: the sheet variant's base carries `gap-4`, which was inert
              while this was a block container and became LIVE when the drawer
              went `flex flex-col` — 1rem background seams between bands the
              desktop aside doesn't have. */}
          <SheetContent side="left" className="flex w-80 flex-col gap-0 p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            {body(() => setMobileOpen(false), false, true)}
          </SheetContent>
        </Sheet>

        {/* Right live-activity column (the settings area's: it polls the
            brain's activity) */}
        {zen || !manages ? null : (
          <LiveColumn
            collapsed={activityCollapsed}
            onToggle={toggleActivity}
            width={activityWidth}
            onWidthChange={(px) => applyRailWidth(px, setActivityWidth, ACTIVITY_W_COOKIE)}
            onWidthDraggingChange={startRailDrag}
          />
        )}

        {/* Content area — now the full height of the window at md and up, which
            is what removing the two bars bought.

            Own Suspense boundary: a page (children) that suspends during SSR
            would otherwise bubble to the route boundary, wrapping the whole
            shell — chrome included — in a streaming boundary that's absent at
            client hydration, which shifts every radix `useId` in that chrome
            and trips a hydration-id mismatch (intermittent: only when the
            server is slow enough to stream). Containing it here, beside the
            chrome rather than around it, keeps the chrome's tree-context
            symmetric. Same rationale as UsageCard's boundary in layout.tsx. */}
        {/* The saved Drift background, pinned to the SAME box as <main> below —
            a sibling rather than a child, because <main> scrolls and an
            absolute child would scroll away with the content. Earlier in DOM
            order, so the (also positioned) main and chrome paint over it. */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 top-[var(--top-bar-h)] md:left-[var(--nav-w)] lg:right-[calc(var(--activity-w)+var(--assistant-w)+var(--help-w))]"
        >
          <DriftSurface />
        </div>

        {/* No `transition-[left,right]` — see the aside above and globals.css. */}
        <main
          data-tour="main"
          className="fixed inset-0 top-[var(--top-bar-h)] overflow-y-auto scrollbar-thin md:left-[var(--nav-w)] lg:right-[calc(var(--activity-w)+var(--assistant-w)+var(--help-w))]"
        >
          <Suspense fallback={null}>
            <LastOpenedLoginProvider login={loginKey}>
              {/* One check for every screen: a typed link to a screen this
                  login may not manage says so, not a screen of 403s. */}
              <AreaGate>{children}</AreaGate>
            </LastOpenedLoginProvider>
          </Suspense>
        </main>

        {/* The full assistant as a content-area overlay — fills the same box as
            <main>, above every route, summoned from anywhere by the bubble/⌘I.
            A member chats in the same assistant, on its own threads (W7c), and
            its unread count follows its thread stream; a client has no chat
            yet. */}
        {role === 'admin' || role === 'member' ? <AssistantPanel /> : null}
        {role === 'member' ? <AssistantUnreadSync /> : null}
        {/* The messenger's one live connection, its toasts and the desktop
            badge (Messenger V1 Phase 2); nothing on a brain without it. */}
        {role === 'admin' || role === 'member' ? <MessengerShell /> : null}
        {/* Help reads the owner help route: an admin's in W5c. */}
        {role === 'admin' ? <HelpRail /> : null}

        {/* The guided tour — a spotlight and a card above everything, only
            when a tour is running (MANTLE_TOUR once per browser, or ?tour=).
            See components/tour. */}
        <TourOverlay />

        {/* Marker pick mode: highlights markable rows + intercepts their clicks
            while picking; renders nothing otherwise. It hands to the owner
            assistant: an admin's. */}
        {role === 'admin' ? <PickMode /> : null}

        {/* Headless: toasts a blocked run's question the moment it arrives, with
            an "Answer" action that opens the assistant. Renders nothing. */}
        {manages ? <PendingQuestionWatcher /> : null}
        <DesktopBridge />
        {/* A create names the switcher's workspace (W6b). */}
        <CreateWorkspaceSync />

        {/* Upload dock — floats in the bottom-right corner of the content area,
            which now runs to the bottom of the window. Inside the shell so it
            inherits --activity-w (sits left of the activity rail) and persists
            across route changes. pointer-events-none lets clicks fall through the
            gaps; the dock re-enables its own. */}
        <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex w-96 max-w-[calc(100vw-2rem)] flex-col items-stretch gap-3 lg:right-[calc(var(--activity-w)+var(--assistant-w)+1rem)]">
          <UploadDock />
        </div>
      </div>
    </ZenModeContext.Provider>
  );
}
