'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@mantle/web-ui/ui/button';
import { useToast } from '@mantle/web-ui/ui/toast';
import { abandonFlow, dismissOffer } from '@/lib/oidc/actions';
import { flowStoppedMessage, takeOutcome } from '@/lib/oidc/flow';
import { OIDC_STATUS_KEY, useOidcStatus } from '@/lib/oidc/use-oidc';
import { LinkForm } from './link-form';

/**
 * The soft link offer (corporate plan section 17.1): one card, in the shell's
 * bottom-right stack, for an unlinked login. "Not now" hides it for 7 days, on
 * the brain, so every device agrees. Nothing here blocks anything: the password
 * keeps working until the person chooses.
 *
 * A link that ends back in the shell says how it went here too: the card is
 * mounted on every screen, so it works wherever the link began.
 */
export function OfferCard() {
  const status = useOidcStatus();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const outcome = takeOutcome('link');
    if (!outcome) return;
    if ('result' in outcome) toast.error(flowStoppedMessage(outcome.result));
    else toast.success('Linked. You can use your company sign-in from now on.');
    void queryClient.invalidateQueries({ queryKey: OIDC_STATUS_KEY });
  }, [toast, queryClient]);

  if (status.mode === 'off' || !status.offer || status.linkRequired || hidden) return null;

  return (
    <section
      aria-label="Company sign-in"
      className="pointer-events-auto space-y-3 rounded-xl border border-border bg-card p-4 shadow-lg"
    >
      <p className="text-sm">Sign in with {status.label} next time.</p>
      <LinkForm label={status.label} action="Link now">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setHidden(true);
            // A link still out in the browser stops here too.
            abandonFlow('link');
            void dismissOffer().then(() =>
              queryClient.invalidateQueries({ queryKey: OIDC_STATUS_KEY }),
            );
          }}
        >
          Not now
        </Button>
      </LinkForm>
    </section>
  );
}
