'use client';

/**
 * Embeddings or extraction failing (no credits, a refused key, a long
 * outage): a red notice at the top of the rail, above the "Needs you" one,
 * for admins only. Live through GET /api/embedding/recover and the brain's
 * live event when an outage opens or closes. Renders NOTHING while all
 * works. Clicking opens the settings page with the fix. In the collapsed
 * icon rail the label hides and the icon stays. An outage that opens while
 * the app is open sounds `notification` once.
 */
import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { alertHeadline, alertHref, alertImpact, alertTitle } from '@/lib/provider-alerts';
import { freshKeys } from '@/lib/sounds/events';
import { play } from '@/lib/sounds/play';
import { useProviderAlertsState } from './use-provider-alerts';

/** The outages already heard, for the tab: shared by every banner, so one
 *  that mounts twice (or again) never sounds an outage twice. Null until
 *  the first answer, which seeds it. */
let heard: Set<string> | null = null;

export function ProviderAlertBanner({ onNavigate }: { onNavigate?: () => void }) {
  const { alerts, loaded } = useProviderAlertsState();
  const keys = alerts.map((a) => `${a.subject}:${a.since}`).join('|');
  useEffect(() => {
    // The first answer seeds: an outage already open at load stays quiet.
    if (!loaded) return;
    const next = freshKeys(heard, keys ? keys.split('|') : []);
    heard = next.seen;
    for (const key of next.fresh) play('notification', { once: `outage:${key}` });
  }, [keys, loaded]);
  const first = alerts[0];
  if (!first) return null;
  const label = alerts.length > 1 ? 'Embeddings and extraction are failing' : alertTitle(first);
  const detail = alerts.map((a) => `${alertHeadline(a)} ${alertImpact(a)}`).join('\n');
  return (
    <div className="px-3 pt-3 group-data-[nav-collapsed=true]/shell:px-2">
      <Link
        href={alertHref(first)}
        onClick={onNavigate}
        className="flex items-center gap-2 rounded-md bg-destructive px-3 py-2 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 group-data-[nav-collapsed=true]/shell:justify-center group-data-[nav-collapsed=true]/shell:px-0 group-data-[nav-collapsed=true]/shell:py-2"
        title={detail}
        aria-label={detail}
        data-testid="provider-alert-banner"
      >
        <AlertTriangle className="size-4 shrink-0" />
        <span className="truncate group-data-[nav-collapsed=true]/shell:hidden">{label}</span>
      </Link>
    </div>
  );
}
