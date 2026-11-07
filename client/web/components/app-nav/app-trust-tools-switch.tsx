'use client';

import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AppDetail } from '@mantle/client-types';
import { apiSend } from '@mantle/web-ui/api-fetch';
import { Label } from '@mantle/web-ui/ui/label';
import { Switch } from '@mantle/web-ui/ui/switch';
import { useToast } from '@mantle/web-ui/ui/toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@mantle/web-ui/ui/alert-dialog';
import {
  APP_TRUST_LABEL,
  APP_TRUST_CONFIRM,
  APP_TRUST_OFF_HINT,
  APP_TRUST_ON_HINT,
  appAuthorLevel,
  showsTrustSwitch,
} from '@/lib/space-apps';

/**
 * The admin's "Trust its tools" switch (brain team apps Phase 3, M3 audit):
 * the author ceiling of an app in the brain. Off, the app runs its tools at
 * team rules for everyone, admins too (a member wrote it, or it came from a
 * copy, an import or a member-era restore). On lifts it, after a confirm
 * that names the declared tools and says what the code can then do. One
 * PATCH of the owner app route (`{ trustTools }`), its one writer; the app
 * it answers goes into the cache. Shown while the brain says the app ever
 * ran at the ceiling (`authorCeilingSeen`), on or off, so a trust can be
 * undone after a reload.
 */
export function AppTrustToolsSwitch({ app }: { app: AppDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const id = useId();
  const [sending, setSending] = useState<boolean | null>(null);
  const [confirm, setConfirm] = useState(false);
  const level = appAuthorLevel(app);
  // An admin's own app (never capped) shows nothing.
  if (level === null || !showsTrustSwitch(app)) return null;
  const on = sending ?? level === 'admin';
  const tools = app.manifest?.toolSlugs ?? [];

  const send = async (next: boolean) => {
    setSending(next);
    try {
      const res = await apiSend<{ app: AppDetail }>(
        `/api/apps/${encodeURIComponent(app.id)}`,
        'PATCH',
        { trustTools: next },
      );
      // The brain's own answer, not a hand-set field.
      qc.setQueriesData<{ app: AppDetail }>(
        { predicate: (q) => q.queryKey[0] === 'apps' && typeof q.queryKey[1] === 'string' },
        (d) => (d?.app?.id === app.id && res?.app ? { ...d, app: res.app } : d),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change the app.');
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
      <Switch
        id={id}
        checked={on}
        disabled={sending !== null}
        data-agent-risk={on ? undefined : 'person'}
        onCheckedChange={(v) => (v ? setConfirm(true) : void send(false))}
        aria-describedby={`${id}-hint`}
      />
      <Label htmlFor={id} className="font-normal">
        {APP_TRUST_LABEL}
      </Label>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {on ? APP_TRUST_ON_HINT : APP_TRUST_OFF_HINT}
      </p>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Trust the tools of “{app.title || 'Untitled'}”?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>{APP_TRUST_CONFIRM}</p>
                {tools.length ? (
                  <ul className="flex flex-wrap gap-1">
                    {tools.map((t) => (
                      <li key={t}>
                        <code className="rounded-sm bg-muted px-1.5 py-0.5 text-xs">{t}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>It declares no tools.</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirm(false);
                void send(true);
              }}
            >
              Trust its tools
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
