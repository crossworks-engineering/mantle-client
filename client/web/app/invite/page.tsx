import { DriftThemeBackdrop } from '@mantle/web-ui/drift-backdrop';
import { decodeDriftSpec } from '@mantle/share-ui/drift';
import { loadBrainAppearance } from '@/lib/appearance';
import { brainOrigin } from '@/lib/brain-origin';
import { readBrandFields, resolveLoginBrand } from '@/lib/brand';
import { LoginMark } from '../login/login-mark';
import { LoginCredit } from '../login/login-credit';
import { LinkCodeScript } from '@/components/link-code-script';
import { InviteClient } from './invite-client';

/**
 * /invite: a person redeems an invite an admin made in Settings > Users. They
 * open the link an admin handed them (`/invite#code=…`; `?code=…` in
 * links issued before) or type its
 * 16-character invite code, set a password, and are signed in.
 * Old team codes redeem nothing (the brain dropped them in migration 0178),
 * so one typed here is refused like any other code that is not valid.
 *
 * Public (PUBLIC_PREFIXES in middleware.ts), and never bounced away by a
 * session cookie: someone signed in on this browser can still accept. Wears
 * the sign-in screen's look, brand block and all; see app/login/page.tsx for
 * why the brand is resolved here, on the server. Served with
 * `Referrer-Policy: no-referrer` (next.config.ts), and the inline script
 * takes the code out of the address before anything else loads
 * (lib/link-code.ts).
 */
export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const [params, appearance, origin] = await Promise.all([
    searchParams,
    loadBrainAppearance(),
    brainOrigin(),
  ]);
  const brand = resolveLoginBrand(readBrandFields(appearance));
  const drift = decodeDriftSpec(appearance?.neatBackground);
  const code = typeof params.code === 'string' ? params.code : '';

  return (
    <main className="relative isolate flex min-h-screen flex-col bg-background px-4 py-8">
      <LinkCodeScript />
      {drift && <DriftThemeBackdrop spec={drift} surface="public" className="-z-10" />}
      <div className="flex w-full flex-1 items-center justify-center">
        <div className="w-full max-w-sm space-y-8">
          <InviteClient mark={<LoginMark brand={brand} srcBase={origin} />} initialCode={code} />
        </div>
      </div>
      <LoginCredit show={brand.kind !== 'product'} />
    </main>
  );
}
