import { NeatBackdrop } from '@mantle/web-ui/neat-backdrop';
import { decodeNeatSpec } from '@mantle/share-ui/neat-background';
import { loadBrainAppearance } from '@/lib/appearance';
import { brainOrigin } from '@/lib/brain-origin';
import { readBrandFields, resolveLoginBrand } from '@/lib/brand';
import { safeNext } from '@/lib/safe-next';
import { LoginClient } from './login-client';
import { LoginMark } from './login-mark';
import { LoginCredit } from './login-credit';

/**
 * Owner sign-in screen, zero-secret flavor: no server session read (this app
 * can't verify one). Already-holding-a-bearer visitors bounce straight in;
 * fresh installs (GET /api/auth/bootstrap-state, public, boolean-only) get
 * the create-account variant, exactly like the monolith's first-run gate. Both
 * of those live in `LoginClient`.
 *
 * A SERVER component now, where it used to be a client one, for one reason:
 * the screen wears the BRAIN's branding, an uploaded logo, else the site name
 * in the owner's chosen face, else the Jackdaw lockup, and resolving that
 * after mount would flash the wrong brand on every load. `loadBrainAppearance`
 * is the same cached, public, server-to-server fetch the root layout already
 * awaits, so this costs no extra request; it reads no session and remains
 * zero-secret.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; add?: string; session?: string }>;
}) {
  const [params, appearance, origin] = await Promise.all([
    searchParams,
    loadBrainAppearance(),
    brainOrigin(),
  ]);
  const brand = resolveLoginBrand(readBrandFields(appearance));
  // The saved Neat background, decoded defensively like every appearance field:
  // absence simply decodes to null (the plain fill), per the contract's own
  // optional-field rule.
  const neat = decodeNeatSpec(appearance?.neatBackground);

  return (
    // A COLUMN, not a single centred box, so the product's mark can sit at the
    // foot without fighting the card for the middle. The card keeps the centre
    // of whatever height is left (`flex-1` + `items-center`), and the credit
    // sits below it in normal flow rather than absolutely positioned, so on a
    // short viewport the page scrolls instead of the two overlapping.
    // `isolate` + the backdrop's -z-10 keep the gradient above this main's own
    // bg-background but below the card and credit, the chat AreaBackdrop idiom.
    <main className="relative isolate flex min-h-screen flex-col bg-background px-4 py-8">
      {neat && <NeatBackdrop spec={neat} className="-z-10" resolution={0.75} />}
      <div className="flex w-full flex-1 items-center justify-center">
        <div className="w-full max-w-sm space-y-8">
          <LoginClient
            // `srcBase` is where an uploaded logo's bytes live, read in the
            // SERVER pass because that is the half of the render that can see
            // it: the browser gets the same value from /env.js, but this HTML
            // is built before any script runs. Passing it down is what keeps a
            // custom logo working when the client and the brain sit on
            // different origins, see `components/layout/rail/brand-logo.tsx`,
            // which also normalises the trailing slash for every caller.
            mark={<LoginMark brand={brand} srcBase={origin} />}
            // Reduced to an in-app path before either client half sees it:
            // the raw parameter was an open redirect (lib/safe-next.ts).
            next={safeNext(params.next)}
            error={params.error}
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
      <LoginCredit show={brand.kind !== 'product'} />
    </main>
  );
}
