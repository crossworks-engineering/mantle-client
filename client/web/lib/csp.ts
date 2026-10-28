/**
 * The Content Security Policy.
 *
 * The client keeps a 30-day bearer in localStorage, and `token-store.ts` rested
 * its threat model on "the client app's CSP" for months before one existed.
 * This is that CSP, in two halves that are set in two different ways, and an
 * account of why it has to be split at all.
 *
 * ── Where a CSP can actually be set in this app ──────────────────────────────
 * The policy wants to name the brain origin (connect-src is what stops an
 * injected script posting the bearer to an attacker), and that origin exists
 * ONLY in the running box's environment: one prebuilt image serves any brain,
 * which is why /env.js reads `MANTLE_SERVER_ORIGIN` per request instead of
 * baking it. Three ways to set the header were tried and MEASURED, not assumed:
 *
 *   1. `headers()` in next.config.ts — resolved at BUILD time. The variable was
 *      set in the server's environment and /env.js served it correctly, while
 *      the same value came out empty in a header declared there.
 *   2. Middleware, edge runtime — same result. Next bundles middleware
 *      separately and folds `process.env` into it at build: the built
 *      `.next/server/middleware.js` contained ZERO references to the variable.
 *   3. Middleware, `runtime: 'nodejs'`, and again reading the key through a
 *      variable to defeat static substitution — still empty, still zero
 *      references. Middleware cannot see runtime env here, full stop.
 *
 * Server components and route handlers CAN (their env reads survive into
 * `.next/server/chunks/`, which is why /env.js works). So the origin-dependent
 * half belongs in a `<meta http-equiv>` rendered by the root layout — meta
 * supports every directive below EXCEPT `frame-ancestors`, which is header-only
 * and happily needs no origin.
 *
 * ── What ships, and what it cost to get right ───────────────────────────────
 * Both halves are enforced now:
 *
 *   • {@link CSP_ENFORCED_STATIC} — origin-independent, a real header from
 *     next.config.ts.
 *   • {@link buildRuntimeCsp} — rendered as `<meta http-equiv>` by the root
 *     layout, which reads MANTLE_SERVER_ORIGIN per request.
 *
 * A CSP fails closed and SILENTLY: a wrong directive does not throw, it stops a
 * feature working and nobody finds out until a user does. Two directives were
 * wrong when this function was written-but-never-run, and both were found by
 * exercising them in a browser rather than by re-reading them:
 *
 *   • `frame-src 'self' blob:` blocked THREE surfaces, all cross-origin only in
 *     a split deployment and so invisible on the monolith — see the note there.
 *   • `img-src` without `https:` blocked every remote image in an email body,
 *     because a srcdoc iframe inherits this policy — see the note there.
 *
 * The meta is not literally the first node in <head> — Next hoists its own
 * preloads and framework scripts above it — but those are all 'self', and every
 * byte of app code runs after it, so the policy governs everything that matters.
 *
 * The signed-in pass is done: twelve routes clicked through in-app with a
 * `securitypolicyviolation` listener held across client-side navigation (a full
 * page load resets it), plus the Files cross-origin image preview, and direct
 * probes of the two shapes the dev brain could not mount — the sandbox's
 * `${apiBase}/frame` and the email body's srcdoc iframe. Zero violations.
 *
 * Two traps if you verify this again. A blocked iframe STILL FIRES its load
 * event, so rendering proves nothing — the violation record is the only honest
 * signal. And prove your listener is alive with a deliberate control violation
 * before you trust a quiet result; a sweep through a deaf instrument reads
 * exactly like a clean one.
 */

/**
 * Enforced today, as a header. Every directive here is origin-independent and
 * was checked against the code rather than assumed:
 *
 *  - `base-uri`: no `<base href>` anywhere. (The one `<base>` in the tree sets
 *    `target` inside the email iframe's srcdoc, which this does not govern.)
 *  - `object-src`: no `<object>`/`<embed>` in the app at all.
 *  - `frame-ancestors`: nothing is known to embed the owner UI, and the desktop
 *    shell loads it top-level. If a customer ever needs to frame a screen,
 *    this is the line to widen. Header-only: meta ignores it.
 */
export const CSP_ENFORCED_STATIC = [
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
].join('; ');

