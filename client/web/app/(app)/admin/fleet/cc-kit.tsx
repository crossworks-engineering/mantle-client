'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CircleCheck, Info, OctagonAlert } from 'lucide-react';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { Checkbox } from '@mantle/web-ui/ui/checkbox';
import { ListCard, ListCardMeta, ListCardTitle } from '@mantle/web-ui/ui/list-card';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { cn } from '@mantle/web-ui/lib/utils';
import {
  boxName,
  FLEET_KEY,
  fleetKeysOffered,
  ipLine,
  keyUpdatePending,
  type FleetBox,
  type FleetOverview,
} from '@/lib/fleet';
import {
  fleetMatrixOffered,
  FLEET_MATRIX_KEY,
  FLEET_MATRIX_PATH,
  type FleetMatrixRow,
} from '@/lib/fleet-matrix';
import { fleetWritesOffered, writeUpdatePending } from '@/lib/fleet-writes';
import { boxesText, type Tone } from '@/lib/fleet-view';
import type { Level } from '@/lib/status';
import { fleetQuery } from '@/lib/use-fleet-shown';

/**
 * The shared parts of the Control Center screens (owner, 2026-11-11). Every
 * screen is one MasterDetail: a card list on the left (boxes, bans, the
 * things that need an admin), what the picked card holds on the right. No
 * screen opens a dialog to show or to edit; a dialog only asks the one
 * question before a change goes.
 */

// --- the one read ---------------------------------------------------------------

/** The Fleet read every Control Center screen shares, read again every 3 s
 *  while a box still waits on a key or a change. When the last change is
 *  answered the matrix is read again: it then shows the new models. */
export function useFleet() {
  const queryClient = useQueryClient();
  const query = useQuery({
    ...fleetQuery,
    refetchInterval: (q: { state: { data?: FleetOverview | null } }) =>
      keyUpdatePending(q.state.data?.boxes) || writeUpdatePending(q.state.data?.boxes)
        ? 3000
        : false,
  });
  const waiting = writeUpdatePending(query.data?.boxes);
  const wasWaiting = useRef(waiting);
  useEffect(() => {
    if (wasWaiting.current && !waiting) {
      void queryClient.invalidateQueries({ queryKey: FLEET_MATRIX_KEY });
    }
    wasWaiting.current = waiting;
  }, [waiting, queryClient]);
  // FLEET_KEY is the matrix key's first part: the matrix is read again too.
  const refresh = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: FLEET_KEY }),
    [queryClient],
  );
  return { query, refresh };
}

export type MatrixAnswer = { boxes: FleetMatrixRow[] };

/** The one read of the whole matrix: every screen that shows a box's facts
 *  shares it. */
export const matrixQuery = {
  queryKey: FLEET_MATRIX_KEY,
  queryFn: () => apiFetch<MatrixAnswer>(FLEET_MATRIX_PATH),
  staleTime: 30_000,
};

/** The matrix rows, or none on a brain before the matrix. */
export function useMatrixRows(boxes: readonly FleetBox[]) {
  const query = useQuery({ ...matrixQuery, enabled: fleetMatrixOffered(boxes) });
  return { query, rows: query.data?.boxes ?? [] };
}

const NEEDS = {
  keys: { offered: fleetKeysOffered, name: 'the provider key update' },
  matrix: { offered: fleetMatrixOffered, name: 'the fleet matrix' },
  writes: { offered: fleetWritesOffered, name: 'the fleet changes' },
} as const;

function Plain({ tone = 'muted', children }: { tone?: 'muted' | 'bad'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'p-6 text-sm',
        tone === 'bad' ? 'text-destructive-ink' : 'text-muted-foreground',
      )}
    >
      {children}
    </div>
  );
}

/**
 * The frame of one Control Center screen: it reads the Fleet and says so
 * plainly when it cannot show the screen (loading, a failed read, a box that
 * is not a Control Center, a brain a release behind). `needs` names the part
 * of the brain the screen is for.
 */
