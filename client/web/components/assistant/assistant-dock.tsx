'use client';

import {
  claimTurn,
  endAgentTurn,
  handleUiCall,
  loadAgentUiSetting,
  withWindowId,
} from '@/lib/agent-ui/turn-calls';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePathname } from 'next/navigation';
import {
  HelpCircle,
  Loader2,
  Maximize2,
  PanelRight,
  PictureInPicture2,
  Sparkles,
} from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@mantle/web-ui/ui/toggle-group';
import { cn } from '@mantle/web-ui/lib/utils';
import { readPref, writePref } from '@mantle/web-ui/ui-prefs';
import {
  apiEventStream,
  apiFetch,
  apiUrl,
  bounceToLogin,
  isAuthFailure,
  withAuth,
} from '@mantle/web-ui/api-fetch';
import { usePendingQuestions } from '@/components/pending/use-pending-questions';
import { useIsAdminUser, useViewerAreas } from '@/components/workspaces/use-shell-workspaces';
import { chatFeatures, turnRefusalText } from '@/lib/assistant-turn-refusal';
import { useAssistantUnreadCount } from './use-assistant-unread';
import { ASSISTANT_W_DEFAULT, clampAssistantWidth } from '@/lib/nav-width';
import type { TurnEvent } from '@mantle/client-types';
import {
  replyPollDelayMs,
  startTurnSafetyPoll,
  turnSinceIso,
  type SafetyPollRow,
} from './turn-safety-poll';

/**
 * App-wide assistant provider. The turn fetch runs here (in the persistent
 * shell), so a long turn — research, a big tool loop — keeps going when you
 * navigate away. No beforeunload guard needed: the turn route persists + caches
 * by idempotency-key, so even a reload doesn't lose it.
 *
 * This provider ALSO owns the global panel UI state: the full assistant opens as
 * a content-area overlay (<AssistantPanel/>) on any screen, summoned by ⌘I or by
 * the <AssistantButton/> at the foot of the left rail.
 */
export type TurnResponse = {
  inbound: { id: string; text: string; createdAt: string; artifacts?: unknown[] };
  outbound: { id: string; text: string; model: string | null; createdAt: string };
  artifacts?: unknown[];
  warnings?: string[];
};

/** What the turn POST resolves to. The legacy blocking route returns the full
 *  {@link TurnResponse}; the non-blocking (streaming) route returns just the
 *  turn id (202) — the reply then arrives over the live stream, and the caller
 *  reconciles to the durable row. The dock drives its own mini-chat off the
 *  stream in that case; the /assistant page reconciles its transcript. */
/** `stream`: the brain streams this turn live (a member's turn too, on a
 *  brain that streams them); absent from an older brain. */
export type TurnAck = { turnId: string; warnings?: string[]; stream?: boolean };
export type TurnPostResult = TurnResponse | TurnAck;

export type RunTurnInput = {
  agentSlug?: string;
  agentName: string;
  idempotencyKey: string;
  /** What to show as the user's message in the dock transcript. */
  displayText: string;
  /** Request body — FormData (uploads) or a JSON string (text-only). */
  body: FormData | string;
  isJson: boolean;
};

type DockMsg = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  pending?: boolean;
  error?: boolean;
};

/** Panel visibility: `open` = full overlay shown; `min`/`closed` = bubble only
 *  (screen behind is visible + interactive). `min` is "minimised from open",
 *  `closed` is the initial/dismissed state — both render the bubble. */
export type AssistantPanelState = 'closed' | 'open' | 'min';

/** The content surfaces that can be attached as assistant context — the single
 *  source of truth for the set. `ContextKind` is derived from it, so runtime
 *  consumers and the type cannot drift apart: adding a kind
 *  here is the only edit needed.
 *
 *  Every entry names a `nodes.type` in the brain, but see `ContextRef` — that
 *  does NOT mean `id` is always a node id. */
export const CONTEXT_KINDS = [
  'file',
  'folder',
  'page',
  'note',
  'table',
  'journal',
  'task',
  'event',
  'app',
  'draw',
  'formula',
  'email',
  'contact',
] as const;

/** What kind of thing a context ref points at. Drives the chip icon, the wording
 *  of the reference preamble the agent reads, and — since the ref is a typed
 *  union — how the brain resolves `id`. */
export type ContextKind = (typeof CONTEXT_KINDS)[number];

/** A turn has settled (succeeded or failed). Surface hooks subscribe to refresh
 *  the open editor when a specialist edited the node they're showing. `nodeId`
 *  is the on-screen node the turn rode with as pinned context (null for a plain
 *  turn), captured at send time so a late completion still resolves correctly. */
export type TurnSettled = {
  agentSlug?: string;
  nodeId: string | null;
  status: 'done' | 'error';
  /** The turn's idempotency key, so a transcript can tell ITS turn settled. */
  idempotencyKey?: string;
  /** The user-facing reason, on `error`. */
  message?: string;
};
type TurnSettledListener = (detail: TurnSettled) => void;

/** A thing the assistant should treat as context — either pinned automatically
 *  by the open surface (`useSurfaceAssist`) or marked by hand.
 *
 *  ⚠ `id` is KIND-RELATIVE: it is the id the *surface* holds, which is not
 *  always a node id. For every kind except `email` the surface id IS the node
 *  id, so the brain's resolver is a pass-through. For `email` it is the
 *  `emails` row id — the node id is deliberately never sent to the client — and
 *  the brain maps it via `emails.id → emails.node_id`. Pass a node id for an
 *  `email` ref and it resolves to nothing, silently. The brain owns resolution;
 *  never resolve kind-relative ids on this side.
 *
 *  `meta` carries cheap identifying data that is NOT a node lookup, and rides
 *  every turn alongside the ref. Use it for what disambiguates the label — a
 *  file's folder path (two `report.pdf`s are indistinguishable otherwise), a
 *  table's active tab, an email's `threadId`/`accountId`. Heavy content is not
 *  meta: once the ref resolves, the agent's node tools can read the body. */
export type ContextRef = {
  id: string;
  kind: ContextKind;
  label: string;
  meta?: Record<string, string>;
};

/** An in-node selection the current screen published — e.g. the Pages gutter
 *  marks, each with a human-readable snippet of the marked block. Rendered as
 *  chips in the composer (so it's unambiguous the assistant sees the selection)
 *  and in the panel's context strip. The surface owns the underlying state;
 *  `onRemove`/`onClear` mutate it from the chat side. */
export type SurfaceSelection = {
  /** What one item is called, singular ("section", "row"). Drives chip copy. */
  noun: string;
  items: { id: string; label: string }[];
  onRemove?: (id: string) => void;
  onClear?: () => void;
};

/** Most context refs one turn carries (pinned + picked + linked attachments). */
export const MAX_CONTEXT = 10;

