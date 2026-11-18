'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { apiSend, apiUrl } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { Spinner } from '@mantle/web-ui/ui/spinner';

type Ticket = { ticket: string; url: string };

/**
 * The Sync service's screens in a sandboxed frame (Sync M2, decision 3). The
 * frame's requests carry no cookie, so a ticket comes first
 * (POST /api/services/sync/frame-ticket); the brain renews it with every
 * screen. No script, no same-origin, no top navigation. Popups may leave the
 * sandbox (Sync M3): "Connect a Microsoft account" opens Microsoft's sign-in
 * in a new tab, which a sandboxed tab could not run. "Reload" shows a new
 * connection (no reload on its own: it would wipe a form half filled while
 * the person copies a secret from another tab). After a long pause the
 * ticket ends: "Reload" asks a new one too.
 */
export function SyncFrame() {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setSrc(null);
    try {
      const r = await apiSend<Ticket>('/api/services/sync/frame-ticket', 'POST', {});
      setSrc(apiUrl(r.url));
    } catch {
      setError('The Sync service did not answer. It may still be starting.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="size-4" aria-hidden /> Reload
        </Button>
      </div>
      {error ? (
        <p className="text-sm text-muted-foreground">{error}</p>
      ) : src ? (
        <iframe
          title="Accounts"
          src={src}
          sandbox="allow-forms allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          className="h-[calc(100vh-12rem)] min-h-[32rem] w-full rounded-md border bg-background"
        />
      ) : (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      )}
    </div>
  );
}
