'use client';

import { useCallback, useState } from 'react';
import { Button } from '@mantle/web-ui/ui/button';
import { startSignIn } from '@/lib/oidc/actions';
import { signInErrorMessage } from '@/lib/sign-in-error';
import { useReturnReset } from './use-return-reset';

/** "Sign in with {label}". The password form beside it stays. */
export function CompanySignInButton({
  label,
  next,
  add,
  primary,
}: {
  label: string;
  next?: string;
  add?: boolean;
  /** The screen shows it first: this browser's login uses it. */
  primary: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [inBrowser, setInBrowser] = useState(false);
  const [error, setError] = useState<string>();
  useReturnReset(useCallback(() => setBusy(false), []));

  async function go() {
    setBusy(true);
    setError(undefined);
    setInBrowser(false);
    try {
      const how = await startSignIn({ ...(next ? { next } : {}), ...(add ? { add } : {}) });
      if (how === 'in-browser') {
        setInBrowser(true);
        setBusy(false);
      }
    } catch (err) {
      setError(signInErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant={primary ? 'default' : 'outline'}
        className="w-full"
        disabled={busy}
        onClick={() => void go()}
      >
        Sign in with {label}
      </Button>
      {inBrowser && (
        <p className="text-xs text-muted-foreground">
          Finish signing in in your browser. This window comes back when you are done.
        </p>
      )}
      {error && <p className="text-sm text-destructive-ink">{error}</p>}
    </div>
  );
}

/** The rule between the two ways in. */
export function OrRule() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