type AssistantDockApi = {
  /** Run a turn through the persistent fetch. Resolves with the server result —
   *  the full reply (blocking route) or a turn-id ack (streaming route, where the
   *  reply lands over the live stream) — or throws. Also drives the bubble state. */
  runTurn: (input: RunTurnInput) => Promise<TurnPostResult>;
  // ── transcript mirror (last-N turns; drives the bubble's unread/busy state) ──
  messages: DockMsg[];
  busy: boolean;
  agentSlug?: string;
  agentName: string;
  clear: () => void;
  // ── global panel UI state (consumed by <AssistantPanel/> + <AssistantButton/>) ──
  panel: AssistantPanelState;
  /** True once the panel has been opened at least once this page load. The
   *  panel's body is code-split behind it, so it is never mounted — and its
   *  editor stack never downloaded — on a load where nobody asks for it. Only
   *  ever goes false → true, so the transcript survives minimising. */
  everOpened: boolean;
  /** Show the full panel. Optionally switch to a specific agent first. */
  openAssistant: (slug?: string) => void;
  /** Hide the panel to the bubble, keeping the transcript mounted. */
  minimize: () => void;
  /** Dismiss the panel (also to the bubble; distinct state for future use). */
  close: () => void;
  /** open ⇄ min — what the bubble + ⌘I toggle. */
  toggle: () => void;
  /** The agent selected for the panel — source of truth (mirrors the
   *  `mantle_assistant_agent` pref, ui-prefs). The panel ALWAYS talks to this sticky
   *  pick, even on the Pages/Tables/Apps screens: the main responder plans and
   *  delegates to the surface specialists herself (invoke_agent), so the thread
   *  never switches out from under the user and composer state survives
   *  navigation. */
  activeAgentSlug?: string;
  setActiveAgentSlug: (slug?: string) => void;
  // ── surface-pinned context (the open page/table/app rides every turn) ──
  /** A node pinned by the current screen — sent with EVERY turn (survives a send,
   *  unlike attached chips) so the specialist always knows what you're editing. */
  pinnedContext: ContextRef[];
  /** Replace the pinned set (the surface hook owns this; cleared on leave). */
  setPinnedContext: (refs: ContextRef[]) => void;
  /** Dismiss the screen-pinned reference for the current node (the composer "×")
   *  so it drops from the chips, the preamble, and the sent turn — for a general
   *  question. Navigating to another item re-pins that one. */
  dismissPinnedContext: (id: string) => void;
  /** An extra directive (e.g. Pages focus marks) folded into the
   *  sent text after the context preamble. Null when nothing's focused. */
  extraDirective: string | null;
  setExtraDirective: (directive: string | null) => void;
  /** The current screen's in-node selection (Pages gutter marks…), published so
   *  the composer can show it as chips. Null when the surface has none. */
  surfaceSelection: SurfaceSelection | null;
  setSurfaceSelection: (sel: SurfaceSelection | null) => void;
  /** Count of draft changes pending review on the pinned node (Pages review
   *  count), for the panel's context strip. Null when unknown/none. */
  surfaceChanges: number | null;
  setSurfaceChanges: (n: number | null) => void;
  /** True while the open panel renders as a docked side column between the
   *  content and the activity rail (lg viewport handled in CSS). Available on
   *  every screen — on editor surfaces it's what keeps gutter marks and review
   *  highlights visible beside the chat. The panel's third state — minimised
   *  to the bubble — lives on `panel`. */
  docked: boolean;
  /** column ⇄ full display; persisted, applies everywhere. From the popout it
   *  returns to the column, which is the mode it was popped out of. */
  toggleDocked: () => void;
  /** Which of the three open shapes the panel wears. `docked` above is simply
   *  `display === 'docked'`, kept so no existing reader had to change. */
  display: AssistantDisplay;
  setDisplay: (d: AssistantDisplay) => void;
  /** The popout window's box in viewport px, or null before it has ever been
   *  placed (the panel resolves a first position on the first pop-out, which
   *  needs a window and so cannot be done while rendering on the server). */
  popout: PopoutRect | null;
  /** Place the popout, clamped so it can never be dragged out of reach. */
  setPopout: (r: PopoutRect) => void;
  /** Pointer-down on the panel's own header: starts a move. A no-op unless the
   *  popout is showing, and it stands aside for any control inside the header,
   *  so the buttons up there still work. */
  startPopoutMove: (e: React.PointerEvent) => void;
  /** Pointer-down on the corner grip: starts a resize. */
  startPopoutResize: (e: React.PointerEvent) => void;
  /** Attached by the panel to its own root. The drag writes this node's CSS
   *  variables directly, so a move does not re-render the chat every frame. */
  popoutElRef: React.RefObject<HTMLDivElement | null>;
  /** The docked column's width in px. Dragged by the handle on its inner edge
   *  and kept in localStorage; the shell reads it to publish `--assistant-w`,
   *  so `<main>` and the toast dock shrink beside it exactly as before — only
   *  the number is now the reader's rather than a hard-coded 30rem. */
  dockWidth: number;
  /** Called by the drag handle with an already-clamped px width. */
  setDockWidth: (px: number) => void;
  /** True while the column is being dragged. The shell publishes it as
   *  `data-resizing`, which suspends the frame's width transitions. */
  dockResizing: boolean;
  /** Fired by the handle on grab and release. */
  setDockResizing: (on: boolean) => void;
  /** The on-screen node id the in-flight turn is editing (null when idle or when
   *  no surface node is pinned) — lets a screen lock its editor only while ITS
   *  node is being worked on. */
  activeContextNodeId: string | null;
  /** Subscribe to turn-settled events; returns an unsubscribe. A surface hook
   *  uses this to refresh its editor when a turn that edited its node completes. */
  registerTurnListener: (fn: TurnSettledListener) => () => void;
  // ── hand-attached context (chat uploads, area screenshots, the bubbles) ──
  /** Nodes attached to ride along with the next turn as context. */
  pendingContext: ContextRef[];
  /** Attach a node (deduped by id, capped). */
  attachContext: (ref: ContextRef) => void;
  /** Drop one attached node. */
  removeContext: (id: string) => void;
  /** Clear all attached nodes (called after a successful send). */
  clearContext: () => void;
};

/**
 * The API above, partitioned by WHAT MAKES IT CHANGE. Derived with `Pick` so
 * the field docs stay in one place and the three cannot drift from it.
 */
type DockActions = Pick<
  AssistantDockApi,
  | 'runTurn'
  | 'clear'
  | 'openAssistant'
  | 'minimize'
  | 'close'
  | 'toggle'
  | 'setActiveAgentSlug'
  | 'attachContext'
  | 'removeContext'
  | 'clearContext'
  | 'setPinnedContext'
  | 'dismissPinnedContext'
  | 'setExtraDirective'
  | 'setSurfaceSelection'
  | 'setSurfaceChanges'
  | 'toggleDocked'
  | 'setDisplay'
  | 'setPopout'
  | 'startPopoutMove'
  | 'startPopoutResize'
  | 'popoutElRef'
  | 'setDockWidth'
  | 'setDockResizing'
  | 'registerTurnListener'
