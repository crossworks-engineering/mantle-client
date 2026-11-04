'use client';

import { DriftThemeBackdrop } from '@mantle/web-ui/drift-backdrop';
import { decodeDriftSpec } from '@mantle/share-ui/drift';
import { runtimeAppearance } from '@mantle/web-ui/runtime-env';
import { LinkCodeScript } from '@/components/link-code-script';
import { useHydrated } from '@/lib/use-hydrated';
import { OidcArrival } from './oidc-arrival';

/**
 * /auth/oidc: where every company sign-in ends (brain docs/oidc-sign-in.md).
 * The brain sends the browser here with a one-time code in the fragment; the
 * desktop shell loads it here when `mantle://oidc` arrives. Public
 * (PUBLIC_PREFIXES in lib/route-guard.ts). The inline script takes the code out
 * of the address before anything else loads (lib/link-code.ts), and the host
 * serves the page with `Referrer-Policy: no-referrer`.
 */
export default function OidcArrivalPage() {
  const hydrated = useHydrated();
  const drift = decodeDriftSpec(hydrated ? runtimeAppearance()?.neatBackground : undefined);
  return (
    <main className="relative isolate flex min-h-screen flex-col items-center justify-center bg-background px-4 py-8">
      <LinkCodeScript />
      {drift && <DriftThemeBackdrop spec={drift} surface="public" className="-z-10" />}
      <section className="w-full max-w-sm rounded-xl border border-border bg-card p-4 md:p-5">
        <OidcArrival />
      </section>
    </main>
  );
}
