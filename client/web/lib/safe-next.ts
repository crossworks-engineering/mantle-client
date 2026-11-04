/**
 * The `?next=` a sign-in bounces to, reduced to what it is allowed to be: a
 * path INSIDE this app. The middleware only ever writes a pathname here, but
 * the parameter arrives from the URL bar, so anyone can put anything in it —
 * and the app router hard-navigates external URLs, which made
 * `/login?next=https://evil.example` an open redirect fired the moment a
 * password was accepted.
 *
 * PATTERN-MATCHING THE STRING IS NOT ENOUGH, which is what the first version of
 * this did. `new URL()` STRIPS tab, LF and CR from anywhere in its input before
 * parsing, so a control character between the slashes walks straight past a
 * "does not start with `//`" test and comes out the far side as another origin:
 * `/⏎//evil.example` parses as `///evil.example`, and Next resolves that to
 * `https://evil.example/`. Next's own `isExternalURL` is `url.origin !==
 * location.origin` over `new URL(href, location.href)`, so whatever the URL
 * parser makes of the string is the only reading that matters.
 *
 * So we ask the parser instead of second-guessing it: resolve against a base
 * that can never be a real origin (`.invalid` is reserved by RFC 2606) and
 * require the result to have stayed there. Same shape as the desktop shell's
 * `inAppUrl()`, which is why the twin of this bug in `deepLinkToPath` was never
 * exploitable. The leading-slash test stays as the precondition, so only
 * path-shaped input is considered at all.
 *
 * Returns the resolved path — normalised, and free of the control characters
 * that made the bypass work — when it qualifies, else `undefined` so the caller
 * falls back to its default landing.
 */
const BASE = 'https://n.invalid';

export function safeNext(next: string | undefined | null): string | undefined {
  if (typeof next !== 'string' || !next.startsWith('/')) return undefined;
  try {
    const url = new URL(next, BASE);
    if (url.origin !== BASE) return undefined;
    // A path segment can parse back into two slashes (`/.//evil.example`): the
    // base keeps the origin above, but what comes out is scheme-relative.
    if (/^\/[/\\]/.test(url.pathname)) return undefined;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}