>;
type DockLayout = Pick<
  AssistantDockApi,
  'panel' | 'everOpened' | 'docked' | 'display' | 'popout' | 'dockWidth' | 'dockResizing'
>;
type DockSession = Pick<
  AssistantDockApi,
  | 'messages'
  | 'busy'
  | 'agentSlug'
  | 'agentName'
  | 'activeAgentSlug'
  | 'pendingContext'
  | 'pinnedContext'
  | 'extraDirective'
  | 'surfaceSelection'
  | 'surfaceChanges'
  | 'activeContextNodeId'
>;

/** Compile-time proof that the three partitions cover every field. Add one to
 *  `AssistantDockApi` without placing it, and this stops being `true`. */
type _DockSplitIsExhaustive =
  Exclude<
    keyof AssistantDockApi,
    keyof DockActions | keyof DockLayout | keyof DockSession
  > extends never
    ? true
    : never;
const _dockSplitIsExhaustive: _DockSplitIsExhaustive = true;
void _dockSplitIsExhaustive;

const ActionsCtx = createContext<DockActions | null>(null);
const LayoutCtx = createContext<DockLayout | null>(null);
const SessionCtx = createContext<DockSession | null>(null);
const MAX_DOCK_MSGS = 12;

/** Consecutive failed reconnects before the dock stream gives up. A successful
 *  connect resets the count, so this is an outage, not a slow turn. Same 5 the
 *  team chat and forum settled on. */
const DOCK_STREAM_MAX_ATTEMPTS = 5;
/** Rows fetched per safety-poll tick: this turn's pair sits at the top of the
 *  thread, so a handful is plenty and keeps the request small. */
const DOCK_POLL_PAGE = 10;
/** With the live stream gone, how long the safety poll keeps waiting on a row
 *  that is still `pending` before the bubble stops spinning. */
const DOCK_POLL_GIVE_UP_MS = 15 * 60_000;
const AGENT_COOKIE = 'mantle_assistant_agent';
const DOCK_PREF_KEY = 'mantle_assistant_dock';
const DOCK_W_KEY = 'mantle_assistant_w';
const DISPLAY_KEY = 'mantle_assistant_display';
const POPOUT_KEY = 'mantle_assistant_popout';

/** The three shapes an OPEN panel can wear. Minimised is not one of them: that
 *  is `panel === 'min'`, and it deliberately leaves the display pick alone so
 *  recalling the assistant brings back the shape you left it in. */
export type AssistantDisplay = 'full' | 'docked' | 'popout';

/** The popout window's box, in viewport px. */
export type PopoutRect = { x: number; y: number; w: number; h: number };

const POPOUT_MIN_W = 360;
const POPOUT_MIN_H = 320;
/** How much of the window must stay on screen. A window dragged fully past an
 *  edge is unreachable — there is no taskbar here to get it back from. */
const POPOUT_KEEP = 80;

function clampPopout(r: PopoutRect): PopoutRect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.max(POPOUT_MIN_W, Math.min(r.w, vw));
  const h = Math.max(POPOUT_MIN_H, Math.min(r.h, vh));
  return {
    w,
    h,
    x: Math.max(POPOUT_KEEP - w, Math.min(r.x, vw - POPOUT_KEEP)),
    // Never above the top of the viewport: the header IS the drag grip, and a
    // window whose header is off-screen can no longer be moved.
    y: Math.max(0, Math.min(r.y, vh - POPOUT_KEEP)),
  };
}