export type RuntimeCspOptions = {
  /** The brain's origin, e.g. `https://brain.example`. Empty for a same-origin
   *  deployment, where `'self'` already covers it. */
  brainOrigin: string;
  /** Dev servers need `ws:` for HMR. The live streams are SSE over http;
   *  the one WebSocket app code opens is a call's signalling (wss on the
   *  brain's host, behind its /livekit path), named below. */
  dev?: boolean;
};

const clean = (origin: string) => origin.trim().replace(/\/+$/, '');

/** `https://brain.example` -> `wss://brain.example` (http -> ws); '' stays ''. */
export function websocketTwin(origin: string): string {
  const o = clean(origin);
  if (o.startsWith('https://')) return `wss://${o.slice(8)}`;
  if (o.startsWith('http://')) return `ws://${o.slice(7)}`;
  return '';
}

/** Join sources, dropping empties, so an absent brain origin leaves no gap. */
const list = (...sources: string[]) => sources.filter(Boolean).join(' ');

/**
 * The origin-dependent half — emitted as `<meta http-equiv>` by the root
 * layout. Pure, unit-tested, and exercised signed in against a real brain.
 */
export function buildRuntimeCsp({ brainOrigin, dev = false }: RuntimeCspOptions): string {
  const brain = clean(brainOrigin);
  return [
    "default-src 'self'",
    // Next inlines its bootstrap, so 'unsafe-inline' stays until a nonce pass,
    // and mathjs compiles expressions on the formula screen. Neither is ideal
    // and neither is the point: connect-src is what stops a successful
    // injection getting the token off the box.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    // blob: for owner-generated previews (drawing exports, image attachments).
    // Every real asset of ours comes from the brain via assetUrl().
    //
    // `https:` is here for ONE surface: the email reading pane. Its body is a
    // srcdoc iframe, and a srcdoc iframe INHERITS this policy — measured, with
    // same-origin and data: controls loading while an arbitrary remote origin
    // did not. Email bodies routinely carry remote images, so the tight list
    // renders newsletters broken with no "show images" control to opt back in:
    // a silent product regression in exchange for no security. img-src is a
    // poor exfiltration channel (a URL path, no response read), the brain's
    // sanitizer is the real control over what that iframe may reference, and
    // connect-src below is what actually keeps the bearer on the box.
    //
    // The end state is the brain's sanitizer proxying remote images through the
    // brain; then this drops back to the tight list. media-src stays tight —
    // the email iframe has no allow-scripts and nothing else loads remote media.
    `img-src ${list("'self'", 'data:', 'blob:', 'https:', brain)}`,
    "font-src 'self' data:",
    // THE control: the directive that makes the bearer-in-localStorage posture
    // defensible.
    // A call signals over wss on the brain (calls P1, lib/calls/room.ts): the
    // brain's websocket twin, named so no browser has to upgrade the scheme
    // itself. Same-origin: 'self' covers wss on this host in CSP3.
    `connect-src ${list("'self'", brain, websocketTwin(brain), dev ? 'ws: wss:' : '')}`,
    // 'self' only. The brain was here for ONE form, the retired team portal's
    // cross-origin POST to <brain>/api/team/sso (member logins Phase 6); no
    // form in this app targets the brain now, so none may.
    "form-action 'self'",
    // The brain is NOT optional here, and 'self' alone breaks three surfaces in
    // a split deployment — measured, not reasoned: the mini-app sandbox
    // NAVIGATES its opaque-origin iframe to `${apiBase}/frame`
    // (@crossworks/share-ui app-sandbox.tsx), the Files PDF preview frames
    // `assetUrl('/api/files/files/<id>?raw=1')`, and the share panel frames
    // `serverUrl(path)`. All three resolve to the brain cross-origin; all three
    // are same-origin paths — and so invisible to this directive — only on the
    // monolith. That framed frame document carries its OWN policy as a response
    // header (a real `src` navigation does not inherit ours), so this line
    // decides whether it may be framed at all, nothing more.
    `frame-src ${list("'self'", 'blob:', brain)}`,
    "worker-src 'self' blob:",
    `media-src ${list("'self'", 'blob:', 'data:', brain)}`,
    "manifest-src 'self'",
  ].join('; ');
}
