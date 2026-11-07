'use client';

import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import type { ToolDTO } from '@mantle/client-types';
import { apiSend } from '@mantle/web-ui/api-fetch';
import { Switch } from '@mantle/web-ui/ui/switch';
import { Checkbox } from '@mantle/web-ui/ui/checkbox';
import { Label } from '@mantle/web-ui/ui/label';
import { FieldHint } from '@mantle/web-ui/ui/field-hint';
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
import { useToast } from '@mantle/web-ui/ui/toast';
import { blockedReason, toolAccessCopy } from '@/lib/tool-access-copy';

/**
 * "External access" as the server reports it (`ToolDTO.externalAccess`,
 * mantle docs/member-logins.md "External access: outside tools in shared
 * apps"). Typed here until the contract that carries it is published and
 * pinned; then this becomes `ToolExternalAccessDTO` from
 * `@mantle/client-types`.
 */
export type ToolExternalAccess = {
  /** False when the tool's handler changed after an admin confirmed it. */
  on: boolean;
  confirmedReadOnlyAt: string;
  by: { via: 'web' | 'mcp' | 'dev-tools'; actorId?: string; actorEmail?: string };
};

export type ToolWithExternalAccess = ToolDTO & { externalAccess?: ToolExternalAccess | null };

function who(t: ToolExternalAccess): string {
  if (t.by.via === 'web') return t.by.actorEmail ?? 'an admin';
  if (t.by.via === 'mcp') return 'the owner’s MCP client';
  return 'the dev tool console';
}

/**
 * The switch on one outside tool (MCP or http). Only shown for those kinds:
 * built-ins need none, and recipe and shell tools can never get it. Saves at
 * once through its own route, apart from the tool form. On a CONNECTOR tool
 * (mcp) it is the read-only mark since brain team apps Phase 2: the
 * connector's level decides who may use the tool, the mark decides read or
 * write (lib/tool-access-copy.ts holds both sets of words).
 */
export function ExternalAccessSection({
  tool,
  onChanged,
  note,
}: {
  tool: ToolWithExternalAccess;
  onChanged: (tool: ToolWithExternalAccess) => void;
  /** A notice under the switch (`ConnectorOffNote`). */
  note?: ReactNode;
}) {
  const toast = useToast();
  const copy = toolAccessCopy(tool.handler.kind);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [readOnlyConfirmed, setReadOnlyConfirmed] = useState(false);

  const mutation = useMutation({
    mutationFn: (allow: boolean) =>
      apiSend<{ tool: ToolWithExternalAccess }>(`/api/tools/${tool.id}/external-access`, 'PUT', {
        allow,
        ...(allow ? { readOnlyConfirmed: true } : {}),
      }),
    onSuccess: (res, allow) => {
      onChanged(res.tool);
      toast.success(allow ? copy.toastOn : copy.toastOff);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not change that.'),
  });

  if (tool.handler.kind !== 'mcp' && tool.handler.kind !== 'http') return null;

  const state = tool.externalAccess ?? null;
  const on = state?.on === true;
  const stale = state !== null && !on;
  const blocked = blockedReason(tool);

  const onToggle = (next: boolean) => {
    if (!next) {
      mutation.mutate(false);
      return;
    }
    setReadOnlyConfirmed(false);
    setConfirmOpen(true);
  };

  return (
    <section
      className="space-y-2 rounded-lg border border-border p-3"
      aria-labelledby="external-access"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Label
            id="external-access"
            htmlFor="external-access-switch"
            className="text-sm font-medium"
          >
            {copy.label}
          </Label>
          <FieldHint id="external-access-switch" className="mt-1 leading-relaxed" warn={copy.warn}>
            {copy.hint}
          </FieldHint>
        </div>
        <Switch
          id="external-access-switch"
          // Only on the press that loosens: an agent may switch it off (lib/agent-ui).
          data-agent-risk={on ? undefined : 'person'}
          checked={on}
          disabled={mutation.isPending || (!on && blocked !== null)}
          onCheckedChange={onToggle}
          className="mt-0.5 shrink-0"
        />
      </div>
      {note}
      {on && state && (
        <p className="text-xs text-muted-foreground">
          Confirmed read-only by {who(state)} on{' '}
          {new Date(state.confirmedReadOnlyAt).toLocaleString()}.
        </p>
      )}
      {stale && (
        <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs text-warning-ink">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {copy.stale}
        </p>
      )}
      {!on && blocked && <p className="text-xs text-muted-foreground">{blocked}</p>}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.dialogTitle(tool.slug)}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-warning-ink">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{copy.dialogBody[0]}</span>
                </p>
                <p>
                  If the tool takes free SQL or a free query, they can read anything the connector
                  can read.
                </p>
                <p>{copy.dialogBody[1]}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox
              checked={readOnlyConfirmed}
              onCheckedChange={(v) => setReadOnlyConfirmed(v === true)}
              className="mt-0.5"
              aria-describedby="external-access-confirm-hint"
            />
            <span id="external-access-confirm-hint">I confirm this tool only reads data.</span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!readOnlyConfirmed || mutation.isPending}
              onClick={() => mutation.mutate(true)}
            >
              {copy.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
