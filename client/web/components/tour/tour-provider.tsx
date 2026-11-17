'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { runtimeTour } from '@mantle/web-ui/runtime-env';
import {
  decideAutoStart,
  parseTourMemory,
  tourRouteToOpen,
  tourSelector,
  tourStepId,
  tourStorageKey,
  type Rect,
  type Tour,
  type TourMemory,
  type TourStep,
} from '@/lib/tour/model';
import { tourById as builtInTourById } from '@/lib/tour/tours';
import { useShellRole } from '@/components/layout/shell-role';
import { tourWithSync } from '@/lib/sync';
import { useSyncOff } from '@/lib/use-sync-off';

/**
 * The guided tour's state: which tour, which step, and where its target is on
 * screen right now. The overlay (tour-overlay.tsx) draws from this; the shell
 * mounts both.
 *
 * Starting is decided ONCE, after hydration, from three things the server
 * cannot see — the URL, the runtime env script, and this browser's memory —
 * so the server and client first renders agree (no tour) and the tour appears
 * in an effect. Same reasoning as use-persisted-state: two different first
 * renders is a hydration mismatch, and `localStorage` ACCESS throws in a
 * browser that blocks site data, so every touch of it is guarded.
 *
 * Walking is navigation plus a search: a step names a route and the provider
 * pushes it as the step opens (never again while it stays open: the person
 * may go elsewhere), then waits for the step's `data-tour` element to exist before
 * measuring it — the screen behind a route change arrives whenever it
 * arrives. A target that never turns up (a collapsed rail, a scope that hides
 * the item) is reported rather than hung on: the card centres and still says
 * its piece, because a tour that stalls on stop three is worse than one that
 * points at nothing for a moment.
 */

/** How long to wait for a step's element before giving up on pointing at it. */
const TARGET_TIMEOUT_MS = 5_000;
/** Breathing room between the spotlight edge and the element it frames. */
const SPOTLIGHT_PAD = 6;

export type TourActive = { tour: Tour; index: number; step: TourStep };

type Ctx = {
  active: TourActive | null;
  /** The spotlight rectangle, in viewport pixels — null while waiting or when
   *  the step has no target. */
  rect: Rect | null;
  /** True once the wait for this step's target has been given up on. */
  targetMissing: boolean;
  start: (id: string) => void;
  next: () => void;
  back: () => void;
  dismiss: () => void;
};

const TourContext = React.createContext<Ctx | null>(null);

function remember(id: string, memory: TourMemory) {
  try {
    window.localStorage.setItem(tourStorageKey(id), memory);
  } catch {
    // Blocked storage: the tour simply opens again next time. Never a crash.
  }
}

function remembered(id: string): TourMemory | null {
  try {
    return parseTourMemory(window.localStorage.getItem(tourStorageKey(id)));
  } catch {
    return null;
  }
}

/**
 * The first VISIBLE match for a selector. The shell renders some controls
 * twice — the account menu sits in the desktop rail and again in the mobile
 * bar, and whichever is hidden at this width has a zero-size rect at 0,0.
 * `querySelector` returns the first in document order, which on a desktop
 * was the hidden one: the card pinned itself to the top-left corner over
 * nothing. Prefer a match with a box; fall back to any match so a step whose
 * element is present but not yet laid out still resolves.
 */
function findVisible(selector: string): Element | null {
  const all = document.querySelectorAll(selector);
  for (const el of all) {
    const b = el.getBoundingClientRect();
    if (b.width > 0 && b.height > 0) return el;
  }
  return all[0] ?? null;
}

function padded(r: DOMRect): Rect {
  return {
    top: r.top - SPOTLIGHT_PAD,
    left: r.left - SPOTLIGHT_PAD,
    width: r.width + SPOTLIGHT_PAD * 2,
    height: r.height + SPOTLIGHT_PAD * 2,
  };
}

