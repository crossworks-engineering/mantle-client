import type { NextConfig } from 'next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CSP_ENFORCED_STATIC } from './lib/csp';
import { LINK_CODE_PAGES } from './lib/link-code';

/**
 * The ZERO-SECRET owner-UI app. No DB, no server packages, no SESSION_SECRET —
 * every byte of data comes from the server origin over bearer + CORS (see
 * @mantle/web-ui/api-fetch). Same-origin deployments simply serve this app and
 * the server app behind one host; the split serves it at app.<domain>.
 */

// Build identity — mirrors server/web: the ROOT package.json version is the
// single source of truth (scripts/bump-version.mjs keeps this file's own
// version in lockstep for the workspace, but the inlined value reads root).
const rootPkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as {
  version: string;
};

const nextConfig: NextConfig = {
  // The published contract packages ship TS source; both their alias names
  // (@mantle/*, how this repo imports them) and their real npm names
  // (@crossworks/*, what the installed package.json declares) are listed so
  // Turbopack transpiles them regardless of which identity it matches on.
  transpilePackages: [
    '@mantle/web-ui',
    '@mantle/client-types',
    '@mantle/content-core',
    '@mantle/voice-client',
    '@mantle/share-ui',
    '@crossworks/client-types',
    '@crossworks/content-core',
    '@crossworks/voice-client',
    '@crossworks/share-ui',
  ],
  // Pin the dev/build root to THIS checkout. Without it Turbopack infers the
  // root by scanning upward for lockfiles, finds the integrator clone's, and
  // roots there — and since `.claude/worktrees/` lives INSIDE that clone, every
  // sibling worktree falls under the root and becomes fair game to compile.
  // The failure is spectacular and easy to misread: a dev server in worktree A
  // serves chunks built from worktree B, the module factories don't exist
  // ("module factory is not available"), and the dev overlay hard-reloads to
  // recover — forever. It presents as an infinite refresh loop, not as a
  // resolution error. Same guess `outputFileTracingRoot` below already guards.
  turbopack: { root: join(__dirname, '../..') },
  // Desktop shell (client/desktop) embeds this app as a self-contained node
  // server. Opt-in so image builds keep today's output. The tracing root is
  // pinned to the monorepo root so the standalone tree resolves workspace deps
  // from THIS checkout (with several worktrees present Next would guess).
  ...(process.env.MANTLE_STANDALONE
    ? { output: 'standalone' as const, outputFileTracingRoot: join(__dirname, '../..') }
    : {}),
  ...(process.env.MANTLE_STATIC ? { output: 'export' as const } : {}),
  env: {
    NEXT_PUBLIC_APP_VERSION: rootPkg.version,
    NEXT_PUBLIC_GIT_SHA: process.env.MANTLE_GIT_SHA ?? '',
    NEXT_PUBLIC_BUILD_TIME: process.env.MANTLE_BUILD_TIME ?? '',
  },
  // No /app-runtime here: every mini-app sandbox frames a document the BRAIN
  // renders (`${apiBase}/frame`), whose import map and CSP both point at the
  // brain's own /app-runtime. Nothing ever loaded a copy from this origin.
  async headers() {
    if (process.env.MANTLE_STATIC) return [];
    return [
      // The origin-independent half of the CSP, on every response. Resolved at
      // build time, which is exactly why only the origin-independent half is
      // here — see lib/csp.ts for the measurements behind that split. The
      // runtime half (which names the brain) cannot live here at all; it is a
      // <meta> rendered by the root layout. Harmless on the asset routes below
      // (CSP governs documents), and this way no route can be added that
      // quietly ships without one.
      {
        source: '/:path*',
        headers: [{ key: 'Content-Security-Policy', value: CSP_ENFORCED_STATIC }],
      },
      // The pages a sign-in or invite link opens (lib/link-code.ts): a link
      // issued before the fragment carries its code in the query, and no
      // request from these pages may name it in a Referer.
      ...LINK_CODE_PAGES.map((source) => ({
        source,
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      })),
    ];
  },
  // Renamed screens — old bookmarks/deep-links keep working (moved from the
  // monolith; these are owner-UI routes, so they live here now).
  async redirects() {
    if (process.env.MANTLE_STATIC) return [];
    return [
      { source: '/lifelog', destination: '/journal', permanent: true },
      { source: '/memories', destination: '/journal', permanent: true },
      { source: '/todos', destination: '/tasks', permanent: true },
    ];
  },
};

export default nextConfig;
