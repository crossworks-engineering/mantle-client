import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
// KaTeX styles for math nodes (inlineMath/blockMath) — bundled locally from the
// npm package (no CDN), matching the self-hosted ethos.
import 'katex/dist/katex.min.css';
import { fontSans } from '@/lib/fonts';
import { ThemeProvider } from '@mantle/web-ui/theme-provider';
import { ColorThemeProvider } from '@mantle/web-ui/color-theme-provider';
import { AvatarStyleProvider } from '@mantle/web-ui/avatar-style-provider';
import { BackgroundProvider } from '@mantle/web-ui/background-provider';
import { FontProvider } from '@mantle/web-ui/font-provider';
import { QueryProvider } from '@mantle/web-ui/query-provider';
import { displayFontFaceCss } from '@mantle/web-ui/display-fonts';
import {
  appearanceFontAttrs,
  appearanceFontVars,
  resolveAppearanceAttrs,
} from '@mantle/web-ui/appearance';
import { brandTitle, readBrandFields } from '@/lib/brand';
import { buildRuntimeCsp } from '@/lib/csp';

/**
 * ZERO-SECRET client root layout. No DB, no session read.
 *
 * The brain's SYSTEM-WIDE appearance (colour theme, the four fonts and their
 * sizes, avatar style) is
 * rendered straight into the <html> tag: attributes for the ids and inline
 * style for the font-family vars, fetched server-to-server from the public
 * GET /api/appearance (cached in lib/appearance.ts). The document arrives
 * correct — no before-paint scripts, no localStorage, nothing to coordinate;
 * the client providers read these attributes back on mount. That fetch is
 * per-request state, so the layout is explicitly dynamic — which this app
 * effectively is anyway (/env.js already serves per-request runtime config).
 */
// SPIKE (static export): no per-request render.

/**
 * The tab carries the brain's OWN name.
 *
 * It was the static string 'Jackdaw' on every route, so several brains — or
 * several tabs on one brain — were indistinguishable without clicking through,
 * which is the one job a tab title has. That was a documented compromise of the
 * zero-secret rule, but the rule does not actually block this: the layout
 * already fetches PUBLIC brain config server-to-server (`loadBrainAppearance`)
 * precisely so the document arrives correct, and a site name is public branding
 * of the same kind — not a secret.
 *
 * `generateMetadata` rather than the static `metadata` object, and the two
 * cannot both be exported from one segment. Same cached fetch the layout body
 * awaits below, so this costs no extra request.
 *
 * A TEMPLATE, not a bare string, and that is the half that makes this actually
 * work. A child segment's own `metadata.title` REPLACES the root's outright, so
 * with a plain string here every /team route still read "Team · Files" on every
 * brain — the exact indistinguishability this set out to fix, surviving on all
 * the pages someone leaves open. `template` appends the brain's name to
 * whatever a child sets instead; `default` covers the segments that set none.
 *
 * The brain's name goes LAST because a tab strip truncates from the right and
 * the page is what you are scanning for first — the name is the disambiguator
 * you read once you have found the right kind of tab.
 */
export async function generateMetadata(): Promise<Metadata> {
  const name = brandTitle(readBrandFields(null)); // SPIKE: host fills the brand later
  return {
    title: { default: name, template: `%s · ${name}` },
    description: 'The data-aware workspace.',
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const appearance = resolveAppearanceAttrs(null); // SPIKE: defaults; host injects before paint
  // The origin-dependent half of the CSP (lib/csp.ts). It has to be rendered
  // here, as meta, because a header cannot carry it: `process.env` resolves at
  // BUILD time in next.config.ts's headers() and in middleware on both
  // runtimes, and one prebuilt image serves any brain. Server components read
  // runtime env — the same reason /env.js works. The static, origin-free half
  // is still a real header (CSP_ENFORCED_STATIC); the two compose, and
  // frame-ancestors stays in the header because meta ignores it. The brain is
  // the REQUEST's (lib/brain-origin.ts): in the desktop shell one server
  // renders for several brains, and a connect-src naming another brain than
  // the window's refuses every request the window makes to its own.
  // SPIKE: the per-brain CSP meta moves to the host (Tauri protocol / box server).
  const csp = buildRuntimeCsp({ brainOrigin: '', dev: process.env.NODE_ENV !== 'production' });
  // Font attributes + vars come from the shared projections in appearance.ts —
  // the same tables the server htmlPage renders, so the two documents cannot
  // drift (the drift is exactly how /s and /print lost the interface font for
  // months). The chosen UI font overrides `--font-sans`, which next/font
  // declares via the `fontSans.variable` CLASS — so both have to sit on the
  // SAME element for inline style to win. Hence the font classes live on
  // <html>, not <body>; on <body> the class would redeclare the var below this
  // override and quietly win it back.
  const fontStyle: Record<string, string> = {
    ...appearanceFontVars(appearance),
    // Always published, override or not: the modal's own "Inter" row previews
    // through this, and resolving it through --font-sans would make that row
    // render in whatever face is currently chosen instead of in Inter.
    '--font-sans-base': fontSans.style.fontFamily,
  };
  return (
    <html
      lang="en"
      className={`${fontSans.variable} h-full`}
      suppressHydrationWarning
      data-color-theme={appearance.colorTheme}
      {...appearanceFontAttrs(appearance)}
      data-avatar-style={appearance.avatarStyle}
      data-avatar-tint={appearance.avatarTint}
      data-backgrounds={appearance.backgrounds}
      style={fontStyle as React.CSSProperties}
    >
      <head>
        {/* FIRST in the head, before any script or style: a meta CSP governs
            only the content that FOLLOWS it in document order. */}
        <meta httpEquiv="Content-Security-Policy" content={csp} />
        {/* Runtime config, BLOCKING — window.__MANTLE_ENV__ (api base,
            flags) must exist before any bundle code runs. Served per-request by
            app/env.js/route.ts from process.env: one image, any server origin. */}
        <Script src="/env.js" strategy="beforeInteractive" />
        {/* Selectable wordmark/title/UI fonts: @font-face declarations (lazy —
            a file downloads only when a face is actually painted). */}
        <style dangerouslySetInnerHTML={{ __html: displayFontFaceCss() }} />
      </head>
      <body className="h-full font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ColorThemeProvider>
            <FontProvider>
              <AvatarStyleProvider>
                <BackgroundProvider>
                  <QueryProvider>{children}</QueryProvider>
                </BackgroundProvider>
              </AvatarStyleProvider>
            </FontProvider>
          </ColorThemeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
