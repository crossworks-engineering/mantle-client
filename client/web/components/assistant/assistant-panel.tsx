'use client';

import { useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { cn } from '@mantle/web-ui/lib/utils';
import { RailHandle } from '@mantle/web-ui/ui/rail-handle';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { useAssistantDock } from './assistant-dock';
import { ASSISTANT_W_MAX, ASSISTANT_W_MIN } from '@/lib/nav-width';
import { isWide, stepsAsideOnRoute } from './window-view';

/** The Chats window (list, rooms, the assistant thread) behind a dynamic import.
 *
 *  This one import is the app's largest single lever: the thread pulls
 *  `assistant-client`, which pulls `rich-text`, which pulls the whole page-
 *  editor extension set — TipTap and ProseMirror, KaTeX, lowlight's ~37
 *  grammars — plus react-markdown and marked. Imported statically it rode the
 *  shell onto EVERY signed-in route, about 1.3 MB of a 1.9 MB fixed cost, for a
 *  panel most loads never open. Same shape the help rail uses, for the same
 *  reason (`components/help/help-rail.tsx`).
 *
 *  `ssr: false` because it is client-only anyway and there is nothing to
 *  pre-render behind a `hidden` panel. */
const WindowChats = dynamic(() => import('./window-chats').then((m) => m.WindowChats), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <Spinner />
    </div>
  ),
});

/** Keyboard resize steps for the window's corner grip. There is deliberately no
 *  minimum here: `setPopout` runs every value through the dock's `clampPopout`,
 *  which owns the floor and the viewport cap for the pointer drag too — so the
 *  two ways of sizing the window cannot reach different places, and a second
 *  copy of those numbers cannot drift from the first. */
const POPOUT_KEY_STEP = 16;
const POPOUT_KEY_STEP_COARSE = 64;

/** Where a window that has never been placed opens: inset from the bottom-right
 *  of the viewport, clear of the activity rail, at a size that fits a laptop. */
function firstPlacement() {
  const w = Math.min(560, Math.max(360, window.innerWidth - 160));
  const h = Math.min(640, Math.max(320, window.innerHeight - 160));
  return { w, h, x: window.innerWidth - w - 96, y: window.innerHeight - h - 64 };
}

/**
 * The full assistant, in one of three shapes — picked by the switcher in its
 * own header, and remembered, so recalling the assistant brings back the shape
 * and the place you left it in:
 *
 *  - **Docked column** (default, lg+): a right-hand column between the content
 *    and the activity rail, with `<main>` shrinking beside it (the shell
 *    publishes `--assistant-w`) — so the screen stays visible and interactive
 *    while you chat. On editor surfaces that means gutter marks, live edits and
 *    review highlights are seen as they happen. Draggable by the `RailHandle`
 *    on its inner edge, the same grip the nav and activity rails use.
 *
 *  - **Window** (lg+): a plain floating window. Move it by its header, size it
 *    by the corner grip. Nothing behind it is covered permanently and nothing
 *    reflows around it, which is the point — it is for reading a reply beside
 *    something the column would have pushed out of the way.
 *
 *  - **Overlay**: fills the same inset box as the shell's `<main>`, so it reads
 *    like any other screen rather than a floating window. This is also the
 *    fallback below lg, where neither a column nor a window has room: the two
 *    lg-only shapes simply do not apply and the base geometry stands.
 *
 * It is NOT mounted until first opened. It used to be — hidden via display:none
 * from page load — which bought three things, and only one of them was really
 * paid for by the mount:
 *
 *  - *A marker selection always has somewhere to land.* Still true, and never
 *    depended on this component: `useSurfaceAssist` writes pinned context,
 *    directives and selection into `AssistantDockProvider`, which is mounted by
 *    the shell and stays. The panel only ever read that state.
 *  - *Opening is instant.* Preserved by prefetching the chunk at idle below,
 *    which downloads the code without mounting a thing.
 *  - *The thread warms immediately.* This one genuinely goes: the transcript is
 *    now fetched when the panel first opens rather than on every page load.
 *    That is the trade, and it is the point — on a load where nobody opens the
 *    assistant, we were fetching a thread, a profile, polling runs every five
 *    seconds and building one ProseMirror editor per turn, all behind
 *    display:none.
 *
 * Once opened it stays mounted, so the transcript, scroll position, composer
 * draft, and any live turn stream survive a minimise/restore — or a change of
 * shape — without a re-fetch. `Esc` minimises.
 */
