'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@mantle/web-ui/api-fetch';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { SetPageTitle } from '@/components/layout/page-title';
import type { HeartbeatDTO, HeartbeatFireSummary } from '@mantle/client-types';
import { JsonView } from '@mantle/web-ui/ui/json-view';
import {
  HIDDEN_STATE_TEXT,
  NOT_YOURS,
  heartbeatMakerText,
  heartbeatStateHidden,
} from '@/lib/heartbeat-maker';
import { useViewerLogin } from '@/components/workspaces/use-shell-workspaces';

type DetailLabels = {
  nextFireAt: string;
  lastFiredAt: string;
  fires: Record<string, string>;
};
type DetailData = {
  heartbeat: HeartbeatDTO;
  fires: HeartbeatFireSummary[];
  labels: DetailLabels;
};

/**
 * /heartbeats/[id] — single-heartbeat biography, data-free.
 *
 * Fetches the heartbeat, its last 50 fires, and the profile-formatted date
 * labels from GET /api/heartbeats/[id]/detail. Shows current state,
 * schedule, gates, and the fires (both successful + skipped); each fire links
 * to its trace if one was opened. Who set it up (W7a): only that user (its
 * maker) reads its state and what its fires said and changed; for anyone
 * else the brain sends none of it, and the screen says so.
 */
export function HeartbeatDetailClient({ id }: { id: string }) {
  const viewer = useViewerLogin();
  const detailQuery = useQuery({
    queryKey: ['heartbeats', id, 'detail'],
    queryFn: () => apiFetch<DetailData>(`/api/heartbeats/${id}/detail`),
    retry: false,
  });

  if (detailQuery.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }
  if (detailQuery.isError) {
    const notFound = detailQuery.error instanceof ApiError && detailQuery.error.status === 404;
    return (
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-3 px-6 py-12 text-center text-sm text-muted-foreground">
        <p>{notFound ? 'That heartbeat no longer exists.' : "Couldn't load this heartbeat."}</p>
        <Link href="/settings/heartbeats" className="underline">
          ← back to heartbeats
        </Link>
      </div>
    );
  }

  const { heartbeat: hb, fires, labels } = detailQuery.data;
  const hidden = heartbeatStateHidden(hb, viewer);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <SetPageTitle title={hb.name} />
      <header className="space-y-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <code className="text-sm text-muted-foreground">{hb.slug}</code>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase">
            {hb.status}
          </span>
        </div>
        {hb.description && <p className="text-sm text-muted-foreground">{hb.description}</p>}
        <p className="text-xs text-muted-foreground">
          <Link href="/settings/heartbeats" className="underline">
            ← back to heartbeats
          </Link>
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        <Card title="Agent">{hb.agentSlug}</Card>
        <Card title="Skill">{hb.skillSlug}</Card>
        <Card title="Surface">
          {hb.surface.kind === 'telegram' ? `Telegram chat ${hb.surface.chat_id}` : 'Web'}
        </Card>
        <Card title="Schedule">
          {hb.scheduleKind === 'interval' && hb.schedule.kind === 'interval' && (
            <>
              every {hb.schedule.every_minutes}min ±{hb.schedule.jitter_minutes ?? 0}min
            </>
          )}
          {hb.scheduleKind === 'once' && hb.schedule.kind === 'once' && (
            <>once at {hb.schedule.at}</>
          )}
          {hb.scheduleKind === 'manual' && <>manual only</>}
          {hb.scheduleKind === 'cron' && <>cron (unsupported v1)</>}
        </Card>
        <Card title="Next fire">{labels.nextFireAt}</Card>
        <Card title="Last fired">{labels.lastFiredAt}</Card>
        <Card title="Fire count">
          {hb.fireCount}
          {hb.maxFires != null && <span className="text-muted-foreground"> / {hb.maxFires}</span>}
        </Card>
        <Card title="Set up by">{heartbeatMakerText(hb, viewer)}</Card>
        <Card title="Completion reason">
          <span className="font-mono text-xs">{hb.completionReason ?? '—'}</span>
        </Card>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Gates
        </h2>
        <ul className="space-y-1 text-sm">
          <li>
            min_idle_minutes: <code>{hb.minIdleMinutes ?? 'null'}</code>
          </li>
          <li>
            cooldown_minutes: <code>{hb.cooldownMinutes ?? 'null'}</code>
          </li>
          <li>
            quiet_hours:{' '}
            {hb.quietHours
              ? `${hb.quietHours.from}–${hb.quietHours.to} ${hb.quietHours.tz ?? '(profile tz)'}`
              : 'null'}
          </li>
          <li>
            earliest_at: <code>{hb.earliestAt ?? 'null'}</code>
          </li>
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Current state
        </h2>
        {hidden ? (
          <p className="text-sm text-muted-foreground">{HIDDEN_STATE_TEXT}</p>
        ) : (
          <JsonView value={hb.state} />
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Recent fires ({fires.length})
        </h2>
        {fires.length === 0 && <p className="text-sm text-muted-foreground">No fires yet.</p>}
        <ul className="divide-y rounded-md border">
          {fires.map((f) => (
            <li key={f.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{labels.fires[f.id] ?? '—'}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${dispositionClass(f.disposition)}`}
                >
                  {f.disposition}
                </span>
                {f.traceId && (
                  <Link href={`/traces/${f.traceId}`} className="text-xs underline">
                    trace →
                  </Link>
                )}
              </div>
              {f.replyText ? (
                <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
                  &ldquo;{f.replyText}&rdquo;
                </p>
              ) : hidden ? (
                <p className="mt-1 text-xs text-muted-foreground">Reply: {NOT_YOURS}</p>
              ) : null}
              {f.errorMessage && (
                <p className="mt-1 text-xs text-destructive-ink">Error: {f.errorMessage}</p>
              )}
              {f.stateAfter && f.stateBefore && (
                <details className="mt-1 text-xs">
                  <summary className="cursor-pointer text-muted-foreground">state diff</summary>
                  <div className="mt-1 grid gap-2 md:grid-cols-2">
                    <JsonView value={f.stateBefore} label="Before" maxHeight={256} />
                    <JsonView value={f.stateAfter} label="After" maxHeight={256} />
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

/** Disposition → tailwind class. Triage colour-coding:
 *    emerald = happy path (work done, user reached)
 *    sky     = milestone (heartbeat completed its goal)
 *    orange  = "we did the work but user got nothing" — needs surface attention
 *    rose    = blocking error needing operator attention (paused)
 *    purple  = transient runtime error (will retry on next tick)
 *    amber   = gate skip (everything fine, just not now) */
function dispositionClass(d: string): string {
  switch (d) {
    case 'fired':
      return 'bg-success/15 text-success-ink';
    case 'completed':
      return 'bg-info/15 text-info-ink';
    case 'fired_undelivered':
      return 'bg-warning/15 text-warning-ink';
    case 'auto_paused':
      return 'bg-destructive/15 text-destructive-ink';
    case 'error':
      return 'bg-purple-100 text-purple-900 dark:bg-purple-900/40 dark:text-purple-100';
    default:
      // skipped_idle / skipped_quiet / skipped_cooldown / skipped_earliest
      return 'bg-warning/15 text-warning-ink';
  }
}
