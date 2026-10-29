'use client';

import Link from 'next/link';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Activity, AlertCircle, CheckCircle2, PanelRight, PanelRightClose } from 'lucide-react';
import { AiThinkingOrb } from '@/components/ai-thinking-orb';
import { GeneratedAvatar } from '@mantle/web-ui/generated-avatar';
import { Button } from '@mantle/web-ui/ui/button';
import { cn } from '@mantle/web-ui/lib/utils';
import { formatMicroUsd } from '@mantle/web-ui/traces-format';
import { ActionIcon } from '@/components/journey/action-icon';
import {
  ageSeconds,
  relativeTime,
  STALL_THRESHOLD_S,
  LIVE_ACTIVITY_POLL_MS,
  useLiveActivity,
} from '@/components/journey/use-live-activity';
import type { ActivityItem } from '@mantle/client-types/journey-format';
import { AreaBackdrop } from '@mantle/web-ui/area-backdrop';
import { RailHandle } from '@mantle/web-ui/ui/rail-handle';
import { ACTIVITY_W_MAX, ACTIVITY_W_MIN } from '@/lib/nav-width';
import { activityChanges } from '@/lib/sounds/events';
import { play } from '@/lib/sounds/play';
import { formatElapsed } from './elapsed';

/**
 * Always-on Activity column in the app shell. Shows what's processing right now
 * (active-first, with stall detection), anything that recently failed, and the
 * stream of what entered the brain — human-labelled with outcome counts, not
 * raw trace kinds. Links into the Journey story. Polls /api/activity — every 5s
 * while expanded, far slower while collapsed (see COLLAPSED_POLL_MS).
 *
 * Collapses to a narrow icon rail (`collapsed`): just status pips — running /
 * failed / recent counts — that expand the panel on click. Width tracks the
 * shell's `--activity-w` var so `main`/FleetLayout offsets stay in lockstep.
 * Both collapse and expand are controls on THIS column (header button one way,
 * rail button the other); they used to share the shell's footer bar with the
 * left rail's toggle, and that bar no longer exists.
 *
 * Sounds: an item that starts running plays `start`, one that ends plays
 * `complete` or `danger` (lib/sounds/events.ts `activityChanges`), once per
 * item across this browser's tabs. Items running at load stay quiet. Heard as
 * fast as the poll: within 5s expanded, within a minute collapsed.
 */

