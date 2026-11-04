'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { isCrossOrigin } from '@mantle/web-ui/runtime-env';
import { currentBrainOrigin } from '@mantle/web-ui/session-registry';
import { tokenStore } from '@mantle/web-ui/token-store';
import { takeLinkCode } from '@/lib/link-code';
import { goAfterSignIn } from '@/lib/oauth-consent';
import { spendCode, whoamiOf } from '@/lib/oidc/actions';
import {
  clearPendingFlow,
  decideArrival,
  readFlowEnd,
  readPendingFlow,
  saveOutcome,
  signInStoppedPath,
  type FlowEnd,
  type PendingFlow,
} from '@/lib/oidc/flow';
import { rememberCompanySignIn } from '@/lib/oidc/linked-browser';
import { settleSessionCookie } from '@/lib/oidc/settle';
import { safeNext } from '@/lib/safe-next';
import { destinationAfterSignIn } from '@/lib/sign-in-destination';
import { signInErrorMessage } from '@/lib/sign-in-error';

const NO_FLOW = 'This sign-in has ended. Start again.';
const OTHER_BRAIN =
  'This answer came from another address than the one this page uses. Open this brain at its public address and start again.';

/** A flow that stopped goes back to where it began, saying why. */
function stopped(flow: PendingFlow, result: string) {
  clearPendingFlow();
  if (flow.purpose === 'signin' || flow.held) {
    window.location.replace(signInStoppedPath(flow, result));
    return;
  }
  saveOutcome({ purpose: flow.purpose, result });
  window.location.replace(safeNext(flow.next) ?? '/');
}

/** Spend a sign-in's or a link's code, then land. */
async function spend(flow: PendingFlow, code: string): Promise<string | null> {
  const spent = await spendCode(code, flow.verifier);
  if (!spent.ok) {
    stopped(flow, spent.result);
    return null;
  }
  clearPendingFlow();
  rememberCompanySignIn();
  if (!('token' in spent.answer)) {
    // A link made on a session that goes on as it was.
    saveOutcome({ purpose: 'link', linked: true });
    window.location.replace(safeNext(flow.next) ?? '/');
    return null;
  }
  // A bearer. It names a login id; the device files its logins by email.
  const { token } = spent.answer;
  const who = await whoamiOf(token);
  if (!who) return 'Could not finish signing in. Try again.';
  tokenStore.signIn({ email: who.email, token, loginId: who.loginId });
  if (!isCrossOrigin()) await settleSessionCookie({ keepCookie: false });
  // A page load: this tab has been someone else, or no one, until now.
  await goAfterSignIn(await destinationAfterSignIn(safeNext(flow.next)), (to) =>
    window.location.replace(to),
  );
  return null;
}

/** The page's whole job, once: read what came back and act on it. */
export function OidcArrival() {
  const [end, setEnd] = useState<{ end: FlowEnd | null; code: string } | null>(null);
  const [problem, setProblem] = useState<string>();
  const acted = useRef(false);

  // Before the first paint: nothing of the flow stays in the address (and so
  // in the history).
  useLayoutEffect(() => {
    const read = () => {
      const code = takeLinkCode(window, document.documentElement);
      const flowEnd = readFlowEnd(window.location.hash);
      if (window.location.hash) {
        window.history.replaceState(window.history.state, '', window.location.pathname);
      }
      return { end: flowEnd, code };
    };
    const first = read();
    // Keep the first read: a second run of this effect finds the address clean.
    setEnd((held) => held ?? first);
    // A desktop shell delivering to a window already on this page changes only
    // the fragment: no load, so the page reads it itself.
    const onHash = () => {
      const next = read();
      if (!next.end) return;
      acted.current = false;
      setProblem(undefined);
      setEnd(next);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!end || acted.current) return;
    acted.current = true;
    const arrival = decideArrival(end.end, end.code, readPendingFlow(), currentBrainOrigin());
    switch (arrival.kind) {
      case 'nothing':
      case 'no-flow':
        setProblem(NO_FLOW);
        return;
      case 'other-brain':
        setProblem(OTHER_BRAIN);
        return;
      case 'stopped':
        stopped(arrival.flow, arrival.result);
        return;
      case 'fresh':
        // Not spent here: it goes in the one request it confirms.
        clearPendingFlow();
        saveOutcome({ purpose: 'fresh', proof: arrival.proof });
        window.location.replace(safeNext(arrival.flow.next) ?? '/');
        return;
      case 'spend':
        void spend(arrival.flow, arrival.code).then(
          (message) => {
            if (message) setProblem(message);
          },
          (err: unknown) => setProblem(signInErrorMessage(err)),
        );
        return;
    }
  }, [end]);

  if (!problem) {
    return (
      <p role="status" className="text-center text-sm text-muted-foreground">
        Signing you in.
      </p>
    );
  }
  return (
    <div className="space-y-3 text-center">
      <p className="text-sm text-destructive-ink">{problem}</p>
      <p className="text-xs text-muted-foreground">
        <Link href="/" className="underline underline-offset-2 hover:text-foreground">
          Back to the app
        </Link>
      </p>
    </div>
  );
}
