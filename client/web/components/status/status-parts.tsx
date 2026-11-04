'use client';

import * as React from 'react';
import { Area, AreaChart, YAxis } from 'recharts';
import { ChartContainer, type ChartConfig } from '@mantle/web-ui/ui/chart';
import { cn } from '@mantle/web-ui/lib/utils';
import type { Level } from '@/lib/status';

/**
 * The Status screen's small visual parts: the level dot and pill, the
 * radial gauge, the sparkline and the section frame. Status colours are the
 * theme's `success` / `warning` / `destructive` roles (text in their `-ink`),
 * never a literal green or red, so every theme in light and dark holds.
 */

/** Dot fill per level (literal classes, so the Tailwind scanner keeps them). */
export const LEVEL_DOT: Record<Level, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  crit: 'bg-destructive',
  idle: 'bg-muted-foreground/40',
  unknown: 'bg-muted-foreground/25',
};

/** Text ink per level. */
export const LEVEL_INK: Record<Level, string> = {
  ok: 'text-success-ink',
  warn: 'text-warning-ink',
  crit: 'text-destructive-ink',
  idle: 'text-muted-foreground',
  unknown: 'text-muted-foreground',
};

/** SVG stroke per level, for the gauges. */
const LEVEL_STROKE: Record<Level, string> = {
  ok: 'stroke-primary',
  warn: 'stroke-warning',
  crit: 'stroke-destructive',
  idle: 'stroke-muted-foreground/40',
  unknown: 'stroke-muted-foreground/30',
};

export function LevelDot({
  level,
  pulse = false,
  className,
}: {
  level: Level;
  /** A soft ring that breathes: the live, all-good signal. */
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('relative inline-flex size-2.5 shrink-0', className)} aria-hidden>
      {pulse && level === 'ok' && (
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-success/50 motion-reduce:hidden" />
      )}
      <span className={cn('relative inline-flex size-2.5 rounded-full', LEVEL_DOT[level])} />
    </span>
  );
}

/** A bordered pill: dot plus a word. */
export function LevelPill({ level, children }: { level: Level; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-background/60 px-2 py-0.5 text-xs font-medium',
        LEVEL_INK[level],
      )}
    >
      <LevelDot level={level} className="size-2" />
      {children}
    </span>
  );
}

/**
 * A 270° radial gauge: the arc fills with the value and takes the level's
 * colour (primary while fine, warning from 75%, destructive from 90%), the
 * number sits in the middle with its unit and a caption under it.
 */
export function Gauge({
  pct,
  level,
  label,
  value,
  caption,
}: {
  pct: number | null;
  level: Level;
  label: string;
  /** The big text; the percentage when not given. */
  value?: string;
  caption?: string;
}) {
  const r = 40;
  const sweep = 0.75;
  const circ = 2 * Math.PI * r;
  const arc = circ * sweep;
  const clamped = pct == null ? 0 : Math.min(1, Math.max(0, pct / 100));
  return (
    <figure className="flex min-w-0 flex-col items-center gap-1">
      <div className="relative grid size-32 place-items-center">
        <svg viewBox="0 0 100 100" className="size-32 rotate-[135deg]" aria-hidden>
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            className="stroke-foreground/10"
            strokeDasharray={`${arc} ${circ}`}
          />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            className={cn('transition-[stroke-dasharray] duration-700', LEVEL_STROKE[level])}
            strokeDasharray={`${arc * clamped} ${circ}`}
          />
        </svg>
        <div className="absolute flex flex-col items-center">
          <span className="text-2xl font-semibold tabular-nums">
            {value ?? (pct == null ? 'n/a' : `${Math.round(pct)}%`)}
          </span>
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
        </div>
      </div>
      {caption && (
        <figcaption className="max-w-full truncate text-center text-xs text-muted-foreground">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

const SPARK_CONFIG = { v: { label: 'Value', color: 'var(--chart-1)' } } satisfies ChartConfig;

/**
 * A small area line with no axes. `max` pins the top (100 for a percentage),
 * else the data sets it. Fewer than two points draws an empty baseline.
 */
export function Sparkline({
  data,
  max,
  color = 'var(--chart-1)',
  className,
  label,
}: {
  data: (number | null)[];
  max?: number;
  color?: string;
  className?: string;
  /** Accessible name: what the line shows. */
  label: string;
}) {
  const id = React.useId().replace(/:/g, '');
  const rows = data.map((v, i) => ({ i, v: v ?? 0 }));
  return (
    <div className={cn('h-10 w-full', className)} role="img" aria-label={label}>
      {rows.length < 2 ? (
        <div className="flex h-full items-end">
          <div className="h-px w-full bg-border" />
        </div>
      ) : (
        <ChartContainer
          config={{ ...SPARK_CONFIG, v: { ...SPARK_CONFIG.v, color } }}
          className="aspect-auto h-full w-full"
        >
          <AreaChart data={rows} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-v)" stopOpacity={0.45} />
                <stop offset="100%" stopColor="var(--color-v)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <YAxis hide domain={[0, max ?? 'auto']} />
            <Area
              dataKey="v"
              type="monotone"
              stroke="var(--color-v)"
              strokeWidth={1.5}
              fill={`url(#spark-${id})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      )}
    </div>
  );
}

/**
 * One section of the board: an anchor the list scrolls to, a heading with
 * its level, a line on what it covers, and its content.
 */
export function StatusSection({
  id,
  title,
  description,
  level,
  levelText,
  action,
  children,
}: {
  id: string;
  title: string;
  description: string;
  level: Level;
  levelText: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={`status-${id}`}
      aria-labelledby={`status-${id}-h`}
      className="scroll-mt-4 space-y-3"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 space-y-0.5">
          <h2 id={`status-${id}-h`} className="flex items-center gap-2 text-lg font-semibold">
            {title}
            <LevelPill level={level}>{levelText}</LevelPill>
          </h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A label and a number, for the compact stat rows inside a card. */
export function Figure({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 space-y-0.5', className)}>
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className="truncate text-lg font-semibold tabular-nums">{value}</div>
      {hint && <div className="truncate text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
