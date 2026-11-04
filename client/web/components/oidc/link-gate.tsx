'use client';

import { signOutActive } from '@mantle/web-ui/session-switch';
import { Button } from '@mantle/web-ui/ui/button';
import { useOidcStatus } from '@/lib/oidc/use-oidc';
import { LinkStep } from './link-step';

/**
 * Required mode: a session from before the mode changed, of a login that must
 * link, sees the one link step and no other screen until it is done. Everyone
 * else sees the shell at once: this never waits for the brain's answer.
 */
export function LinkGate({ children }: { children: React.ReactNode }) {
  const status = useOidcStatus();
  if (status.mode === 'off' || !status.linkRequired) return <>{children}</>;
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <section className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-4 md:p-5">
        <LinkStep label={status.label} next="/" />
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={() => void signOutActive()}
        >
          Sign out
        </Button>
      </section>
    </main>
  );
}