export function AssistantPanel() {
  const {
    panel,
    everOpened,
    minimize,
    display,
    dockWidth,
    setDockWidth,
    popout,
    setPopout,
    startPopoutResize,
    setDockResizing,
    popoutElRef,
  } = useAssistantDock();
  // One ref, two jobs, both needing this exact node: the column handle measures
  // the new width from its right edge (the column is inset by the activity
  // rail, so the viewport-edge maths every shell rail uses would hand it a
  // width one whole rail too big), and a window drag writes its CSS variables
  // straight to it. It lives in the context because the drag handlers do.
  const panelRef = popoutElRef;

  // Focus follows the panel: in when it opens, back to whatever opened it when
  // it closes. The second half is not a nicety — the container carries
  // `aria-hidden` while minimised, and leaving the user's focus inside an
  // aria-hidden subtree is the one state a screen reader cannot describe: the
  // focused thing officially is not there.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (panel === 'open') {
      // Once per opening. `??=` matters because this re-runs the moment
      // `everOpened` latches, and without it the second pass would record the
      // panel itself as the place to return to.
      returnFocusRef.current ??= document.activeElement as HTMLElement | null;
      // The node does not exist until `everOpened` has flipped and the early
      // return below has stopped firing, which is a render later than this
      // effect's first run.
      if (everOpened) panelRef.current?.focus();
      return;
    }
    const back = returnFocusRef.current;
    returnFocusRef.current = null;
    // Only if it is still on the page — a turn can navigate away from the
    // screen that owned the opener.
    if (back && document.contains(back)) back.focus();
  }, [panel, everOpened, panelRef]);

  // Esc minimises while open.
  useEffect(() => {
    if (panel !== 'open') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // An open menu, picker or popover (the header's "..." menu, the agent
        // picker) takes Escape first: closing it must not also minimise the
        // panel. Radix closes its layer on this same keydown, later.
        if (document.querySelector('[data-radix-popper-content-wrapper]')) return;
        // A part inside took this Escape already (the mention list, a
        // search, an edit, the details overlay).
        if (e.defaultPrevented) return;
        // The column and the window sit beside a screen that is in use: an
        // Escape in a part of that screen belongs to it. From the window, or
        // with nothing focused (the page body), it minimises. A shape that
        // covers the screen (the rule a route change uses) minimises from
        // anywhere.
        const at = document.activeElement;
        const onScreenPart = !!at && at !== document.body && !panelRef.current?.contains(at);
        if (onScreenPart && !stepsAsideOnRoute(display, isWide())) return;
        e.preventDefault();
        minimize();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel, minimize, display, panelRef]);

  // A window that has never been placed needs a first box, and that needs a
  // viewport — so it is resolved on the first switch to the window, not while
  // rendering (where there is no window on the server).
  useEffect(() => {
    if (display === 'popout' && !popout) setPopout(firstPlacement());
  }, [display, popout, setPopout]);

  // Warm the chunk once the browser is idle, so the first open is instant even
  // though nothing mounted at load. This downloads and evaluates the module —
  // it does NOT mount the thread, so no thread fetch, no profile fetch, no runs
  // poll and no editors. requestIdleCallback is not everywhere (Safari got it
  // in 16.4), hence the timeout fallback; both are cancelled on unmount so a
  // fast navigation away does not leave work queued.
  useEffect(() => {
    if (everOpened) return;
    const warm = () => void import('./window-chats');
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 4000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(warm, 2000);
    return () => window.clearTimeout(id);
  }, [everOpened]);

  // Never mounted until the first open. Every hook above runs regardless, so
  // Esc handling and window placement are wired the moment the panel exists.
  if (!everOpened) return null;

  const isWindow = display === 'popout' && popout !== null;

  return (
    <div
      ref={panelRef}
      // The agent's picture of the work area leaves the panel out
      // (lib/agent-ui/look.ts).
      data-assistant-panel=""
      className={cn(
        'fixed inset-x-0 bottom-0 top-[var(--top-bar-h)] z-20 bg-background md:left-[var(--nav-w)] lg:right-[var(--activity-w)]',
        // Column: a right column beside the visible editor (lg+ only — below lg
        // the overlay geometry above still applies).
        display === 'docked' &&
          'lg:left-auto lg:w-[var(--assistant-w)] lg:border-l lg:border-border',
        // Window: the box comes in as CSS variables rather than inline
        // left/top/width/height, so it can be scoped to `lg:` like everything
        // else here. An inline style would beat the media query and drag the
        // window geometry down onto phones, where there is no room for it.
        isWindow &&
          'lg:inset-auto lg:left-[var(--popout-x)] lg:top-[var(--popout-y)] lg:h-[var(--popout-h)] lg:w-[var(--popout-w)] lg:z-30 lg:overflow-hidden lg:rounded-lg lg:border lg:border-border lg:shadow-lg',
        panel !== 'open' && 'hidden',
      )}
      style={
        isWindow
          ? ({
              '--popout-x': `${popout.x}px`,
              '--popout-y': `${popout.y}px`,
              '--popout-w': `${popout.w}px`,
              '--popout-h': `${popout.h}px`,
            } as React.CSSProperties)
          : undefined
      }
      aria-hidden={panel !== 'open'}
      // A floating window IS a dialog, and a non-modal one: the rest of the app
      // stays reachable behind it, which is the whole point of a popout. The
      // docked column is not a dialog and gets no role — it is a panel beside
      // the content, not something layered over it.
      role={isWindow ? 'dialog' : undefined}
      aria-modal={isWindow ? false : undefined}
      aria-label={isWindow ? 'Chats' : undefined}
      // The landing spot for the focus move above. -1 so it takes focus
      // programmatically without joining the tab order.
      tabIndex={-1}
    >
      {/* Only the column has a width to drag: the overlay is sized by the
          shell's own offsets, and below lg the column geometry does not apply,
          so the handle is hidden there rather than dragging a width nothing
          reads. */}
      {display === 'docked' && (
        <RailHandle
          label="Resize assistant"
          side="left"
          value={dockWidth}
          min={ASSISTANT_W_MIN}
          max={ASSISTANT_W_MAX}
          onChange={setDockWidth}
          // Same as the two shell rails: the drag writes `--assistant-w` on the
          // shell root and commits once, on release. Without it every move went
          // through the dock context, which fans out to fourteen consumers —
          // the shell frame among them.
          liveVar="--assistant-w"
          // Suspends the frame's 200ms width ease for the length of the drag,
          // exactly as the nav and activity rails do.
          onDraggingChange={setDockResizing}
          boundsRef={panelRef}
          className="hidden lg:block"
        />
      )}

      <WindowChats />

      {/* The window's size grip. Bottom-right, the corner every desktop window
          is sized from, and drawn at rest like every other draggable edge in
          the frame (style guide §8) rather than appearing on hover. */}
      {isWindow && (
        <div
          role="separator"
          aria-label="Resize assistant window"
          aria-orientation="horizontal"
          tabIndex={0}
          onPointerDown={startPopoutResize}
          // A `separator` a keyboard cannot operate is a role that lies. The
          // arrows size the window from the same corner the pointer drags,
          // which is why both axes move together; Shift is the coarse step, the
          // way the shell's rail handles already behave.
          onKeyDown={(e) => {
            if (!popout) return;
            const step = e.shiftKey ? POPOUT_KEY_STEP_COARSE : POPOUT_KEY_STEP;
            const dw = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
            const dh = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
            if (!dw && !dh) return;
            e.preventDefault();
            setPopout({ ...popout, w: popout.w + dw, h: popout.h + dh });
          }}
          className="absolute bottom-0 right-0 hidden size-4 cursor-nwse-resize touch-none items-end justify-end p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:flex"
        >
          <span aria-hidden className="size-2.5 rounded-xs border-b-2 border-r-2 border-border" />
        </div>
      )}
    </div>
  );
}
