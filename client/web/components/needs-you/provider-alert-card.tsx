'use client';

/**
 * The full outage notice, for admins: what fails since when, the plain
 * reason, what it does to the brain, how many items wait, the fix, and a
 * "Try again" button. Used on Settings, Embedding, Settings, AI workers and
 * the dashboard. Renders NOTHING while all works, for a member, and on a
 * brain before the alerts existed.
 *
 * "Try again" (embeddings and extraction only: the brain probes no other
 * subject) asks the brain to probe now (POST /api/embedding/recover).
 * When the provider works, the brain closes the alert, resumes indexing,
 * re-drives the failed jobs and sweeps the unindexed files by itself; the
 * live event (or the next read) then removes this card. No restart.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { apiSend } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { useToast } from '@mantle/web-ui/ui/toast';
import {
  PROVIDER_ALERTS_KEY,
  RECOVER_PATH,
  alertFix,
  alertHeadline,
  alertHref,
  alertImpact,
  alertProbes,
  nextTryText,
  type ProviderAlert,
} from '@/lib/provider-alerts';
import { useProviderAlerts } from './use-provider-alerts';

export function ProviderAlertCard({
  subject,
  showLink = false,
}: {
  /** Only this subject's outage; both when absent. */
  subject?: ProviderAlert['subject'];
  /** A "Fix it" link to the settings page (the dashboard; not on that page). */
  showLink?: boolean;
}) {
  const alerts = useProviderAlerts().filter((a) => !subject || a.subject === subject);
  if (alerts.length === 0) return null;
  return (
    <div className="space-y-3" data-testid="provider-alert-card">
      {alerts.map((a) => (
        <OneAlert key={`${a.subject}@${a.since}`} alert={a} showLink={showLink} />
      ))}
    </div>
  );
}

function OneAlert({ alert, showLink }: { alert: ProviderAlert; showLink: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const next = nextTryText(alert);

  async function tryAgain() {
    setAsking(true);
    try {
      await apiSend(RECOVER_PATH, 'POST', {});
      toast.info('The brain tries again now. This notice goes away when it works.');
      // The brain probes within seconds; refresh so the card follows.
      setTimeout(
        () => void queryClient.invalidateQueries({ queryKey: PROVIDER_ALERTS_KEY }),
        15_000,
      );
    } catch (err) {
      toast.error(`Could not ask the brain: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAsking(false);
    }
  }

  return (
    <div
      role="alert"
      className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
    >
      <p className="flex items-start gap-2 font-medium text-destructive-ink">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>{alertHeadline(alert)}</span>
      </p>
      <p className="text-foreground">{alertImpact(alert)}</p>
      <p className="text-muted-foreground">
        <strong className="font-medium text-foreground">Fix: </strong>
        {alertFix(alert)}
      </p>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {alertProbes(alert) ? (
          <Button size="sm" variant="outline" onClick={tryAgain} disabled={asking}>
            <RotateCw className="size-3.5" />
            Try again
          </Button>
        ) : null}
        {showLink ? (
          <Button size="sm" variant="ghost" asChild>
            <Link href={alertHref(alert)}>Fix it</Link>
          </Button>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {alert.paused ? 'Indexing is paused until it works. ' : ''}
          {next ?? ''}
        </span>
      </div>
    </div>
  );
}
