'use client';

import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiSend } from '@mantle/web-ui/api-fetch';
import { Label } from '@mantle/web-ui/ui/label';
import { Switch } from '@mantle/web-ui/ui/switch';
import { useToast } from '@mantle/web-ui/ui/toast';
import {
  APP_INFORMATIONAL_LABEL,
  informationalHint,
  informationalPatch,
  supportsInformational,
} from '@/lib/app-informational';
import { grantsKey } from '@/lib/grants';
import type { AppDetail } from '@mantle/client-types';

/**
 * The admin's informational switch on an app (client logins C6; W5b2,
 * contract 36): on, nobody beyond Admin writes the app's data, whatever the
 * grants say; off, the grants' Write switches decide. It changes no grant,
 * so it asks no confirm. One PATCH of the owner app route; the cached app
 * detail takes the answer in place (never a refetch, which would re-sync
 * the editor's source tree), and the app's Access panel loads again. Shown
 * only by a brain that knows the flag: a brain before C6 sends no
 * `dataReadOnly`.
 */
export function AppInformationalSwitch({ app }: { app: AppDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const id = useId();
  // The value being sent, until the brain answers; then the app's own.
  const [sending, setSending] = useState<boolean | null>(null);
  if (!supportsInformational(app)) return null;
  const on = sending ?? app.dataReadOnly === true;

  const change = async (next: boolean) => {
    setSending(next);
    try {
      await apiSend(`/api/apps/${encodeURIComponent(app.id)}`, 'PATCH', informationalPatch(next));
      qc.setQueriesData<{ app: AppDetail }>(
        { predicate: (q) => q.queryKey[0] === 'apps' && typeof q.queryKey[1] === 'string' },
        (d) => (d?.app?.id === app.id ? { ...d, app: { ...d.app, dataReadOnly: next } } : d),
      );
      // The Access panel loads again: whether its Write switches apply
      // changed with it.
      void qc.invalidateQueries({ queryKey: grantsKey(app.id) });
      // The /apps LIST pages only, as the look picker does.
      void qc.invalidateQueries({
        predicate: (q) => q.queryKey[0] === 'apps' && typeof q.queryKey[1] === 'object',
      });
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
        data-agent-risk={on ? 'person' : undefined}
        onCheckedChange={(v) => void change(v)}
        aria-describedby={`${id}-hint`}
      />
      <Label htmlFor={id} className="font-normal">
        {APP_INFORMATIONAL_LABEL}
      </Label>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {informationalHint(on)}
      </p>
    </div>
  );
}
