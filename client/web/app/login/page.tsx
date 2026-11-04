'use client';

import { DriftThemeBackdrop } from '@mantle/web-ui/drift-backdrop';
import { decodeDriftSpec } from '@mantle/share-ui/drift';
import { runtimeAppearance, serverUrl } from '@mantle/web-ui/runtime-env';
import { readBrandFields, resolveLoginBrand } from '@/lib/brand';
import { safeNext } from '@/lib/safe-next';
import { LoginClient } from './login-client';
import { LoginMark } from './login-mark';
import { LoginCredit } from './login-credit';
import { WithSearchParams } from '@/lib/search-params';
import { useHydrated } from '@/lib/use-hydrated';

/**
 * Owner sign-in screen, zero-secret flavor: no server session read (this app
 * can't verify one). Already-holding-a-bearer visitors bounce straight in;
 * fresh installs (GET /api/auth/bootstrap-state, public, boolean-only) get
 * the create-account variant, exactly like the monolith's first-run gate. Both
 * of those live in `LoginClient`.
 *
 * The screen wears the BRAIN's branding: an uploaded logo, else the site name
 * in the owner's chosen face, else the Jackdaw lockup. The UI is static, so
 * the branding comes from the host's runtime env (window.__MANTLE_ENV__),
 * which the build cannot see. Until hydration the card is therefore rendered
 * INVISIBLE (it holds its space, so nothing jumps): a wrong brand never shows,
 * neither in the static HTML nor for a frame after it. The theme behind it is
 * already right, boot.js painted it. It reads no session and stays
 * zero-secret.
 */
type Query = { next?: string; error?: string; oidc?: string; add?: string; session?: string };

/** The brain's own origin, from the host's runtime env: '' when same-origin. */
function brainOriginNow(): string {
  return serverUrl('').replace(/\/+$/, '');
}

function LoginPageView({ params }: { params: Query }) {
  const hydrated = useHydrated();
  const appearance = hydrated ? runtimeAppearance() : null;
  const origin = hydrated ? brainOriginNow() : '';
  const brand = resolveLoginBrand(readBrandFields(appearance));
  // The saved Drift background (a Neat-era v1 paints as silk), decoded
  // defensively like every appearance field:
  // absence simply decodes to null (the plain fill), per the contract's own
  // optional-field rule.
  const drift = decodeDriftSpec(appearance?.neatBackground);

  return (
    // A COLUMN, not a single centred box, so the product's mark can sit at the
    // foot without fighting the card for the middle. The card keeps the centre
    // of whatever height is left (`flex-1` + `items-center`), and the credit
    // sits below it in normal flow rather than absolutely positioned, so on a
    // short viewport the page scrolls instead of the two overlapping.
    // `isolate` + the backdrop's -z-10 keep the gradient above this main's own
    // bg-background but below the card and credit, the chat AreaBackdrop idiom.
    // The backdrop is the PUBLIC surface: full colour, no legibility floor,
    // which holds only while every word stays on the opaque card (the credit
    // below it is the product logotype, no text of its own). The invite
    // screen shares this layout and this rule.
    <main className="relative isolate flex min-h-screen flex-col bg-background px-4 py-8">
      {drift && <DriftThemeBackdrop spec={drift} surface="public" className="-z-10" />}
      <div className="flex w-full flex-1 items-center justify-center">
        <div className={`w-full max-w-sm space-y-8${hydrated ? '' : ' invisible'}`}>
          <LoginClient
            // `srcBase` is where an uploaded logo's bytes live (the host's
            // /env.js). Passing it down is what keeps a custom logo working
            // when the client and the brain sit on different origins, see
            // `components/layout/rail/brand-logo.tsx`, which also normalises
            // the trailing slash for every caller.
            mark={<LoginMark brand={brand} srcBase={origin} />}
            // Reduced to an in-app path before either client half sees it:
            // the raw parameter was an open redirect (lib/safe-next.ts).
            next={safeNext(params.next)}
            error={params.error}
            oidc={params.oidc}
            // `add=1`: someone already signed in is adding another login, so the
            // usual bounce back into the app must not happen. `session`: which
            // held login is being signed back in to. Both are ids and flags the
            // client resolves against its own list; neither is trusted for more.
            add={params.add === '1'}
            sessionId={params.session}
            serverOrigin={origin}
          />
        </div>
      </div>
      {/* The MantleOS credit only once the owner's branding has taken the hero
          slot, or the mark would appear twice on one screen. See
          `login-credit.tsx`. */}
      <LoginCredit show={hydrated && brand.kind !== 'product'} />
    </main>
  );
}

export default function LoginPage() {
  return <WithSearchParams render={(sp) => <LoginPageView params={sp as Query} />} />;
}