function readPopout(): PopoutRect | null {
  try {
    const raw = localStorage.getItem(POPOUT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PopoutRect>;
    if (![p.x, p.y, p.w, p.h].every((n) => typeof n === 'number' && Number.isFinite(n)))
      return null;
    return clampPopout(p as PopoutRect);
  } catch {
    return null;
  }
}
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function AssistantDockProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<DockMsg[]>([]);
  const [agentSlug, setAgentSlug] = useState<string | undefined>(undefined);
  const [agentName, setAgentName] = useState('Assistant');
  const agentNameRef = useRef(agentName);
  agentNameRef.current = agentName;

  const agentRef = useRef<string | undefined>(undefined);
  // The live-stream routes of a turn are an Admin user's (W7c): any other
  // login's reply is read from its thread by the safety poll below. A ref,
  // read when a turn starts (the shell has answered by then).
  const adminUser = useIsAdminUser();
  const adminUserRef = useRef(adminUser);
  adminUserRef.current = adminUser;
  // Whether this login lets agents use the window (lib/agent-ui/turn-calls):
  // read once, so a turn can name the window. Every login with a chat (an
  // Admin user or a member); a brain whose member turns do not stream never
  // offers a member the ui tools, so the setting changes nothing there.
  useEffect(() => {
    void loadAgentUiSetting();
  }, []);

  // ── Global panel UI state ──
  const [panel, setPanel] = useState<AssistantPanelState>('closed');
  // Latches on the first open and never clears, which is what lets the panel be
  // code-split without costing the transcript: once mounted it stays mounted
  // through minimise/restore and every change of shape.
  const [everOpened, setEverOpened] = useState(false);
  useEffect(() => {
    if (panel === 'open') setEverOpened(true);
  }, [panel]);
  const [activeAgentSlug, setActiveAgentSlugState] = useState<string | undefined>(undefined);

  // ── Hand-attached context ──
  const [pendingContext, setPendingContext] = useState<ContextRef[]>([]);
  // ── Surface-pinned context + focus directive (owned by the surface hook) ──
  const [pinnedContextRaw, setPinnedContextState] = useState<ContextRef[]>([]);
  // Pinned refs the user dismissed via the composer "×" — they want a general
  // question, not one scoped to the open item. Keyed by node id; pruned when the
  // surface pins a different node so a fresh selection is never pre-dismissed.
  const [pinnedDismissedIds, setPinnedDismissedIds] = useState<string[]>([]);
  // What every consumer sees (chips, preamble, the sent turn): the surface's pin
  // minus anything the user dismissed. Dismissing thus drops the reference
  // everywhere at once, and re-pinning a node (below) makes it reappear.
  const pinnedContext = useMemo(
    () =>
      pinnedDismissedIds.length === 0
        ? pinnedContextRaw
        : pinnedContextRaw.filter((r) => !pinnedDismissedIds.includes(r.id)),
    [pinnedContextRaw, pinnedDismissedIds],
  );
  const [extraDirective, setExtraDirectiveState] = useState<string | null>(null);
  const [surfaceSelection, setSurfaceSelectionState] = useState<SurfaceSelection | null>(null);
  const [surfaceChanges, setSurfaceChangesState] = useState<number | null>(null);
  // Docked-column preference — a first-class display mode on EVERY screen
  // (full display ⇄ docked column ⇄ minimised bubble). Default ON (the column
  // keeps the screen you're working on visible); the panel header flips it,
  // persisted, and the pick sticks across screens and sessions.
  const [display, setDisplayState] = useState<AssistantDisplay>('docked');
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DISPLAY_KEY);
      if (saved === 'full' || saved === 'docked' || saved === 'popout') setDisplayState(saved);
      // Migration: readers who picked full display before there were three
      // modes stored a boolean. Honour it once; the new key wins from then on.
      else if (localStorage.getItem(DOCK_PREF_KEY) === '0') setDisplayState('full');
    } catch {
      /* no storage — keep the default */
    }
  }, []);
  const setDisplay = useCallback((d: AssistantDisplay) => {
    setDisplayState(d);
    try {
      localStorage.setItem(DISPLAY_KEY, d);
    } catch {
      /* no storage — session-only */
    }
  }, []);
  const docked = display === 'docked';
  const toggleDocked = useCallback(
    () => setDisplay(docked ? 'full' : 'docked'),
    [docked, setDisplay],
  );

  // ── the popout window's box ──────────────────────────────────────────────
  // Held here rather than in the panel so it survives every unmount the panel
  // could ever have, and so the drag handlers can be handed to the panel's own
  // header (which lives in another component) without threading state through.
  const [popout, setPopoutState] = useState<PopoutRect | null>(null);
  // The pointer handlers read the CURRENT box on every frame; state would be a
  // stale closure for the whole length of a drag.
  const popoutRef = useRef<PopoutRect | null>(null);
  // The window element itself. A drag writes its CSS variables straight to the
  // node and commits to React ONCE, on release — see dragPopout.
  const popoutElRef = useRef<HTMLDivElement | null>(null);
  const setPopout = useCallback((r: PopoutRect) => {
    const next = clampPopout(r);
    popoutRef.current = next;
    setPopoutState(next);
  }, []);
  const savePopout = useCallback(() => {
    try {
      if (popoutRef.current) localStorage.setItem(POPOUT_KEY, JSON.stringify(popoutRef.current));
    } catch {
      /* no storage — session-only */
    }
  }, []);
  useEffect(() => {
    const saved = readPopout();
    if (saved) {
      popoutRef.current = saved;
      setPopoutState(saved);
    }
  }, []);
  // A window sized to yesterday's monitor must not sit off the edge of today's.
  useEffect(() => {
    const onResize = () => {
      if (popoutRef.current) setPopout(popoutRef.current);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setPopout]);

  // One gesture, two jobs: from the header it moves the window, from the corner
  // grip it resizes. Listeners go on the WINDOW, not the element, so a fast
  // drag that outruns the pointer keeps tracking instead of dropping the window
  // wherever the cursor happened to leave it. The box is written to storage on
  // release rather than per frame — a drag is ~60 writes a second otherwise.
  const dragPopout = useCallback(
    (e: React.PointerEvent, mode: 'move' | 'resize') => {
      const base = popoutRef.current;
      if (!base) return;
      // The header carries the agent picker, the mode tabs and minimise. A
      // pointer-down on any of them is a click, not the start of a drag.
      if (
        mode === 'move' &&
        (e.target as HTMLElement).closest(
          'button, a, input, textarea, select, [role="combobox"], [role="separator"]',
        )
      ) {
        return;
      }
      e.preventDefault();
      const ox = e.clientX;
      const oy = e.clientY;
      // Every consumer of this context re-renders when the box goes into React
      // state — and one of them is the whole chat: transcript, composer, the
      // lot. Doing that per pointermove is a full redraw of the thread a
      // hundred times a second, which is exactly what a laggy drag is. So the
      // drag writes the four CSS variables straight to the node (the same ones
      // the className reads) and React hears about it once, on release.
      const onMove = (ev: PointerEvent) => {
        const next = clampPopout(
          mode === 'move'
            ? { ...base, x: base.x + (ev.clientX - ox), y: base.y + (ev.clientY - oy) }
            : { ...base, w: base.w + (ev.clientX - ox), h: base.h + (ev.clientY - oy) },
        );
        popoutRef.current = next;
        const el = popoutElRef.current;
        if (!el) {
          setPopout(next);
          return;
        }
        el.style.setProperty('--popout-x', `${next.x}px`);
        el.style.setProperty('--popout-y', `${next.y}px`);
        el.style.setProperty('--popout-w', `${next.w}px`);
        el.style.setProperty('--popout-h', `${next.h}px`);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        // Now React catches up with where the window actually is: one render,
        // one storage write.
        if (popoutRef.current) setPopoutState(popoutRef.current);
        savePopout();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [setPopout, savePopout],
  );
  const startPopoutMove = useCallback(
    (e: React.PointerEvent) => dragPopout(e, 'move'),
    [dragPopout],
  );
  const startPopoutResize = useCallback(
    (e: React.PointerEvent) => dragPopout(e, 'resize'),
    [dragPopout],
  );
  // The docked column's width. localStorage rather than a cookie (the pattern
  // the shell rails use): the panel starts closed, so there is no first-paint
  // width to server-render and nothing to jump.
  const [dockWidth, setDockWidthState] = useState(ASSISTANT_W_DEFAULT);
  const dockWidthRef = useRef(ASSISTANT_W_DEFAULT);
  // True for the length of a pointer drag. The shell mirrors it into
  // `data-resizing`, where one CSS rule suspends the 200ms ease on
  // `--assistant-w` — without it the column follows the pointer a fifth of a
  // second late, which reads as lag rather than as a transition.
  const [dockResizing, setDockResizingState] = useState(false);
  const dockDragging = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DOCK_W_KEY);
      if (raw !== null) {
        const w = clampAssistantWidth(raw);
        dockWidthRef.current = w;
        setDockWidthState(w);
      }
    } catch {
      /* no storage — keep the default */
    }
  }, []);
  const persistDockWidth = useCallback((w: number) => {
    try {
      localStorage.setItem(DOCK_W_KEY, String(w));
    } catch {
      /* no storage — session-only */
    }
  }, []);
  const setDockWidth = useCallback(
    (px: number) => {
      const w = clampAssistantWidth(String(Math.round(px)));
      dockWidthRef.current = w;
      setDockWidthState(w);
      // A pointer drag persists ONCE, on release. localStorage is synchronous,
      // and a write per pointermove is a hundred of them a second on the same
      // thread that has to paint the frame.
      if (!dockDragging.current) persistDockWidth(w);
    },
    [persistDockWidth],
  );
  const setDockResizing = useCallback(
    (on: boolean) => {
      dockDragging.current = on;
      setDockResizingState(on);
      if (!on) persistDockWidth(dockWidthRef.current);
    },
    [persistDockWidth],
  );

  // The node the in-flight turn rode with as pinned context — set when a turn
  // starts, cleared when it settles. Drives a screen's editor lock.
  const [activeContextNodeId, setActiveContextNodeId] = useState<string | null>(null);
  // Latest pinned set, read synchronously by runTurn to stamp the turn's target
  // node (state would be a stale closure inside the long-lived callback).
  const pinnedContextRef = useRef<ContextRef[]>([]);
  pinnedContextRef.current = pinnedContext;
  // Turn-settled subscribers (surface hooks). A Set so register/unsubscribe is O(1).
  const turnListenersRef = useRef<Set<TurnSettledListener>>(new Set());
  const registerTurnListener = useCallback((fn: TurnSettledListener) => {
    turnListenersRef.current.add(fn);
    return () => {
      turnListenersRef.current.delete(fn);
    };
  }, []);
  const fireTurnSettled = useCallback((detail: TurnSettled) => {
    setActiveContextNodeId(null);
    for (const fn of turnListenersRef.current) {
      try {
        fn(detail);
      } catch {
        /* a listener throwing must not break the others or the turn */
      }
    }
  }, []);

  const setPinnedContext = useCallback((refs: ContextRef[]) => {
    setPinnedContextState(refs);
    // A newly pinned node must never inherit a stale dismissal — drop any
    // dismissed id that's no longer in the pinned set. (Leaving a screen pins
    // [] and so clears dismissals too.)
    setPinnedDismissedIds((prev) => {
      if (prev.length === 0) return prev;
      const ids = new Set(refs.map((r) => r.id));
      const next = prev.filter((id) => ids.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, []);
  const dismissPinnedContext = useCallback(
    (id: string) => setPinnedDismissedIds((prev) => (prev.includes(id) ? prev : [...prev, id])),
    [],
  );
  const setExtraDirective = useCallback((d: string | null) => setExtraDirectiveState(d), []);
  const setSurfaceSelection = useCallback(
    (sel: SurfaceSelection | null) => setSurfaceSelectionState(sel),
    [],
  );
  const setSurfaceChanges = useCallback((n: number | null) => setSurfaceChangesState(n), []);

  const attachContext = useCallback((ref: ContextRef) => {
    setPendingContext((prev) => {
      if (prev.some((r) => r.id === ref.id)) return prev; // already attached
      if (prev.length >= MAX_CONTEXT) return prev; // cap — silently ignore extras
      return [...prev, ref];
    });
  }, []);
  const removeContext = useCallback(
    (id: string) => setPendingContext((prev) => prev.filter((r) => r.id !== id)),
    [],
  );
  const clearContext = useCallback(() => setPendingContext([]), []);

  // Seed the selected agent from the pref the picker writes, so the panel
  // opens on your last-used agent without a URL param. Kept URI-encoded, as
  // the cookie it replaces was.
  useEffect(() => {
    const kept = readPref(AGENT_COOKIE);
    if (kept) setActiveAgentSlugState(decodeURIComponent(kept));
  }, []);

  const setActiveAgentSlug = useCallback((slug?: string) => {
    setActiveAgentSlugState(slug);
    if (slug) {
      writePref(AGENT_COOKIE, encodeURIComponent(slug), ONE_YEAR_SECONDS);
    }
  }, []);

  const openAssistant = useCallback(
    (slug?: string) => {
      if (slug) setActiveAgentSlug(slug);
      setPanel('open');
    },
    [setActiveAgentSlug],
  );
  const minimize = useCallback(() => setPanel((p) => (p === 'open' ? 'min' : p)), []);
  const close = useCallback(() => setPanel('closed'), []);
  const toggle = useCallback(() => {
    setPanel((p) => (p === 'open' ? 'min' : 'open'));
  }, []);

  // ⌘I / Ctrl+I toggles the panel. Registered HERE, once per app, not in
  // <AssistantButton/>: the button now renders in the rail body, which is
  // mounted twice whenever the mobile drawer is open (the CSS-hidden desktop
  // aside plus the drawer), and two per-button listeners each calling toggle()
  // cancel out — ⌘I became a no-op exactly when the drawer was open. Skipped
  // while typing so it never steals a keystroke from an input or the page
  // editor (where ⌘I is italic).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== 'i') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  // Any route change steps an open panel aside so the screen you navigated to is
  // actually visible behind the bubble. This is the single, declarative
  // guarantee — it covers the left nav, the right activity column (journey
  // links), header links, and any future navigation, so no individual call site
  // has to remember to minimise. (In-screen selections that only swap a `?…`
  // query param don't change the pathname — but those can only happen while the
  // panel is already minimised, since an open panel covers the content area, so
  // there's nothing to step aside for.)
  const pathname = usePathname();
  const prevPathRef = useRef(pathname);
  useEffect(() => {
    if (prevPathRef.current === pathname) return; // initial mount, or no real change
    prevPathRef.current = pathname;
    setPanel((p) => (p === 'open' ? 'min' : p));
  }, [pathname]);

  // Drive the floating mini-chat's bot bubble off the live stream (non-blocking
  // route). Types the reply out as text-deltas arrive, then settles on
  // done/error. Fire-and-forget — the provider is mounted app-wide, so the
  // subscription survives navigation and self-terminates when the turn ends.
  // The live dock stream, so it can be torn down. There was no disposer at all:
  // `stop()` existed only inside the done/error handlers, so nothing outside
  // them could end the stream — not a new turn superseding this one, not
  // unmount. Combined with the reconnect-forever default that meant a stream
  // whose turn had gone could keep retrying for the life of the tab.
  const dockStreamRef = useRef<(() => void) | null>(null);
  const stopDockStream = useCallback(() => {
    dockStreamRef.current?.();
    dockStreamRef.current = null;
  }, []);
  useEffect(() => stopDockStream, [stopDockStream]);

  const subscribeDockTurn = useCallback(
    (
      turnId: string,
      botId: string,
      target: { agentSlug?: string; nodeId: string | null },
      sinceIso: string,
      /** The brain said this turn streams (its 202's `stream`). */
      streams = false,
    ) => {
      // A new turn supersedes whatever was still streaming.
      stopDockStream();
      let replyBuf = '';
      let round = -1;
      let settled = false;
      // The reply row's durable id, once `turn-start` says it. The safety poll
      // reads it lazily, and falls back to pairing by time when it never comes.
      let outboundId: string | null = null;
      // An Admin user's turn always streams. Anyone else's streams when the
      // brain says so in its 202 (`stream: true`, member turns stream since
      // agent UI phase 3); else the poll alone reads the reply, so it may
      // give up as if the stream had died (W7c).
      const live = adminUserRef.current || streams;
      let streamDead = !live;
      const subscribedAt = Date.now();

      /**
       * The bubble comes out of `pending` exactly once, whichever announcer gets
       * there. FOUR can now: `done`, `error`, a stream that simply ends, and the
       * safety poll reading the durable row (see turn-safety-poll.ts).
       *
       * That third one is the bug. `busy` is derived from any assistant message
       * still pending, so a stream that stopped without saying so left the
       * bubble spinning and `busy` true APP-WIDE until reload — and `busy`
       * gates the composer everywhere, not just in the dock.
       */
      const settle = (patch: Partial<DockMsg>, status: 'done' | 'error') => {
        if (settled) return;
        settled = true;
        stopDockStream();
        endAgentTurn(turnId);
        setMessages((prev) => prev.map((m) => (m.id === botId ? { ...m, ...patch } : m)));
        fireTurnSettled({
          agentSlug: target.agentSlug,
          nodeId: target.nodeId,
          status,
          // `botId` is `a-<idempotencyKey>` (see runTurn).
          idempotencyKey: botId.slice(2),
          ...(status === 'error' && typeof patch.text === 'string' ? { message: patch.text } : {}),
        });
      };

      const stop = !live
        ? () => {}
        : apiEventStream(
            `/api/assistant/turn/${turnId}/stream`,
            (raw) => {
              if (settled) return;
              let ev: TurnEvent;
              try {
                ev = JSON.parse(raw) as TurnEvent;
              } catch {
                return;
              }
              if (ev.type === 'turn-start') {
                if (typeof ev.data?.outboundId === 'string') outboundId = ev.data.outboundId;
                return;
              }
              // An in-app agent's ui tool call for this window (agent UI).
              if ((ev as { type: string }).type === 'ui-call') {
                void handleUiCall(turnId, ev.data, agentNameRef.current);
                return;
              }
              if (ev.type === 'text-delta' && typeof ev.data?.text === 'string') {
                const r = typeof ev.round === 'number' ? ev.round : 0;
                if (r > round) {
                  round = r;
                  replyBuf = ev.data.text;
                } else {
                  replyBuf += ev.data.text;
                }
                setMessages((prev) =>
                  prev.map((m) => (m.id === botId ? { ...m, text: replyBuf } : m)),
                );
                return;
              }
              if (ev.type === 'done') {
                settle({ pending: false }, 'done');
                return;
              }
              if (ev.type === 'error') {
                const message =
                  ev.data && typeof ev.data.message === 'string'
                    ? ev.data.message
                    : 'The turn failed.';
                settle({ text: message, pending: false, error: true }, 'error');
                return;
              }
            },
            {
              onError: () => {},
              // Without these the stream can end with nothing said: a 404 (streaming
              // switched off server-side) returns silently, and a real outage
              // reconnects forever. Either way the terminal `done` this bubble waits
              // for never arrives. The turn itself is durable and usually still
              // finishes, hence the wording, which sends the reader to the place
              // that reconciles against the row rather than claiming a failure.
              maxAttempts: DOCK_STREAM_MAX_ATTEMPTS,
              // The stream is gone, the turn usually is not. The safety poll below
              // is still watching the durable row, so let IT finish the bubble with
              // the real reply; it gives up (with `lostConnection`) only if the row
              // stays pending past DOCK_POLL_GIVE_UP_MS.
              onExhausted: () => {
                streamDead = true;
              },
            },
          );

      const lostConnection = () =>
        settle(
          {
            text:
              replyBuf ||
              'Lost the live connection to this turn. It may still be running — open the assistant to see the reply.',
            pending: false,
            error: true,
          },
          'error',
        );

      // The stream is an optimisation; the durable row is the truth. A proxy
      // that holds `text/event-stream` back (or a missed terminal event) must
      // not leave the bubble spinning while the reply sits finished in the
      // thread, so poll the row alongside the stream: first to report wins.
      const stopPoll = startTurnSafetyPoll({
        fetchRows: async () => {
          const qs = new URLSearchParams({ limit: String(DOCK_POLL_PAGE) });
          if (target.agentSlug) qs.set('agent', target.agentSlug);
          const data = await apiFetch<{ messages: SafetyPollRow[] }>(
            `/api/assistant/messages?${qs.toString()}`,
            { cache: 'no-store' },
          );
          return data.messages ?? [];
        },
        getOutboundId: () => outboundId,
        sinceIso,
        onComplete: (row) => settle({ text: row.text, pending: false }, 'done'),
        onFailed: (row) =>
          settle({ text: row.error || 'The turn failed.', pending: false, error: true }, 'error'),
        shouldGiveUp: () => streamDead && Date.now() - subscribedAt > DOCK_POLL_GIVE_UP_MS,
        onGiveUp: lostConnection,
        // Without the live stream the poll IS the reply: every 3 s for the
        // first minute, then every 10 s, nothing while the tab is hidden, and
        // slower after failed reads (replyPollDelayMs).
        ...(live
          ? {}
          : {
              schedule: {
                delayMs: replyPollDelayMs,
                isHidden: () => typeof document !== 'undefined' && document.hidden,
              },
            }),
      });

      dockStreamRef.current = () => {
        stop();
        stopPoll();
      };
    },
    [fireTurnSettled, stopDockStream],
  );

  const runTurn = useCallback(
    async (input: RunTurnInput): Promise<TurnPostResult> => {
      const switched = agentRef.current !== input.agentSlug;
      agentRef.current = input.agentSlug;
      setAgentSlug(input.agentSlug);
      setAgentName(input.agentName);

      // The on-screen node this turn rides with (the surface's pinned context, if
      // any). Captured here so a screen can lock its editor while ITS node is being
      // worked on, and so the turn-settled event refreshes the right editor.
      const targetNodeId = pinnedContextRef.current[0]?.id ?? null;
      const target = { agentSlug: input.agentSlug, nodeId: targetNodeId };
      setActiveContextNodeId(targetNodeId);

      const userId = `u-${input.idempotencyKey}`;
      const botId = `a-${input.idempotencyKey}`;
      setMessages((prev) => {
        const base = (switched ? [] : prev).slice(-(MAX_DOCK_MSGS - 2));
        return [
          ...base,
          { id: userId, role: 'user', text: input.displayText },
          { id: botId, role: 'assistant', text: '', pending: true },
        ];
      });

      // A research/deep turn can run for minutes; an intermediary (reverse proxy,
      // gateway, browser) often drops the long-held connection before the server
      // finishes. But the turn route is idempotent and runAssistantTurn NEVER
      // rejects — it always resolves to {200|400|500} and caches by
      // idempotency-key. So a dropped connection means the turn is STILL running,
      // not failed. We re-POST the SAME key, which re-attaches to the in-flight
      // turn (or its cached result) WITHOUT re-running the LLM, and keep the
      // spinner alive. Only a real {400|500} from our route — or exhausting the
      // deadline — ends the turn. (Proxy 502/503/504/52x means the gateway gave
      // up but upstream is alive → re-attach, don't surface it.)
      const headers: Record<string, string> = { 'idempotency-key': input.idempotencyKey };
      if (input.isJson) headers['content-type'] = 'application/json';
      // The turn names this window when the login lets agents use it.
      const turnBody = withWindowId(input.body, input.isJson);
      const RETRY_DEADLINE_MS = 6 * 60_000;
      const startedAt = Date.now();
      let attempt = 0;

      try {
        for (;;) {
          attempt += 1;
          let res: Response | null = null;
          try {
            res = await fetch(
              apiUrl('/api/assistant/turn'),
              withAuth({ method: 'POST', headers, body: turnBody }),
            );
          } catch {
            // Network drop / connection reset mid-turn — the turn is still
            // running server-side; fall through to re-attach by key.
            res = null;
          }

          if (res) {
            // An expired session must bounce, not become an error bubble. This
            // POST is the one place the dock reads a raw Response — it
            // re-attaches to an in-flight turn by idempotency key, which
            // `apiFetch` cannot express — so it has to do `apiFetch`'s auth
            // check itself. Before the ok-check, because a 401 is not ok and
            // would otherwise fall through to "request failed (401)"; and
            // before the retry loop, because re-POSTing a dead credential just
            // 401s again until the deadline.
            if (isAuthFailure(res)) {
              bounceToLogin();
              throw new Error('Your session expired. Sign in again to continue.');
            }
            if (res.ok) {
              const data = (await res.json()) as TurnPostResult;
              if ('outbound' in data) {
                // Blocking reply (streaming off) — fill it now.
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === botId ? { ...m, text: data.outbound.text, pending: false } : m,
                  ),
                );
                fireTurnSettled({
                  agentSlug: target.agentSlug,
                  nodeId: target.nodeId,
                  status: 'done',
                  idempotencyKey: input.idempotencyKey,
                });
                return data;
              }
              // Non-blocking (202): the reply lands over the live stream. Keep the
              // bot bubble pending and let the stream type it out + settle it.
              // plus the durable-row safety poll, bounded in the SERVER's clock
              // (the ack's Date header) so client clock skew cannot hide the row.
              // Its ui calls run in this window, and no other.
              claimTurn(data.turnId, res.headers.get('date'));
              subscribeDockTurn(
                data.turnId,
                botId,
                target,
                turnSinceIso({
                  serverDateHeader: res.headers.get('date'),
                  firstSentAtMs: startedAt,
                  nowMs: Date.now(),
                }),
                data.stream === true,
              );
              return data;
            }
            // Our route only emits 400/500 as real outcomes — surface those. A
            // 5xx from a PROXY (gateway timeout) is not our route; re-attach.
            const proxyTimeout =
              res.status === 502 ||
              res.status === 503 ||
              res.status === 504 ||
              res.status === 522 ||
              res.status === 524;
            if (!proxyTimeout) {
              // A refusal in plain words: text only (415), a limit (429), a
              // reused key (409), no assistant (404) (lib/assistant-turn-refusal).
              const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
              throw new Error(turnRefusalText(res.status, b));
            }
          }

          if (Date.now() - startedAt > RETRY_DEADLINE_MS) {
            throw new Error(
              'Still working — this is taking unusually long. It may finish in the background; reload to check.',
            );
          }
          // Brief backoff, then re-attach to the in-flight turn (no LLM re-run).
          await new Promise((r) => setTimeout(r, Math.min(3000, 1000 * attempt)));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Something went wrong';
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botId ? { ...m, text: message, pending: false, error: true } : m,
          ),
        );
        fireTurnSettled({
          agentSlug: target.agentSlug,
          nodeId: target.nodeId,
          status: 'error',
          idempotencyKey: input.idempotencyKey,
          message,
        });
        throw err;
      }
    },
    [subscribeDockTurn, fireTurnSettled],
  );

  const clear = useCallback(() => setMessages([]), []);

  const busy = useMemo(() => messages.some((m) => m.role === 'assistant' && m.pending), [messages]);

  // ── Three contexts, not one ────────────────────────────────────────────────
  // This was ONE value of 45 fields memoised on all 45, so a change to any of
  // them re-rendered every consumer. Measured on /tasks: toggling the old pick
  // mode's flag, which one overlay read, re-rendered the 630-line app shell and
  // the question watcher just as often as that overlay. `messages` is in here
  // too, so that fan-out fired on every streaming token.
  //
  // Split by WHAT CHANGES, which turned out to match what consumers ask for:
  // four of the eleven want nothing but callbacks, and the app shell wants
  // nothing but the four layout fields. Read the narrowest one that covers you.
  // Stable for the life of the provider — every one is a useCallback with
  // stable deps, or a ref. A consumer that only calls things never re-renders.
  const actions = useMemo<DockActions>(
    () => ({
      runTurn,
      clear,
      openAssistant,
      minimize,
      close,
      toggle,
      setActiveAgentSlug,
      attachContext,
      removeContext,
      clearContext,
      setPinnedContext,
      dismissPinnedContext,
      setExtraDirective,
      setSurfaceSelection,
      setSurfaceChanges,
      toggleDocked,
      setDisplay,
      setPopout,
      startPopoutMove,
      startPopoutResize,
      popoutElRef,
      setDockWidth,
      setDockResizing,
      registerTurnListener,
    }),
    [
      runTurn,
      clear,
      openAssistant,
      minimize,
      close,
      toggle,
      setActiveAgentSlug,
      attachContext,
      removeContext,
      clearContext,
      setPinnedContext,
      dismissPinnedContext,
      setExtraDirective,
      setSurfaceSelection,
      setSurfaceChanges,
      toggleDocked,
      setDisplay,
      setPopout,
      startPopoutMove,
      startPopoutResize,
      popoutElRef,
      setDockWidth,
      setDockResizing,
      registerTurnListener,
    ],
  );

  // Panel geometry. Changes when the operator moves or resizes the dock —
  // not when a turn streams. This is what the app shell reads.
  const layout = useMemo<DockLayout>(
    () => ({
      panel,
      everOpened,
      docked,
      display,
      popout,
      dockWidth,
      dockResizing,
    }),
    [panel, everOpened, docked, display, popout, dockWidth, dockResizing],
  );

  // The conversation and its context marks. The hot one: `messages` changes
  // per streamed token, so anything reading this re-renders with the turn.
  const session = useMemo<DockSession>(
    () => ({
      messages,
      busy,
      agentSlug,
      agentName,
      activeAgentSlug,
      pendingContext,
      pinnedContext,
      extraDirective,
      surfaceSelection,
      surfaceChanges,
      activeContextNodeId,
    }),
    [
      messages,
      busy,
      agentSlug,
      agentName,
      activeAgentSlug,
      pendingContext,
      pinnedContext,
      extraDirective,
      surfaceSelection,
      surfaceChanges,
      activeContextNodeId,
    ],
  );

  return (
    <ActionsCtx.Provider value={actions}>
      <LayoutCtx.Provider value={layout}>
        <SessionCtx.Provider value={session}>{children}</SessionCtx.Provider>
      </LayoutCtx.Provider>
    </ActionsCtx.Provider>
  );
}

