import { Gauge } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@mantle/web-ui/ui/card';
import { formatCount } from '@mantle/web-ui/lib/format-bytes';
import { cn } from '@mantle/web-ui/lib/utils';
import type { BrainCapacity, CapacityZone } from '@mantle/client-types';

/** Zone colours (literal classes so the Tailwind scanner keeps them). Green
 *  rides `primary` like the vitals scheme; watch/split mirror warn/crit. */
const ZONE_STROKE: Record<CapacityZone, string> = {
  green: 'stroke-primary',
  watch: 'stroke-warning',
  split: 'stroke-destructive',
};
const ZONE_FILL: Record<CapacityZone, string> = {
  green: 'bg-primary',
  watch: 'bg-warning',
  split: 'bg-destructive',
};
const ZONE_TEXT: Record<CapacityZone, string> = {
  green: 'text-muted-foreground',
  watch: 'text-warning-ink',
  split: 'text-destructive-ink',
};
const ZONE_LABEL: Record<CapacityZone, string> = {
  green: 'green: no action',
  watch: 'watch: run recall checks',
  split: 'split: break out a brain',
};

/** The dial: an SVG donut showing worst-axis fill vs the split budget.
 *  Same pattern as usage-card's ContextRing, sized up for a dashboard card. */
function CapacityRing({ pct, zone }: { pct: number; zone: CapacityZone }) {
  const r = 42;
  const circ = 2 * Math.PI * r;
  const clamped = Math.min(1, Math.max(0, pct / 100));
  return (
    <div className="relative grid size-32 shrink-0 place-items-center">
      <svg viewBox="0 0 100 100" className="size-32 -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="9" className="stroke-muted" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth="9"
          strokeLinecap="round"
          className={cn('transition-all duration-700', ZONE_STROKE[zone])}
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - clamped)}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-2xl font-semibold tabular-nums">{pct}%</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">of split</span>
      </div>
    </div>
  );
}

function AxisBar({
  label,
  count,
  watch,
  split,
  zone,
}: {
  label: string;
  count: number;
  watch: number;
  split: number;
  zone: CapacityZone;
}) {
  const pct = Math.min(100, (count / split) * 100);
  const watchPct = (watch / split) * 100;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">
          {formatCount(count)} / {formatCount(split)}
        </span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all duration-500', ZONE_FILL[zone])}
          style={{ width: `${pct}%` }}
        />
        {/* watch-threshold tick */}
        <div
          className="absolute inset-y-0 w-px bg-foreground/30"
          style={{ left: `${watchPct}%` }}
          aria-hidden
        />
      </div>
    </div>
  );
}

/** The latest `recall_eval` passage score. Mirrors `RetrievalScore` in
 *  @mantle/client-types (added with mantle's capacity `retrieval` field);
 *  declared here so the card also renders against a server without it. */
type RetrievalScore = { at: string; cases: number; recallAt10: number; mrr: number };

/** Size says when to look; the measured score says whether quality moved. */
function RetrievalLine({ retrieval }: { retrieval: RetrievalScore | null | undefined }) {
  if (retrieval === undefined) return null;
  if (!retrieval)
    return (
      <p className="text-xs text-muted-foreground">
        Retrieval not measured yet. Add a note tagged recall-eval-cases to score it weekly.
      </p>
    );
  const day = new Date(retrieval.at).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
      <span className="text-muted-foreground">Retrieval, last check {day}</span>
      <span className="font-medium tabular-nums">
        {Math.round(retrieval.recallAt10 * 100)}% in top 10 · {retrieval.cases} questions
      </span>
    </div>
  );
}

/**
 * Brain capacity card — real corpus counts vs the split policy (watch 10k
 * docs / 100k passages; split 20k / 250k, the passage numbers measured on a
 * scale curve, mantle docs/recall-eval.md). The dial reads the WORST axis; the
 * bars show each axis with its watch tick; the last line is the measured
 * retrieval score from the weekly recall check.
 */
export function CapacityDial({ capacity }: { capacity: BrainCapacity }) {
  return (
    <Card className="@container">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="size-4 text-muted-foreground" aria-hidden />
          Brain capacity
        </CardTitle>
        <CardDescription>
          Corpus against the split policy, zone{' '}
          <span className={cn('font-medium', ZONE_TEXT[capacity.zone])}>
            {ZONE_LABEL[capacity.zone]}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-6 @sm:flex-row">
        <CapacityRing pct={capacity.pctOfSplit} zone={capacity.zone} />
        <div className="w-full min-w-0 flex-1 space-y-4">
          <AxisBar
            label="Documents"
            count={capacity.docs.count}
            watch={capacity.docs.watch}
            split={capacity.docs.split}
            zone={capacity.docs.zone}
          />
          <AxisBar
            label="Passage vectors"
            count={capacity.chunkVectors.count}
            watch={capacity.chunkVectors.watch}
            split={capacity.chunkVectors.split}
            zone={capacity.chunkVectors.zone}
          />
          <RetrievalLine
            retrieval={
              (capacity as BrainCapacity & { retrieval?: RetrievalScore | null }).retrieval
            }
          />
          <p className="text-xs text-muted-foreground">
            Retrieval loses a little with every doubling of the corpus. A split helps once a whole
            category can move to its own brain.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