/** "what entered the brain" — outcome summary for content actions. */
function outcomeText(it: ActivityItem): string | null {
  if (it.category !== 'content') return null;
  const parts: string[] = [];
  if (it.factCount > 0) parts.push(`${it.factCount} fact${it.factCount === 1 ? '' : 's'}`);
  if (it.mentionCount > 0)
    parts.push(`${it.mentionCount} ${it.mentionCount === 1 ? 'entity' : 'entities'}`);
  if (it.relationCount > 0)
    parts.push(`${it.relationCount} relation${it.relationCount === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' · ') : 'indexed';
}

/** A live, self-ticking elapsed timer for an in-flight item — counts up every
 *  second (independent of the 5s activity poll) so a long-running process still
 *  visibly progresses instead of looking frozen. */
function ElapsedTimer({ startedAt }: { startedAt: string }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return <>{formatElapsed(ageSeconds(startedAt))}</>;
}

/** Order the active list for display: delegated child runs (parent_trace_id
 *  pointing at another ACTIVE item) nest under their ROOT ancestor, so a
 *  fan-out reads as one block. Grouping by root — not direct parent — matters
 *  because delegation chains go 3 deep (responder → specialist → specialist);
 *  grouping by parent would silently drop the grandchild, whose parent is not
 *  a root row. A child whose ancestors already finished (or, defensively, a
 *  cyclic chain) renders as a plain root row — better shown flat than hidden. */
function groupActive(active: ActivityItem[]): { item: ActivityItem; children: ActivityItem[] }[] {
  const ids = new Set(active.map((i) => i.traceId));
  const parentOf = new Map<string, string>();
  for (const it of active) {
    const parent = it.parentTraceId;
    if (parent && parent !== it.traceId && ids.has(parent)) parentOf.set(it.traceId, parent);
  }
  const rootOf = (id: string): string => {
    let cur = id;
    const seen = new Set([cur]);
    while (parentOf.has(cur)) {
      const next = parentOf.get(cur)!;
      if (seen.has(next)) return id; // cycle — degrade to flat, never vanish
      seen.add(next);
      cur = next;
    }
    return cur;
  };
  const childrenOf = new Map<string, ActivityItem[]>();
  const roots: ActivityItem[] = [];
  for (const it of active) {
    const root = rootOf(it.traceId);
    if (root === it.traceId) {
      roots.push(it);
    } else {
      const list = childrenOf.get(root) ?? [];
      list.push(it);
      childrenOf.set(root, list);
    }
  }
  return roots.map((item) => ({ item, children: childrenOf.get(item.traceId) ?? [] }));
}

/** One in-flight row: what is running, WHO is running it (agent avatar + name,
 *  worker slug for pipeline runs), and for how long. `nested` = a delegated
 *  child run, indented under its parent. */
function ActiveRow({ it, nested }: { it: ActivityItem; nested?: boolean }) {
  const longRunning = ageSeconds(it.startedAt) > STALL_THRESHOLD_S;
  const whoName = it.agentName ?? it.workerSlug;
  const whoSeed = it.avatarSeed ?? it.workerSlug;
  return (
    <Row it={it} indent={nested}>
      <div className="flex items-center gap-2">
        {/* Always animating — a long-running process is busy,
            not broken; the elapsed timer shows progress. The
            orb's animation follows the item's label. */}
        <AiThinkingOrb label={it.label} className="shrink-0" />
        <ActionIcon iconKey={it.iconKey} className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{it.label}</span>
        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
          <ElapsedTimer startedAt={it.startedAt} />
        </span>
      </div>
      {whoName && whoSeed && (
        <div className="flex items-center gap-1.5 pl-5 text-xs text-muted-foreground">
          <GeneratedAvatar seed={whoSeed} size={14} />
          <span className="truncate">{whoName}</span>
          {nested && (
            <span className="shrink-0 text-[10px] uppercase tracking-wider opacity-70">
              delegated
            </span>
          )}
          {longRunning && <span className="ml-auto shrink-0">busy</span>}
        </div>
      )}
      {!whoName && longRunning && <div className="pl-5 text-xs text-muted-foreground">busy</div>}
    </Row>
  );
}

/**
 * The collapsed rail's poll. It shows three counts, so it is refreshed for the
 * sake of a badge rather than a feed — and it is the state the column is in on
 * every route by default. Slow enough to stop being a cost, quick enough that a
 * run started elsewhere shows up while you are still looking at the screen.
 * Expanding drops straight back to `LIVE_ACTIVITY_POLL_MS` and refetches at
 * once, so opening the column is never a wait.
 */
const COLLAPSED_POLL_MS = 60_000;

export function LiveColumn({
  collapsed,
  onToggle,
  width,
  onWidthChange,
  onWidthDraggingChange,
}: {
  collapsed: boolean;
  onToggle: () => void;
  width: number;
  onWidthChange: (px: number) => void;
  /** Fires on grab and release of the width drag, so the shell can suspend its
   *  transitions — the width itself now only arrives on release. */
  onWidthDraggingChange?: (dragging: boolean) => void;
}) {
  // Collapsed is the DEFAULT, and the collapsed rail shows three counts and no
  // timestamps — so it needs neither the 5s poll nor the 5s re-render. This
  // component is mounted by the shell on every signed-in route, which is what
  // made a hidden 5s cadence expensive out of all proportion to what it showed.
  const { data, loaded, tick } = useLiveActivity(
    collapsed ? COLLAPSED_POLL_MS : LIVE_ACTIVITY_POLL_MS,
    collapsed ? null : LIVE_ACTIVITY_POLL_MS,
  );
  void tick; // re-render cue for relative timestamps
  const running = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (!data) return;
    const change = activityChanges(running.current, data);
    running.current = change.known;
    for (const id of change.starts) play('start', { once: `activity:start:${id}` });
    for (const end of change.ends) play(end.sound, { once: `activity:end:${end.id}` });
  }, [data]);
  const active = data?.active ?? [];
  const failures = data?.failures ?? [];
  const recent = data?.recent ?? [];
  const live = active.length > 0;
  const hasAny = active.length + failures.length + recent.length > 0;

  return (
    <aside
      data-tour="activity"
      className="fixed inset-y-0 right-0 z-30 hidden w-[var(--activity-w)] flex-col border-l bg-sidebar lg:flex"
    >
      {/* `-z-10`: the aside is `fixed z-30` and so owns a stacking context, in
          which a negative-z child paints above its background but below the
          content. Renders nothing when the activity area is switched off. */}
      <AreaBackdrop area="activity" className="-z-10" />
      {/* Pinned to the right, so the grab edge is on its LEFT. Collapsed rails
          aren't draggable — the toggle owns that width (same rule as the nav). */}
      {collapsed ? null : (
        <RailHandle
          side="left"
          label="Resize activity column"
          value={width}
          min={ACTIVITY_W_MIN}
          max={ACTIVITY_W_MAX}
          onChange={onWidthChange}
          // This column IS `--activity-w`; the drag writes it on the shell root
          // and reports once, on release, rather than re-rendering the frame on
          // every pointermove.
          liveVar="--activity-w"
          onDraggingChange={onWidthDraggingChange}
        />
      )}
      {collapsed ? (
        <CollapsedRail
          active={active.length}
          failures={failures.length}
          recent={recent.length}
          loaded={loaded}
          onToggle={onToggle}
        />
      ) : (
        <>
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Activity
              className={cn(
                'size-4 shrink-0',
                live ? 'animate-pulse text-success-ink' : 'text-muted-foreground',
              )}
              aria-hidden
            />
            <h2 className="text-sm font-semibold">Activity</h2>
            {live && (
              <span className="shrink-0 text-xs text-success-ink">{active.length} live</span>
            )}
            <Link
              href="/debug/journey"
              className="ml-auto shrink-0 text-xs text-muted-foreground hover:text-foreground"
            >
              View all
            </Link>
            {/* Collapse lives on the column it collapses. It used to sit in the
                shell's footer bar, which spanned the whole window and could
                reasonably hold both rails' toggles; with the footer gone its
                only other home would be the left rail, which is the wrong end
                of the screen to reach for when shrinking this one. The
                collapsed rail's own expand button is the mirror of this. */}
            <Button
              variant="ghost"
              onClick={onToggle}
              aria-label="Collapse activity"
              title="Collapse activity (⌘J)"
              className="-mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              <PanelRightClose className="size-4" aria-hidden />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {!loaded ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <AiThinkingOrb size={20} />
              </div>
            ) : !hasAny ? (
              <div className="flex flex-col items-center justify-center px-4 py-12 text-center text-sm text-muted-foreground">
                <Activity className="mb-3 size-10 opacity-30" aria-hidden />
                <p className="font-medium">No recent activity</p>
                <p className="mt-1 text-xs">
                  Agent runs, ingests, and heartbeats will stream in here.
                </p>
              </div>
            ) : (
              <>
                {active.length > 0 && (
                  <Section label="Active now">
                    {groupActive(active).map(({ item, children }) => (
                      <Fragment key={item.traceId}>
                        <ActiveRow it={item} />
                        {children.map((child) => (
                          <ActiveRow key={child.traceId} it={child} nested />
                        ))}
                      </Fragment>
                    ))}
                  </Section>
                )}

                {failures.length > 0 && (
                  <Section label="Needs attention">
                    {failures.map((it) => (
                      <Row key={it.traceId} it={it}>
                        <div className="flex items-center gap-2">
                          <AlertCircle
                            className="size-3.5 shrink-0 text-destructive-ink"
                            aria-hidden
                          />
                          <ActionIcon
                            iconKey={it.iconKey}
                            className="size-3.5 shrink-0 text-destructive-ink"
                          />
                          <span className="truncate text-sm font-medium">{it.label}</span>
                          <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                            {relativeTime(it.startedAt)}
                          </span>
                        </div>
                        <div className="pl-5 text-xs text-destructive-ink">failed</div>
                      </Row>
                    ))}
                  </Section>
                )}

                {recent.length > 0 && (
                  <Section label="Recent">
                    {recent.map((it) => {
                      const outcome = outcomeText(it);
                      return (
                        <Row key={it.traceId} it={it}>
                          <div className="flex items-center gap-2">
                            <ActionIcon
                              iconKey={it.iconKey}
                              className="size-3.5 shrink-0 text-muted-foreground"
                            />
                            <span className="truncate text-sm font-medium">{it.label}</span>
                            <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                              {relativeTime(it.startedAt)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 pl-5 text-xs text-muted-foreground">
                            {it.title && <span className="truncate">{it.title}</span>}
                            {outcome && (
                              <span className="ml-auto shrink-0 rounded bg-success/10 px-1.5 py-0.5 text-success-ink">
                                {outcome}
                              </span>
                            )}
                            {!outcome && it.costMicroUsd > 0 && (
                              <span className="ml-auto shrink-0 tabular-nums">
                                {formatMicroUsd(it.costMicroUsd)}
                              </span>
                            )}
                          </div>
                        </Row>
                      );
                    })}
                  </Section>
                )}
              </>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

/** The collapsed icon rail: an expand button + busy / failed / done pips. */
function CollapsedRail({
  active,
  failures,
  recent,
  loaded,
  onToggle,
}: {
  active: number;
  failures: number;
  recent: number;
  loaded: boolean;
  onToggle: () => void;
}) {
  const idle = loaded && active + failures + recent === 0;
  return (
    <div className="flex flex-1 flex-col items-center gap-1 overflow-y-auto py-2 scrollbar-none">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onToggle}
        aria-label="Expand activity"
        title="Expand activity (⌘J)"
        className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <PanelRight className="size-4" aria-hidden />
      </Button>
      <div className="my-1 h-px w-6 bg-border" />

      {!loaded && <AiThinkingOrb />}

      <StatusPip
        show={active > 0}
        count={active}
        title={`${active} running`}
        onClick={onToggle}
        icon={<AiThinkingOrb />}
      />
      <StatusPip
        show={failures > 0}
        count={failures}
        title={`${failures} failed`}
        onClick={onToggle}
        icon={<AlertCircle className="size-4 text-destructive-ink" aria-hidden />}
      />
      <StatusPip
        show={recent > 0}
        count={recent}
        title={`${recent} recently completed`}
        onClick={onToggle}
        icon={<CheckCircle2 className="size-4 text-muted-foreground" aria-hidden />}
      />

      {idle && <Activity className="mt-1 size-4 text-muted-foreground opacity-30" aria-hidden />}
    </div>
  );
}

function StatusPip({
  icon,
  count,
  title,
  onClick,
  show,
}: {
  icon: React.ReactNode;
  count: number;
  title: string;
  onClick: () => void;
  show: boolean;
}) {
  if (!show) return null;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="relative flex size-9 items-center justify-center rounded-md transition-colors hover:bg-foreground/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {icon}
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground ring-2 ring-sidebar">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </Button>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="sticky top-0 z-10 bg-sidebar/95 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
        {label}
      </div>
      <ul className="divide-y divide-border">{children}</ul>
    </div>
  );
}

function Row({
  it,
  indent,
  children,
}: {
  it: ActivityItem;
  /** Delegated child run — indent under the parent row above it. */
  indent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={`/debug/journey/${it.traceId}`}
        // Neutral foreground-overlay hover (not a colour tint): the column is
        // bg-sidebar (== muted in some themes, so bg-muted would be invisible),
        // and a coloured accent tint blends with the grey muted-foreground meta
        // text. A faint neutral overlay stays visible over any sidebar value in
        // light + dark while keeping the grey text legible.
        className={cn(
          'flex flex-col gap-0.5 px-4 py-2.5 transition-colors hover:bg-foreground/[0.06]',
          indent && 'pl-8',
        )}
      >
        {children}
      </Link>
    </li>
  );
}