function use<T>(ctx: React.Context<T | null>, what: string): T {
  const v = useContext(ctx);
  if (!v) throw new Error(`use${what} must be used inside <AssistantDockProvider>`);
  return v;
}

/** The callbacks. Referentially stable for the life of the provider, so a
 *  component that only CALLS things never re-renders because of the dock.
 *  Reach for this one first — four of the eleven consumers need nothing else. */
export function useDockActions(): DockActions {
  return use(ActionsCtx, 'DockActions');
}

/** Panel geometry: open/minimised, docked, width, the popout box. Changes when
 *  the operator moves the dock, NOT when a turn streams. The app shell reads
 *  this and nothing else. */
export function useDockLayout(): DockLayout {
  return use(LayoutCtx, 'DockLayout');
}

/** The conversation and its context marks. `messages` changes per streamed
 *  token, so anything reading this re-renders with the turn — which is correct
 *  for the assistant's own surfaces and wrong for everyone else. */
export function useDockSession(): DockSession {
  return use(SessionCtx, 'DockSession');
}

/**
 * All three at once — so a consumer of this re-renders on ANY dock change.
 * Correct for the assistant's own surfaces, which read from all three anyway.
 * **If you only need callbacks, or only layout, take the narrow hook instead**;
 * this one re-subscribes you to every streamed token.
 */