export function FleetScreen({
  needs,
  children,
}: {
  needs?: keyof typeof NEEDS;
  children: (data: FleetOverview, refresh: () => void) => ReactNode;
}) {
  const { query, refresh } = useFleet();
  if (query.isLoading) {
    return (
      <div className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
        <Spinner size={20} /> Loading…
      </div>
    );
  }
  if (query.data === undefined) return <Plain tone="bad">Could not load the Fleet.</Plain>;
  if (query.data === null) return <Plain>This box is not a Control Center.</Plain>;
  const data = query.data;
  if (needs && data.boxes.length > 0 && !NEEDS[needs].offered(data.boxes)) {
    return <Plain>This brain is a release behind: it does not have {NEEDS[needs].name} yet.</Plain>;
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      {query.isError && (
        <p role="status" className="border-b border-border px-4 py-2 text-sm text-destructive-ink">
          Could not read the latest state. This may be out of date.
        </p>
      )}
      <div className="min-h-0 flex-1">{children(data, refresh)}</div>
    </div>
  );
}

// --- which card is open: in the address -------------------------------------------

/** One value of the address (`?box=<id>`), so a card can be linked to from
 *  another screen and a reload keeps it open. */
export function useParam(name: string): [string | null, (value: string | null) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const value = params.get(name);
  const set = useCallback(
    (next: string | null) => {
      const q = new URLSearchParams(params.toString());
      if (next === null) q.delete(name);
      else q.set(name, next);
      const text = q.toString();
      router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
    },
    [router, pathname, params, name],
  );
  return [value, set];
}

// --- small parts ------------------------------------------------------------------

const PILL_TONE: Record<Tone | 'muted', string> = {
  ok: 'border-success/50 text-success-ink',
  wait: 'border-info/50 text-info-ink',
  warn: 'border-warning/60 text-warning-ink',
  bad: 'border-destructive/50 text-destructive-ink',
  muted: 'border-muted-foreground/40 text-muted-foreground',
};

/** The state pill of a card or a header (the item list's pill shape). */
export function Pill({
  tone = 'muted',
  mono = false,
  children,
}: {
  tone?: Tone | 'muted';
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4',
        mono && 'font-mono',
        PILL_TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

/** A health level as a tone. */
export const LEVEL_TONE: Record<Level, Tone | 'muted'> = {
  ok: 'ok',
  warn: 'warn',
  crit: 'bad',
  idle: 'muted',
  unknown: 'muted',
};

export const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-muted-foreground',
  wait: 'text-info-ink',
  warn: 'text-warning-ink',
  bad: 'text-destructive-ink',
};

/** A small round mark of a state, beside a name. */
export function Dot({ tone }: { tone: Tone | 'muted' }) {
  const fill = {
    ok: 'bg-success',
    wait: 'bg-info',
    warn: 'bg-warning',
    bad: 'bg-destructive',
    muted: 'bg-muted-foreground/40',
  }[tone];
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', fill)} />;
}

const CALLOUT = {
  info: { box: 'border-border bg-muted/40', ink: 'text-foreground', Icon: Info },
  ok: { box: 'border-success/40 bg-success/10', ink: 'text-success-ink', Icon: CircleCheck },
  warn: { box: 'border-warning/50 bg-warning/10', ink: 'text-warning-ink', Icon: AlertTriangle },
  bad: {
    box: 'border-destructive/40 bg-destructive/10',
    ink: 'text-destructive-ink',
    Icon: OctagonAlert,
  },
} as const;

/** One boxed line that must be read: a warning, a refusal, a good state. */
export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: keyof typeof CALLOUT;
  title?: string;
  children?: ReactNode;
}) {
  const c = CALLOUT[tone];
  return (
    <div
      role={tone === 'info' || tone === 'ok' ? undefined : 'status'}
      className={cn('flex items-start gap-2.5 rounded-lg border p-3 text-sm', c.box)}
    >
      <c.Icon className={cn('mt-0.5 size-4 shrink-0', c.ink)} aria-hidden />
      <div className="min-w-0 space-y-0.5">
        {title && <p className={cn('font-medium', c.ink)}>{title}</p>}
        {children && <div className="text-foreground">{children}</div>}
      </div>
    </div>
  );
}

/** One number an admin reads at a glance. */
export function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/70 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 truncate text-xl font-semibold tabular-nums leading-7',
          tone && tone !== 'ok' && TONE_TEXT[tone],
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function Tiles({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">{children}</div>
  );
}