export function TourProvider({
  children,
  tours,
}: {
  children: React.ReactNode;
  /** Override the built-in tours — a seam for previews and tests only. */
  tours?: Readonly<Record<string, Tour>>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // The deployment's tours walk the owner screens: an admin's (the brain's
  // role). Any other login knows no tour, so a ?tour= link starts nothing
  // instead of pushing it to screens it may not open.
  const admin = useShellRole() === 'admin';
  const autoTour = React.useMemo(() => (admin ? runtimeTour() : null), [admin]);
  // The role and Sync come from the same shell answer, so a tour never starts
  // before it is known whether its mail stop is skipped (lib/sync.ts).
  const syncOff = useSyncOff();
  const tourById = React.useCallback(
    (id: string): Tour | null => {
      const tour = tours ? (tours[id] ?? null) : admin ? builtInTourById(id) : null;
      return tour ? tourWithSync(tour, syncOff) : null;
    },
    [tours, admin, syncOff],
  );
  const [state, setState] = React.useState<{ tour: Tour; index: number } | null>(null);
  const [rect, setRect] = React.useState<Rect | null>(null);
  const [targetMissing, setTargetMissing] = React.useState(false);

  const start = React.useCallback(
    (id: string) => {
      const tour = tourById(id);
      if (!tour || !tour.steps.length) return;
      setState((s) => (s && s.tour.id === tour.id ? s : { tour, index: 0 }));
    },
    [tourById],
  );

  // Decide once, after hydration. `?tour=` is read off the location rather
  // than useSearchParams, which would put a Suspense boundary around the
  // whole shell for the sake of one optional flag.
  React.useEffect(() => {
    const urlTour = (() => {
      try {
        return new URLSearchParams(window.location.search).get('tour');
      } catch {
        return null;
      }
    })();
    const id = decideAutoStart({
      urlTour,
      envTour: autoTour,
      pathname,
      known: (candidate) => tourById(candidate) !== null,
      firstRoute: (candidate) => tourById(candidate)?.steps[0]?.route ?? null,
      remembered,
    });
    if (id) start(id);
    // Re-decided on every route change on purpose: the deployment tour waits
    // for its first screen, and a visitor who deep-linked elsewhere reaches
    // it by navigating. Once started, `start` is idempotent for that tour.
  }, [start, tourById, autoTour, pathname]);

  const active = React.useMemo<TourActive | null>(
    () => (state ? { ...state, step: state.tour.steps[state.index]! } : null),
    [state],
  );

  // Go where the step is, once, as it opens (tourRouteToOpen). A route the
  // person picks while the step is open stays theirs. The target search
  // below waits for the route to actually be current, so a slow transition
  // is a wait, not a mismeasure.
  const opened = React.useRef<string | null>(null);
  React.useEffect(() => {
    const step = active ? tourStepId(active.tour.id, active.index) : null;
    const to = tourRouteToOpen({
      step,
      route: active?.step.route ?? null,
      pathname,
      opened: opened.current,
    });
    opened.current = step;
    if (to) router.push(to);
  }, [active, pathname, router]);

  // Find and follow the step's element.
  React.useEffect(() => {
    setRect(null);
    setTargetMissing(false);
    if (!active || pathname !== active.step.route || !active.step.target) return;

    const selector = tourSelector(active.step.target);
    let frame = 0;
    let cancelled = false;
    let el: Element | null = null;
    const startedAt = performance.now();

    const measure = () => {
      if (el) setRect(padded(el.getBoundingClientRect()));
    };
    const seek = () => {
      if (cancelled) return;
      el = findVisible(selector);
      if (el) {
        // `nearest` so a rail item already on screen does not jump the rail.
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        measure();
        window.addEventListener('resize', measure);
        // Capture: scrolls inside <main> or the rail never bubble to window.
        window.addEventListener('scroll', measure, true);
        return;
      }
      if (performance.now() - startedAt > TARGET_TIMEOUT_MS) {
        setTargetMissing(true);
        return;
      }
      frame = requestAnimationFrame(seek);
    };
    seek();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [active, pathname]);

  const next = React.useCallback(() => {
    setState((s) => {
      if (!s) return s;
      if (s.index + 1 >= s.tour.steps.length) {
        remember(s.tour.id, 'done');
        return null;
      }
      return { ...s, index: s.index + 1 };
    });
  }, []);

  const back = React.useCallback(() => {
    setState((s) => (s && s.index > 0 ? { ...s, index: s.index - 1 } : s));
  }, []);

  const dismiss = React.useCallback(() => {
    setState((s) => {
      if (s) remember(s.tour.id, 'dismissed');
      return null;
    });
  }, []);

  const value = React.useMemo<Ctx>(
    () => ({ active, rect, targetMissing, start, next, back, dismiss }),
    [active, rect, targetMissing, start, next, back, dismiss],
  );
  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

/** Inert outside the provider, so a stray consumer never crashes a screen
 *  that renders without the shell. */
export function useTour(): Ctx {
  return (
    React.useContext(TourContext) ?? {
      active: null,
      rect: null,
      targetMissing: false,
      start: () => {},
      next: () => {},
      back: () => {},
      dismiss: () => {},
    }
  );
}
