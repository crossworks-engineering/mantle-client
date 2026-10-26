'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Pause,
  Play,
  RotateCcw,
  Timer,
  Watch,
} from 'lucide-react';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@mantle/web-ui/ui/toggle-group';
import { useToast } from '@mantle/web-ui/ui/toast';
import { cn } from '@mantle/web-ui/lib/utils';
import { useNow } from '@/components/use-now';
import type { DeskWidgetId } from '@/lib/home-desk';
import { DeskWidget, WidgetAction } from '../desk-widget';

// ── Clock ──────────────────────────────────────────────────────────────────

export function greeting(hour: number): string {
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 22) return 'Good evening';
  return 'Good night';
}

/** The time, the date and a greeting by name; digital or a face with hands. */
export function ClockWidget({
  id,
  name,
  face,
  onFace,
  onRemove,
}: {
  id: DeskWidgetId;
  name: string | null;
  face: 'digital' | 'analog';
  onFace: (face: 'digital' | 'analog') => void;
  onRemove: () => void;
}) {
  const now = useNow(1000);
  const d = now ? new Date(now) : null;
  const first = name?.trim().split(/\s+/)[0];
  return (
    <DeskWidget
      id={id}
      title="Clock"
      icon={<Clock />}
      onRemove={onRemove}
      actions={
        <WidgetAction
          label={face === 'digital' ? 'Show a clock face' : 'Show digits'}
          onClick={() => onFace(face === 'digital' ? 'analog' : 'digital')}
        >
          {face === 'digital' ? <Watch /> : <Clock />}
        </WidgetAction>
      }
    >
      <div className="@container flex h-full items-center gap-4 px-4 pb-3">
        {face === 'analog' ? <AnalogFace date={d} /> : null}
        <div className="min-w-0">
          {face === 'digital' ? <DigitalTime date={d} /> : null}
          <p className="truncate text-sm font-medium">
            {d ? `${greeting(d.getHours())}${first ? `, ${first}` : ''}` : '\u00a0'}
          </p>
          <p className="truncate text-sm text-muted-foreground">
            {d
              ? d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
              : '\u00a0'}
          </p>
        </div>
      </div>
    </DeskWidget>
  );
}

/** The hours and minutes large, the seconds and AM or PM (in a locale that
 *  has them) small beside them. */
function DigitalTime({ date }: { date: Date | null }) {
  const parts = date
    ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).formatToParts(date)
    : [];
  const hm = parts
    .filter((p) => p.type !== 'dayPeriod')
    .map((p) => p.value)
    .join('')
    .trim();
  const period = parts.find((p) => p.type === 'dayPeriod')?.value;
  return (
    <div className="flex items-baseline gap-1.5 pb-1 font-[family-name:var(--font-page-title)]">
      <span className="text-4xl font-semibold tabular-nums leading-none tracking-tight @[15rem]:text-5xl">
        {hm || '--:--'}
      </span>
      <span className="flex flex-col text-xs leading-tight text-muted-foreground tabular-nums">
        <span>{date ? String(date.getSeconds()).padStart(2, '0') : ''}</span>
        {period ? <span className="uppercase">{period}</span> : null}
      </span>
    </div>
  );
}

function AnalogFace({ date }: { date: Date | null }) {
  const s = date ? date.getSeconds() : 0;
  const mi = date ? date.getMinutes() + s / 60 : 0;
  const h = date ? (date.getHours() % 12) + mi / 60 : 0;
  const hand = (deg: number, len: number, cls: string, width: number) => (
    <line
      x1="50"
      y1="50"
      x2={50 + len * Math.sin((deg * Math.PI) / 180)}
      y2={50 - len * Math.cos((deg * Math.PI) / 180)}
      strokeLinecap="round"
      strokeWidth={width}
      className={cls}
    />
  );
  return (
    <svg
      viewBox="0 0 100 100"
      className="aspect-square h-full max-h-28 min-h-16 shrink-0"
      aria-hidden
    >
      <circle cx="50" cy="50" r="47" className="fill-background/60 stroke-border" strokeWidth="2" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * 30 * Math.PI) / 180;
        const r1 = i % 3 === 0 ? 36 : 39;
        return (
          <line
            key={i}
            x1={50 + r1 * Math.sin(a)}
            y1={50 - r1 * Math.cos(a)}
            x2={50 + 42 * Math.sin(a)}
            y2={50 - 42 * Math.cos(a)}
            strokeWidth={i % 3 === 0 ? 2.5 : 1.2}
            strokeLinecap="round"
            className="stroke-muted-foreground"
          />
        );
      })}
      {hand(h * 30, 22, 'stroke-foreground', 4)}
      {hand(mi * 6, 32, 'stroke-foreground', 2.6)}
      {date ? hand(s * 6, 36, 'stroke-primary transition-none', 1.2) : null}
      <circle cx="50" cy="50" r="2.6" className="fill-primary" />
    </svg>
  );
}

