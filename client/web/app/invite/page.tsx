'use client';

import { DriftThemeBackdrop } from '@mantle/web-ui/drift-backdrop';
import { decodeDriftSpec } from '@mantle/share-ui/drift';
import { runtimeAppearance, serverUrl } from '@mantle/web-ui/runtime-env';
import { readBrandFields, resolveLoginBrand } from '@/lib/brand';
import { LoginMark } from '../login/login-mark';
import { LoginCredit } from '../login/login-credit';
import { LinkCodeScript } from '@/components/link-code-script';
import { InviteClient } from './invite-client';
import { useHydrated } from '@/lib/use-hydrated';

/**
 * /invite: a person redeems an invite an admin made in Settings > Users. They
 * open the link an admin handed them (`/invite#code=…`; `?code=…` in
 * links issued before) or type its
 * 16-character invite code, set a password, and are signed in.
 * Old team codes redeem nothing (the brain dropped them in migration 0178),
 * so one typed here is refused like any other code that is not valid.
 *
 * Public (PUBLIC_PREFIXES in lib/route-guard.ts), and never bounced away by a
 * session cookie: someone signed in on this browser can still accept. Wears
 * the sign-in screen's look, brand block and all; see app/login/page.tsx for
 * why the card stays invisible until hydration. The host serves it with
 * `Referrer-Policy: no-referrer` (docs/static-ui-host.md), and the inline
 * script takes the code out of the address before anything else loads
 * (lib/link-code.ts), so InviteClient reads it from there, never from the
 * query.
 */
export default function InvitePage() {
  const hydrated = useHydrated();
  const appearance = hydrated ? runtimeAppearance() : null;
  const origin = hydrated ? serverUrl('').replace(/\/+$/, '') : '';
  const brand = resolveLoginBrand(readBrandFields(appearance));
  const drift = decodeDriftSpec(appearance?.neatBackground);

  return (
    <main className="relative isolate flex min-h-screen flex-col bg-background px-4 py-8">
      <LinkCodeScript />
      {drift && <DriftThemeBackdrop spec={drift} surface="public" className="-z-10" />}
      <div className="flex w-full flex-1 items-center justify-center">
        <div className={`w-full max-w-sm space-y-8${hydrated ? '' : ' invisible'}`}>
          <InviteClient mark={<LoginMark brand={brand} srcBase={origin} />} initialCode="" />
        </div>
      </div>
      <LoginCredit show={hydrated && brand.kind !== 'product'} />
    </main>
  );
}
