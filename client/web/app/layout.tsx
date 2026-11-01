import type { Metadata } from 'next';
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
import { FALLBACK_NAME } from '@/lib/brand';

/**
 * ZERO-SECRET client root layout, rendered once at BUILD time: the UI ships as
 * static files and a host serves them (docs/static-ui-host.md).
 *
 * The brain's SYSTEM-WIDE appearance (colour theme, the four fonts and their
 * sizes, avatar style) still lands on the <html> tag before the first paint,
 * but the host brings it now: its /env.js carries the brain's raw public
 * appearance, and /_mantle/boot.js (lib/boot/boot-apply.ts) maps it onto these
 * same attributes with the same share-ui functions. Both are blocking scripts
 * at the top of <head>, so the body never paints with the wrong theme. What
 * this layout renders itself is the fresh-install default, which is what a
 * host without an appearance gets. The client providers read the attributes
 * back on mount, as before.
 *
 * The tab title is a template so a child's own title keeps the brand. The
 * brand here is the fallback name; boot.js swaps in the brain's own name, and
 * keeps doing it as Next rewrites the title on each navigation.
 *
 * The Content-Security-Policy is the HOST's header now (public/_mantle/csp.txt,
 * generated from lib/csp.ts): only the host knows which brain this window
 * talks to, and a header can carry frame-ancestors, which meta never could.
 */
export const metadata: Metadata = {
  title: { default: FALLBACK_NAME, template: `%s · ${FALLBACK_NAME}` },
  description: 'The data-aware workspace.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const appearance = resolveAppearanceAttrs(null);
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
        {/* BLOCKING, on purpose, and in this order: the host's runtime config
            (window.__MANTLE_ENV__: api base, flags, the brain's appearance)
            must exist before any bundle code runs, and boot.js must apply the
            appearance before the body paints. */}
        <script src="/env.js" />
        <script src="/_mantle/boot.js" />
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