// ── Calendar ───────────────────────────────────────────────────────────────

type EventRow = { id: string; title: string; startsAt: string; location: string | null };

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Monday-first weeks covering the month that holds `month`. */
export function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - lead);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const days = lead + last.getDate();
  const cells = Math.ceil(days / 7) * 7;
  return Array.from(
    { length: cells },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
}

/**
 * This month as a grid, today ringed and the days with an event dotted,
 * beside what is coming up next. Arrows page the months; the title goes
 * back to today.
 */
export function CalendarWidget({
  id,
  withEvents,
  onRemove,
}: {
  id: DeskWidgetId;
  /** The login reads events (its shell serves the kind); else the month alone. */
  withEvents: boolean;
  onRemove: () => void;
}) {
  const now = useNow(60_000);
  const [offset, setOffset] = useState(0);
  const events = useQuery({
    queryKey: ['events', { q: '', window: 'upcoming', page: 1, ws: null, desk: true }],
    queryFn: () => apiFetch<{ events: EventRow[] }>('/api/events'),
    enabled: withEvents,
  });
  const today = now ? new Date(now) : null;
  const month = today ? new Date(today.getFullYear(), today.getMonth() + offset, 1) : null;
  const cells = useMemo(() => (month ? monthGrid(month) : []), [month?.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const busy = useMemo(() => {
    const set = new Set<string>();
    for (const e of events.data?.events ?? []) set.add(dayKey(new Date(e.startsAt)));
    return set;
  }, [events.data]);
  const upcoming = (events.data?.events ?? []).slice(0, 4);

  return (
    <DeskWidget
      id={id}
      title="Calendar"
      icon={<CalendarDays />}
      onRemove={onRemove}
      actions={
        <>
          <WidgetAction label="Last month" onClick={() => setOffset((o) => o - 1)}>
            <ChevronLeft />
          </WidgetAction>
          <WidgetAction label="Next month" onClick={() => setOffset((o) => o + 1)}>
            <ChevronRight />
          </WidgetAction>
        </>
      }
    >
      <div className="@container flex h-full flex-col gap-2 px-3 pb-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 self-start px-1.5 text-base font-semibold"
          onClick={() => setOffset(0)}
          title="Back to this month"
        >
          {month ? month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : ' '}
        </Button>
        <div className="flex flex-1 flex-col gap-3 @lg:flex-row">
          <div className="grid flex-1 grid-cols-7 content-start gap-0.5 text-center text-xs">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
              <span key={i} className="pb-1 font-medium text-muted-foreground">
                {d}
              </span>
            ))}
            {cells.map((d) => {
              const inMonth = month !== null && d.getMonth() === month.getMonth();
              const isToday = today !== null && dayKey(d) === dayKey(today);
              const hasEvent = busy.has(dayKey(d));
              return (
                <span
                  key={d.toISOString()}
                  className={cn(
                    'relative mx-auto flex size-7 items-center justify-center rounded-full tabular-nums',
                    !inMonth && 'text-muted-foreground/40',
                    isToday && 'bg-primary font-semibold text-primary-foreground',
                  )}
                >
                  {d.getDate()}
                  {hasEvent ? (
                    <span
                      aria-hidden
                      className={cn(
                        'absolute bottom-0.5 size-1 rounded-full',
                        isToday ? 'bg-primary-foreground' : 'bg-primary',
                      )}
                    />
                  ) : null}
                </span>
              );
            })}
          </div>
          {withEvents ? (
            <div className="min-w-0 @lg:w-2/5">
              <p className="pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Coming up
              </p>
              {upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {events.isPending ? 'Looking…' : 'Nothing planned.'}
                </p>
              ) : (
                <ul className="space-y-1">
                  {upcoming.map((e) => {
                    const at = new Date(e.startsAt);
                    return (
                      <li key={e.id}>
                        <Link
                          href={`/events/${encodeURIComponent(e.id)}`}
                          className="flex items-baseline gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-accent hover:text-accent-foreground"
                        >
                          <span className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">
                            {at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                          </span>
                          <span className="min-w-0 truncate">{e.title}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </DeskWidget>
  );
}

// ── Focus timer ────────────────────────────────────────────────────────────

const FOCUS_CHOICES = [15, 25, 50] as const;
const FOCUS_KEY = 'mantle_home_focus_v1';

type FocusState = { minutes: number; endsAt: number | null; leftMs: number };

function readFocus(): FocusState | null {
  try {
    const raw = window.localStorage.getItem(FOCUS_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<FocusState>) : null;
    if (!v || typeof v.minutes !== 'number' || typeof v.leftMs !== 'number') return null;
    return {
      minutes: v.minutes,
      endsAt: typeof v.endsAt === 'number' ? v.endsAt : null,
      leftMs: v.leftMs,
    };
  } catch {
    return null;
  }
}

function writeFocus(s: FocusState) {
  try {
    window.localStorage.setItem(FOCUS_KEY, JSON.stringify(s));
  } catch {
    // Blocked storage: the timer just won't survive a reload.
  }
}

/**
 * A focus timer: pick a stretch, start, and a ring empties as it runs. It
 * keeps running across a reload or a trip to another screen (the end time
 * is kept), and says so with a toast when the stretch is done.
 */
export function FocusWidget({ id, onRemove }: { id: DeskWidgetId; onRemove: () => void }) {
  const toast = useToast();
  const [s, setS] = useState<FocusState>({ minutes: 25, endsAt: null, leftMs: 25 * 60_000 });
  const announced = useRef(false);
  const now = useNow(250);

  useEffect(() => {
    const stored = readFocus();
    if (stored) setS(stored);
  }, []);

  const set = (next: FocusState) => {
    setS(next);
    writeFocus(next);
  };

  const running = s.endsAt !== null;
  const left = running && now ? Math.max(0, s.endsAt! - now) : s.leftMs;
  const total = s.minutes * 60_000;
  const frac = total > 0 ? left / total : 0;

  useEffect(() => {
    if (running && now && left === 0 && !announced.current) {
      announced.current = true;
      toast.success('Focus stretch done. Take a breath.');
      set({ minutes: s.minutes, endsAt: null, leftMs: s.minutes * 60_000 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, now, left]);

  const mm = Math.floor(left / 60_000);
  const ss = Math.floor((left % 60_000) / 1000);
  const R = 42;
  const C = 2 * Math.PI * R;

  return (
    <DeskWidget id={id} title="Focus" icon={<Timer />} onRemove={onRemove}>
      <div className="@container flex h-full items-center gap-3 px-3 pb-3">
        <div className="relative aspect-square h-full max-h-32 max-w-[42%] min-h-16 shrink-0">
          <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
            <circle cx="50" cy="50" r={R} className="fill-none stroke-muted" strokeWidth="8" />
            <circle
              cx="50"
              cy="50"
              r={R}
              className="fill-none stroke-primary transition-[stroke-dashoffset] duration-300"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - frac)}
            />
          </svg>
          <span
            className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums @[14rem]:text-lg"
            aria-live="off"
          >
            {mm}:{String(ss).padStart(2, '0')}
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <ToggleGroup
            type="single"
            size="sm"
            value={String(s.minutes)}
            onValueChange={(v) => {
              if (!v || running) return;
              const m = Number(v);
              set({ minutes: m, endsAt: null, leftMs: m * 60_000 });
            }}
            aria-label="Stretch length"
          >
            {FOCUS_CHOICES.map((m) => (
              <ToggleGroupItem
                key={m}
                value={String(m)}
                disabled={running}
                className="px-2 text-xs"
              >
                {m}m
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={running ? 'outline' : 'default'}
              aria-label={running ? 'Pause the timer' : 'Start the timer'}
              onClick={() => {
                announced.current = false;
                if (running) set({ ...s, endsAt: null, leftMs: left });
                else set({ ...s, endsAt: Date.now() + (s.leftMs > 0 ? s.leftMs : total) });
              }}
            >
              {running ? <Pause /> : <Play />}
              <span className="hidden @[15rem]:inline">
                {running ? 'Pause' : left < total ? 'Resume' : 'Start'}
              </span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Reset the timer"
              onClick={() => set({ minutes: s.minutes, endsAt: null, leftMs: total })}
            >
              <RotateCcw />
            </Button>
          </div>
        </div>
      </div>
    </DeskWidget>
  );
}