/** A titled part of a detail pane. */
export function Part({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Label and value lines: what a record holds. */
export function Facts({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd className="min-w-0 break-words">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// --- the two panes -----------------------------------------------------------------

/** The list pane: its heading and one action, then the cards. */
export function ListPane({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <h2 className="truncate text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        {action}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 scrollbar-thin">{children}</div>
    </div>
  );
}

export function ListEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

/** The detail pane: one 44px header (the title, one pill, the actions), then
 *  the body at the pane's 24px inset. */
export function DetailPane({
  icon,
  title,
  pill,
  actions,
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  pill?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 flex h-11 shrink-0 items-center gap-2 border-b border-border bg-background/60 px-4 backdrop-blur">
        <h2 className="flex min-w-0 items-center gap-2 text-[0.9375rem] font-semibold">
          {icon && (
            <span className="flex shrink-0 text-muted-foreground [&_svg]:size-4">{icon}</span>
          )}
          <span className="truncate">{title}</span>
        </h2>
        {pill}
        {actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      <div className="space-y-6 p-6">{children}</div>
    </div>
  );
}

/** A link styled as a quiet button: the way from one screen to another. */
export function ScreenLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={href}>{children}</Link>
    </Button>
  );
}

// --- the boxes a change goes to ----------------------------------------------------

/** The boxes a change goes to. A box removed since it was picked is not sent. */
export function useBoxPick(boxes: readonly FleetBox[]) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const chosen = boxes.filter((b) => picked.has(b.id));
  return { picked, setPicked, chosen, count: boxesText(chosen.length) };
}

/**
 * The list pane of a screen that sends a change: one card per box, each a
 * tick box, with All boxes or Clear above. The picked boxes are where the
 * form on the right sends. `line` is what a card says under the name: the
 * box's own state for this kind of change.
 */
export function TargetList({
  boxes,
  picked,
  setPicked,
  line,
}: {
  boxes: readonly FleetBox[];
  picked: Set<string>;
  setPicked: (next: Set<string>) => void;
  line?: (box: FleetBox) => { tone: Tone; text: ReactNode } | null;
}) {
  const prefix = useId();
  const all = boxes.length > 0 && boxes.every((b) => picked.has(b.id));
  const count = boxes.filter((b) => picked.has(b.id)).length;
  const toggle = (id: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };
  return (
    <ListPane
      title={count > 0 ? `Send to ${boxesText(count)}` : 'Send to'}
      action={
        boxes.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setPicked(all ? new Set() : new Set(boxes.map((b) => b.id)))}
          >
            {all ? 'Clear' : 'All boxes'}
          </Button>
        ) : undefined
      }
    >
      {boxes.length === 0 ? (
        <ListEmpty>No box is linked.</ListEmpty>
      ) : (
        <ul className="space-y-2" aria-label="Boxes to send to">
          {boxes.map((b) => {
            const id = `${prefix}-${b.id}`;
            const on = picked.has(b.id);
            const said = line?.(b) ?? null;
            const ip = ipLine(b.ips);
            return (
              <li key={b.id}>
                <ListCard asChild selected={on}>
                  <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5">
                    <Checkbox
                      id={id}
                      className="mt-0.5"
                      checked={on}
                      aria-label={boxName(b)}
                      onCheckedChange={(v) => toggle(b.id, v === true)}
                    />
                    <span className="min-w-0 flex-1">
                      <ListCardTitle>{boxName(b)}</ListCardTitle>
                      {said ? (
                        <span className={cn('mt-0.5 block text-xs', TONE_TEXT[said.tone])}>
                          {said.text}
                        </span>
                      ) : (
                        <>
                          <ListCardMeta>{b.url}</ListCardMeta>
                          {ip && (
                            <ListCardMeta className="font-mono" title={ip.title}>
                              {ip.text}
                            </ListCardMeta>
                          )}
                        </>
                      )}
                    </span>
                  </label>
                </ListCard>
              </li>
            );
          })}
        </ul>
      )}
    </ListPane>
  );
}

/** The foot of a form that sends: how many boxes, then the button. */
export function SendBar({ count, children }: { count: number; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
      <p className="text-xs text-muted-foreground">
        {count === 0 ? 'Tick the boxes on the left first.' : `${boxesText(count)} picked.`}
      </p>
      {children}
    </div>
  );
}