export function useAssistantDock(): AssistantDockApi {
  const actions = useDockActions();
  const layout = useDockLayout();
  const session = useDockSession();
  return useMemo(() => ({ ...actions, ...layout, ...session }), [actions, layout, session]);
}

/**
 * Persistent assistant bubble. Always present (except while the full panel is
 * open), it summons the panel on click and reflects the engine state: a spinner
 * while a turn runs, an unread dot when a reply lands while the panel is away.
 * Owns the global ⌘I / Ctrl+I shortcut (it stays mounted even when the panel is
 * open, since it only renders null then).
 */
export function AssistantButton({ adminUser = true }: { adminUser?: boolean } = {}) {
  const { panel, busy, toggle, messages } = useAssistantDock();
  const [seenId, setSeenId] = useState<string | null>(null);
  // Blocked runs waiting on an answer — the panel renders the questionnaire,
  // so the button is what tells you to go there. An Admin user's with the
  // Settings area only (/api/pending, chatFeatures().runs).
  const runs = chatFeatures(adminUser, useViewerAreas()).runs;
  const { count: questionCount } = usePendingQuestions({ enabled: runs });
  // Any other login (W7c): the unread replies of its own threads, from the
  // brain (lib/assistant-unread), so a reply that landed elsewhere shows too.
  const threadUnread = useAssistantUnreadCount(!adminUser);

  // Latest settled assistant reply — what an "unread" dot keys off.
  const latestReplyId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m && m.role === 'assistant' && !m.pending) return m.id;
    }
    return null;
  }, [messages]);

  // Opening the panel marks the latest reply seen.
  useEffect(() => {
    if (panel === 'open' && latestReplyId) setSeenId(latestReplyId);
  }, [panel, latestReplyId]);

  // ⌘I lives on the PROVIDER, not here — this button can be mounted more than
  // once (desktop aside + open mobile drawer), and per-instance listeners
  // toggling the same panel cancel each other out.

  const open = panel === 'open';
  const unread = adminUser
    ? !busy && latestReplyId != null && latestReplyId !== seenId
    : !busy && !open && threadUnread > 0;
  // "Needs you" outranks "unread": a parked run is blocked until answered.
  // It stops the moment the panel is OPEN (the question is then on screen) —
  // not when answered, so glancing at it is what clears the alarm.
  const needsYou = questionCount > 0 && !open;

  return (
    <Button
      data-tour="assistant"
      onClick={toggle}
      size="sm"
      variant={open ? 'default' : needsYou ? 'default' : 'ghost'}
      className={cn(
        // `min-w-0` + a truncating label: this button ends the rail's toolbar
        // row, which is full to the pixel at 16rem. Shrinking the word is
        // right; pushing anything out of the rail is not — which is also why
        // the needs-you COUNT is an absolutely-positioned corner badge below
        // rather than an inline flex item: inline it adds ~26px of min-content
        // that `min-w-0` cannot shrink (the label is display:none in the
        // collapsed rail, so there is nothing left to give), and the button
        // overflowed the 3.5rem rail in exactly the state that most needs to
        // be read. The collapsed px-2 trims the last of the slack the same way.
        'relative min-w-0 group-data-[nav-collapsed=true]/shell:px-2',
        needsYou && 'mantle-attention-pulse ring-2 ring-primary ring-offset-1 ring-offset-sidebar',
      )}
      aria-pressed={open}
      aria-label={
        needsYou
          ? `Assistant — ${questionCount} question${questionCount === 1 ? '' : 's'} need${questionCount === 1 ? 's' : ''} your answer (⌘I)`
          : 'Toggle assistant (⌘I)'
      }
      title={
        needsYou
          ? `${questionCount} question${questionCount === 1 ? '' : 's'} waiting on you — open the assistant to answer`
          : 'Assistant (⌘I)'
      }
    >
      {busy ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : needsYou ? (
        <HelpCircle aria-hidden />
      ) : (
        <Sparkles aria-hidden />
      )}
      {/* The one labelled control in the rail's toolbar — it is the anchor of
          that strip, and the three icons beside it read as its neighbours
          rather than as a row of anonymous glyphs. Gone at icon-rail width;
          the mobile drawer portals outside the shell root, so it keeps the
          label there regardless. */}
      <span className="truncate group-data-[nav-collapsed=true]/shell:hidden">Assistant</span>
      {needsYou ? (
        /* Corner badge, a small count pip,
           absolutely positioned so it adds NO min-content width (see the
           className comment above). aria-hidden: the count is already in the
           accessible name. */
        <span
          className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-background px-1 text-[10px] font-semibold tabular-nums text-foreground ring-2 ring-primary"
          aria-hidden
        >
          {questionCount}
        </span>
      ) : (
        unread && (
          <span
            className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-destructive ring-2 ring-sidebar"
            aria-hidden
          />
        )
      )}
    </Button>
  );
}

