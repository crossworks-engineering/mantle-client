'use client';

/**
 * The decider's last failure, on its worker screen: when, which model, and
 * the plain reason (mantle docs/decisions.md "Failures an admin sees"). The
 * brain keeps the row after a decision works again, so this says either
 * "still failing" or "works again since". Red only while an admin sees it
 * as an alert and it is about the decider that runs now; an open blip and
 * a failure no decision can close read as a quiet note. Renders nothing
 * when the decider never failed, for a failure on another model than this
 * worker's, and on a brain before decider Part 3.
 *
 * It reads the same GET /api/ai-workers/config answer the screen already
 * loads (one query, shared by key).
 */
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, History } from 'lucide-react';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import {
  deciderLastFailureOf,
  lastFailureHeadline,
  lastFailureNote,
  lastFailureState,
} from '@/lib/decider';

export function DeciderLastFailure({ model }: { model: string }) {
  const config = useQuery({
    queryKey: ['ai-workers', 'config'],
    queryFn: () => apiFetch<unknown>('/api/ai-workers/config'),
  });
  const f = deciderLastFailureOf(config.data);
  if (!f || f.model !== model) return null;
  const failing = lastFailureState(f) === 'failing';
  const note = lastFailureNote(f);
  return (
    <div
      role={failing ? 'alert' : undefined}
      data-testid="decider-last-failure"
      className={
        failing
          ? 'space-y-1 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs'
          : 'space-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs'
      }
    >
      <p
        className={
          failing
            ? 'flex items-start gap-1.5 font-medium text-destructive-ink'
            : 'flex items-start gap-1.5 font-medium text-foreground'
        }
      >
        {failing ? (
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        ) : (
          <History className="mt-0.5 size-3.5 shrink-0" />
        )}
        <span>{lastFailureHeadline(f)}</span>
      </p>
      <p className="text-foreground">{f.reason}</p>
      {note && <p className="text-muted-foreground">{note}</p>}
    </div>
  );
}
