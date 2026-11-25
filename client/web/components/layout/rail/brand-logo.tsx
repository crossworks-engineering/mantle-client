'use client';

import { cn } from '@mantle/web-ui/lib/utils';
import { serverUrl } from '@mantle/web-ui/runtime-env';

/**
 * The brand's logo/wordmark cascade, written ONCE for every surface that shows
 * the brand (the rail's brand block, the mobile bar).
 *
 * The cascade has three states and the third is the one that gets dropped when
 * this logic is copy-pasted — it already was, once: the mobile bar's copy
 * rendered `null` where the light-mode fallback belongs, so a brain with only
 * a DARK logo uploaded showed an empty brand link in light mode.
 *
 *  - no logo at all        → the wordmark.
 *  - base (light) logo set → that img in light mode; the dark img when a dark
 *    variant exists, else the base img serves both modes.
 *  - dark logo ONLY        → the dark img in dark mode, and the WORDMARK in
 *    light mode — never nothing.
 *
 * Light/dark are TWO imgs swapped by the `dark:` variant classes — a CSS swap,
 * so flipping the theme never waits on a fetch. Src is the server app's public
 * logo route; content-addressed, so ?v busts the immutable cache.
 *
 * Presentation stays with the caller: `imgClassName` sizes the imgs for the
 * surface, and `renderWordmark` supplies the surface's own text fallback (the
 * visibility class passed to it MUST be forwarded onto the rendered node, or
 * the dark-only case shows wordmark AND logo together in dark mode).
 *
 * ── `srcBase`, and why a SERVER-rendered caller must pass it ───────────────
 * `serverUrl()` reads `window.__MANTLE_ENV__`, which only exists in the
 * browser. Every original caller renders after mount (the rail waits on
 * /api/shell), so it was always there. The LOGIN mark is different: it is
 * resolved server-side on purpose, to avoid flashing the wrong brand — and on
 * the server `serverUrl()` finds no origin and falls back to a RELATIVE path.
 *
 * That relative path is correct on the default one-domain deployment, where
 * the reverse proxy routes /api to the brain — which is why this went unseen.
 * It is wrong wherever the client and the brain are on different origins: a
 * split-origin install, and a desktop shell, where it resolves
 * against the app's own origin and the logo simply fails to load. Hydration
 * does not rescue it either; React keeps the server's `src`.
 *
 * So a server-rendered caller passes the origin it already has
 * (`brainOrigin()` in lib/brain-origin.ts, the very string /env.js hands the
 * browser, so there is one value, not two). Omitted, the behavior is exactly
 * as before.
 */
export function BrandLogo({
  name,
  logoVersion,
  logoDarkVersion,
  imgClassName,
  renderWordmark,
  srcBase,
}: {
  name: string;
  logoVersion?: string | null;
  logoDarkVersion?: string | null;
  /** Sizing/fit classes for both imgs; the light/dark swap classes are added here. */
  imgClassName: string;
  /** The surface's text fallback; `visibility` is a class to merge in (e.g.
   *  `dark:hidden` when the wordmark only stands in for a missing light logo). */
  renderWordmark: (visibility?: string) => React.ReactNode;
  /** Brain origin for the img srcs. REQUIRED of server-rendered callers, which
   *  have no `window` for `serverUrl()` to read — see the note above. */
  srcBase?: string;
}) {
  const url = (path: string) =>
    srcBase ? `${srcBase.replace(/\/+$/, '')}${path}` : serverUrl(path);
  if (!logoVersion && !logoDarkVersion) return <>{renderWordmark()}</>;
  return (
    <>
      {logoVersion ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url(`/api/appearance/logo?v=${logoVersion}`)}
          alt={name}
          className={cn(imgClassName, logoDarkVersion && 'dark:hidden')}
        />
      ) : (
        renderWordmark('dark:hidden')
      )}
      {logoDarkVersion && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url(`/api/appearance/logo?variant=dark&v=${logoDarkVersion}`)}
          alt={name}
          className={cn('hidden dark:block', imgClassName)}
        />
      )}
    </>
  );
}
