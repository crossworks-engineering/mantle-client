'use client';

import { useState } from 'react';
import { bounceToLogin } from '@mantle/web-ui/api-fetch';
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
import { Badge } from '@mantle/web-ui/ui/badge';
import { Button } from '@mantle/web-ui/ui/button';
import { useToast } from '@mantle/web-ui/ui/toast';
import { unlinkSelf } from '@/lib/oidc/actions';
import { forgetCompanySignIn } from '@/lib/oidc/linked-browser';
import { useOidcStatus } from '@/lib/oidc/use-oidc';
import { signInErrorMessage } from '@/lib/sign-in-error';
import { LinkForm } from './link-form';

/**
 * A login's own company sign-in: Settings > Profile, and the account menu for
 * a login with no Profile screen. Nothing shows while it is off.
 *
 * Linking is the person's choice and unlinking is too, in optional mode: the
 * password then is the only way in (corporate plan section 17.4). A login with
 * no password has to get one first, or it would have no way back in.
 */
export function CompanySignInSection() {
  const status = useOidcStatus();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (status.mode === 'off') return null;
  const { label } = status;

  async function unlink() {
    setBusy(true);
    try {
      const res = await unlinkSelf();
      if (res.ok) {
        // The brain ended this login's sessions, this one too.
        forgetCompanySignIn();
        bounceToLogin();
        return;
      }
      toast.error(res.message);
      setConfirming(false);
    } catch (err) {
      toast.error(signInErrorMessage(err));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Company sign-in" className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">Company sign-in</h2>
        {status.linked && <Badge variant="secondary">Linked</Badge>}
      </div>
      {status.linked ? (
        <>
          <p className="text-xs text-muted-foreground">
            This login signs in with {label}.
            {status.passwordConfirms ? ' Your password still works too.' : ''}
          </p>
          {!status.canUnlink ? (
            <p className="text-xs text-muted-foreground">
              This site requires {label}. Ask an admin to remove the link.
            </p>
          ) : !status.passwordConfirms ? (
            <p className="text-xs text-muted-foreground">
              This login has no password. Ask an admin to set one before you remove the link.
            </p>
          ) : (
            <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
              Remove the link
            </Button>
          )}
        </>
      ) : status.outside ? (
        <p className="text-xs text-muted-foreground">
          An admin marked this login as outside the company, so it keeps its password.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Sign in with {label} next time. Your password keeps working.
          </p>
          <div className="max-w-sm">
            <LinkForm label={label} action="Link now" start />
          </div>
        </>
      )}
      <AlertDialog open={confirming} onOpenChange={(o) => !busy && setConfirming(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the link to {label}?</AlertDialogTitle>
            <AlertDialogDescription>
              Your password becomes your only way in. This also signs you out on every device. Your
              API keys keep working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void unlink();
              }}
            >
              Remove the link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
