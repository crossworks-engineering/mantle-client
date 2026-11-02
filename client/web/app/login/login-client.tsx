'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { destinationAfterSignIn } from '@/lib/sign-in-destination';
import { goAfterSignIn } from '@/lib/oauth-consent';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import { tokenStore } from '@mantle/web-ui/token-store';
import { useSessions } from '@mantle/web-ui/use-sessions';
import { LoginForm } from './login-form';
import { LoginServer } from './login-server';

/**
 * Everything on the sign-in screen that has to run in the browser: the
 * already-signed-in bounce, the first-run gate, and the form itself.
 *
 * Split out of `page.tsx` so the page can be a SERVER component and resolve the
 * brain's branding before the HTML is sent, see `login-mark.tsx`. The mark
 * arrives here as a prop rather than being rendered above this component,
 * because it shares one centred block with the strapline: separating them would
 * put the page's 32px rhythm between two lines that belong 8px apart.
 */
export function LoginClient({
  mark,
  next,
  error,
  add = false,
  sessionId,
  serverOrigin,
}: {
  /** The server-rendered brand block. A React node, not data, this component
   *  has no business knowing which rung of the branding ladder won. */
  mark: React.ReactNode;
  next?: string;
  error?: string;
  /** Someone already signed in is adding another login. */
  add?: boolean;
  /** The held login being signed back in to (an id from this device's list). */
  sessionId?: string;
  /** The brain this screen signs in to, as the server render resolved it. */
  serverOrigin?: string;
}) {
  const router = useRouter();

  useEffect(() => {
    // Adding a login is the one visit here that is SUPPOSED to happen while
    // signed in.
    if (add) return;
    if (tokenStore.get()) {
      // Re-assert the presence flag before bouncing. It can be missing while
      // the token survives (it ended, or an older build's cookie was lost),
      // and without it the route guard sends the bounce right back here, a
      // deadlock.
      tokenStore.markPresence();
      // Back to the MCP consent page when that is where the brain sent this
      // browser from (lib/oauth-consent.ts), else into the app.
      void destinationAfterSignIn(next).then((to) => goAfterSignIn(to, (t) => router.replace(t)));
    }
  }, [router, next, add]);

  const bootQuery = useQuery({
    queryKey: ['auth-bootstrap-state'],
    // setupCodeRequired is absent on a brain from before the setup code.
    queryFn: () =>
      apiFetch<{ firstRun: boolean; setupCodeRequired?: boolean }>('/api/auth/bootstrap-state'),
  });
  const firstRun = bootQuery.data?.firstRun ?? false;
  const setupCodeRequired = bootQuery.data?.setupCodeRequired ?? false;

  // The login being signed back in to, if the link named one this device
  // still lists. Resolved after mount: the list is in localStorage.
  const held = useSessions();
  const target = sessionId ? held.sessions.find((s) => s.id === sessionId) : undefined;

  // Signed in, but not as a login this device holds: a cookie sign-in from
  // before it could hold more than one. There is no bearer to keep for it, so
  // adding another login replaces it, and the screen has to say so before the
  // person finds out by losing it.
  const [replacesCurrent, setReplacesCurrent] = useState(false);
  useEffect(() => {
    if (!add || !held.ready) return;
    setReplacesCurrent(!held.active && tokenStore.hasPresence());
  }, [add, held.ready, held.active]);

  // Opened by another brain window's "Add login": the shell holds the email
  // that was typed there, to be read once. Asked for rather than put in the
  // URL, where an email has no business being.
  const [hintEmail, setHintEmail] = useState<string>();
  useEffect(() => {
    if (!add) return;
    void window.mantleDesktop?.brains
      ?.takeLoginHint()
      .then((hint) => hint && setHintEmail(hint.email))
      .catch(() => undefined);
  }, [add]);

  const strapline = firstRun
    ? 'Create your login to begin.'
    : target
      ? `Signed out of ${target.siteName?.trim() || 'this brain'}. Sign in again.`
      : add
        ? 'Add another login to this device.'
        : 'Sign in to your data-aware workspace.';

  return (
    // The settings-card shell (ui-style-guide §6e): a form in a content area
    // wears the sectioned card, brand block in the header, form in the body.
    <section className="rounded-xl border border-border bg-card">
      <div className="space-y-2 border-b border-border p-4 text-center md:p-5">
        {mark}
        <p className="text-sm text-muted-foreground">{strapline}</p>
        <LoginServer origin={serverOrigin} />
      </div>
      <div className="space-y-4 p-4 md:p-5">
        {replacesCurrent && (
          <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            The login you are using now was signed in before this device could hold more than one.
            Adding another will replace it. Sign in to it again afterwards and the device keeps
            both.
          </p>
        )}
        <LoginForm
          mode={firstRun ? 'signup' : 'login'}
          next={next}
          error={error}
          setupCodeRequired={setupCodeRequired}
          add={add}
          initialEmail={target?.email ?? hintEmail}
        />
        {/* Only when there is an app to go back to: a brain window opened just
            to sign in has nobody signed in behind this screen. */}
        {add && (held.active || replacesCurrent) && (
          <p className="text-center text-xs text-muted-foreground">
            <Link href={next ?? '/'} className="underline underline-offset-2 hover:text-foreground">
              Back to the app
            </Link>
          </p>
        )}
      </div>
    </section>
  );
}
