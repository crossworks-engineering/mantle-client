'use client';

import Link from 'next/link';
import { SYNC_OFF_TEXT, SYNC_OFF_TITLE } from '@/lib/sync';
import { useSyncOff } from '@/lib/use-sync-off';

/** Centered card for a screen whose optional service is switched off. */
export function ServiceOff({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md space-y-3 rounded-lg border border-border bg-card p-6 text-center">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{text}</p>
        <Link
          href="/settings/services"
          className="inline-block text-sm text-primary-ink underline-offset-2 hover:underline"
        >
          Open Settings &gt; Services
        </Link>
      </div>
    </div>
  );
}

/**
 * Keeps a Sync screen (email, contacts) closed while the
 * brain says the service is off. The nav already leaves the screen out; this
 * covers a typed or old link. Otherwise the children render as they are.
 */
export function SyncGate({ children }: { children: React.ReactNode }) {
  const off = useSyncOff();
  if (off) return <ServiceOff title={SYNC_OFF_TITLE} text={SYNC_OFF_TEXT} />;
  return <>{children}</>;
}
