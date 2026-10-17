import type { Metadata } from 'next';
import { Smartphone } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Sign in on your phone',
  robots: { index: false },
};

/**
 * Where a BROWSER lands when it scans the "Sign in on your phone" QR from
 * Settings → Logins (`<brain>/pair#v=1&code=…`). The Jackdaw app parses that
 * URL itself and never opens it; this page is for the system camera. On a
 * single-host install every non-/api path reaches this app, so without it the
 * scan fell through the session gate to the login screen.
 *
 * Public (see PUBLIC_PREFIXES in middleware.ts) and static: the code lives in
 * the URL fragment, which no server sees, and this page never reads or shows
 * it. It only says what to do. The brain serves the same words at its own
 * `/pair` for split deployments, where the QR points at the brain's origin.
 */
export default function PairPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-sm space-y-3 rounded-md border border-border bg-card p-6 text-card-foreground">
        <div className="flex items-center gap-2 text-base font-medium">
          <Smartphone className="size-4 text-muted-foreground" /> Sign in on your phone
        </div>
        <p className="text-sm text-muted-foreground">
          This code is for the MantleOS phone app. Open MantleOS on your phone, tap{' '}
          <span className="text-card-foreground">Scan a sign-in code</span> on the sign-in screen,
          and point it at the code shown on the web app.
        </p>
        <p className="text-sm text-muted-foreground">
          The code works once and expires after about a minute. There is nothing else to do here.
        </p>
      </div>
    </main>
  );
}
