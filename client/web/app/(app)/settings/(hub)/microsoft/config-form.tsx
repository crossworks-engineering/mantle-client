'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@mantle/web-ui/ui/button';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Input } from '@mantle/web-ui/ui/input';
import { SecretInput } from '@mantle/web-ui/ui/secret-input';
import { Label } from '@mantle/web-ui/ui/label';
import { FieldHint, hintId } from '@mantle/web-ui/ui/field-hint';
import type { MsConfigStatus } from '@mantle/client-types';
import { apiSend } from '@mantle/web-ui/api-fetch';
import { play } from '@/lib/sounds/play';

/**
 * Azure AD app registration, editable from the UI (replaces editing `.env` +
 * restart). When the active config comes from environment variables, saving
 * here creates a per-owner override; "Reset to environment" removes it.
 *
 * Controlled inputs so the typed values survive a re-render. Persists via
 * PUT/DELETE /api/microsoft/config, then invalidates the parent's config query.
 */
export function MsConfigForm({
  status,
  suggestedRedirectUri,
}: {
  status: MsConfigStatus;
  suggestedRedirectUri: string;
}) {
  const queryClient = useQueryClient();
  const hasStoredSecret = status.source === 'db';

  const [clientId, setClientId] = useState(status.clientId ?? '');
  const [tenant, setTenant] = useState(status.tenant || 'common');
  const [redirectUri, setRedirectUri] = useState(status.redirectUri ?? suggestedRedirectUri);
  const [secret, setSecret] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['microsoft', 'config'] });

  const save = useMutation({
    mutationFn: () =>
      apiSend('/api/microsoft/config', 'PUT', {
        clientId,
        clientSecret: secret || undefined,
        tenant: tenant || 'common',
        redirectUri,
      }),
    onSuccess: () => {
      play('success');
      setSaved(true);
      setSecret('');
      void invalidate();
    },
    onError: (err) => {
      play('danger');
      setError(err instanceof Error ? err.message : String(err));
    },
  });

  const clear = useMutation({
    mutationFn: () => apiSend('/api/microsoft/config', 'DELETE'),
    onSuccess: () => {
      setSaved(false);
      void invalidate();
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    save.mutate();
  };

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Microsoft app (Azure AD)</h3>
        <p className="text-xs text-muted-foreground">
          From your{' '}
          <a
            className="underline"
            href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
            target="_blank"
            rel="noreferrer"
          >
            app registration
          </a>
          .{' '}
          {status.source === 'env'
            ? 'Currently loaded from environment variables — saving here overrides them.'
            : status.source === 'db'
              ? 'Set here in the UI.'
              : 'Not configured yet.'}
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="clientId">Application (client) ID</Label>
          <Input
            id="clientId"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            required
            aria-describedby={hintId('clientId')}
          />
          <FieldHint id="clientId">
            From your app registration in the Azure portal — the Application (client) ID.
          </FieldHint>
        </div>

        <div className="space-y-2">
          <Label htmlFor="clientSecret">Client secret</Label>
          <SecretInput
            id="clientSecret"
            noun="secret"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={
              hasStoredSecret
                ? `Leave blank to keep current (${status.secretMasked})`
                : 'Client secret value'
            }
          />
          <FieldHint id="clientSecret">
            Use the secret <em>value</em> (not the secret ID). Azure only shows it once.
          </FieldHint>
        </div>

        <div className="space-y-2">
          <Label htmlFor="tenant">Directory (tenant)</Label>
          <Input
            id="tenant"
            value={tenant}
            onChange={(e) => setTenant(e.target.value)}
            placeholder="common"
          />
          <FieldHint id="tenant">
            <code className="font-mono">common</code> (any org + personal),{' '}
            <code className="font-mono">organizations</code>, or a specific tenant ID.
          </FieldHint>
        </div>

        <div className="space-y-2">
          <Label htmlFor="redirectUri">Redirect URI</Label>
          <Input
            id="redirectUri"
            value={redirectUri}
            onChange={(e) => setRedirectUri(e.target.value)}
            required
          />
          <FieldHint
            id="redirectUri"
            warn="A single character off and sign-in fails with a redirect mismatch."
          >
            Add this <strong>exact</strong> URI to the app&apos;s Authentication → Web → Redirect
            URIs.
          </FieldHint>
        </div>

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-ink">
            {error}
          </p>
        )}
        {saved && (
          <p className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success-ink">
            Saved.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton size="sm" pending={save.isPending}>
            Save Microsoft app
          </SubmitButton>
          {status.source === 'db' && (
            <Button
              type="button"
              onClick={() => {
                setError(null);
                clear.mutate();
              }}
              disabled={clear.isPending}
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
            >
              Reset to environment
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