/**
 * The display switcher, rendered in the assistant's own header
 * (assistant-thread-client) beside minimise: three shapes, all three visible,
 * the current one lit.
 *
 * It replaced a single icon button that flipped between two of them. With a
 * third shape that trick stops working — a lone button can only ever offer
 * "the other one", and with three there is no such thing. Laid out as a group
 * the modes are also self-describing: a reader can see that a popout exists
 * without having to click something to find out what it turns into.
 *
 * Only meaningful while the panel is open, and only on lg+ (below lg the panel
 * is always the full overlay), so it renders nothing otherwise — keeping that
 * header clean when the assistant is closed.
 */
export function AssistantDockToggle() {
  const { panel, display, setDisplay } = useAssistantDock();
  if (panel !== 'open') return null;

  return (
    <ToggleGroup
      type="single"
      value={display}
      // Radix clears the value when the pressed item is pressed again; the
      // panel always HAS a shape, so an empty value is a no-op, not "none".
      onValueChange={(v) => {
        if (v === 'full' || v === 'docked' || v === 'popout') setDisplay(v);
      }}
      aria-label="Assistant display"
      className="hidden lg:inline-flex"
    >
      <ToggleGroupItem value="docked" aria-label="Show as a side column" title="Side column">
        <PanelRight />
      </ToggleGroupItem>
      <ToggleGroupItem value="popout" aria-label="Show as a movable window" title="Window">
        <PictureInPicture2 />
      </ToggleGroupItem>
      <ToggleGroupItem value="full" aria-label="Show as full display" title="Full display">
        <Maximize2 />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
