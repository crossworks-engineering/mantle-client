import type { NextConfig } from 'next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

// A `:bun` run (scripts/bun.sh sets MANTLE_EXPECT_RUNTIME=bun) that ended up
// on Node would build or serve on Node and still be called Bun. Fail here,
// inside next dev and next build, unless this is the pinned Bun. Unset, as on
// the Node path and in the image build, this does nothing.
if (process.env.MANTLE_EXPECT_RUNTIME === 'bun') {
  const pinned = readFileSync(join(__dirname, '../../.bun-version'), 'utf8').trim();
  const have = process.versions.bun;
  if (have !== pinned) {
    const on = have ? `Bun ${have}` : `Node ${process.versions.node}`;
    throw new Error(`MANTLE_EXPECT_RUNTIME=bun, but next runs on ${on} (.bun-version: ${pinned})`);
  }
}

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
  // Static files only: no server renders this UI. A host serves out/ (the
  // desktop shell per brain window, the box server per box) and owns what a
  // server used to do here: the per-brain /env.js, the CSP header, the
  // no-referrer header on the link-code pages, and the fallback that serves a
  // dynamic route's one placeholder page for every id. docs/static-ui-host.md.
  // The BUILD only: under `next dev` an export refuses every id it did not
  // export, so dev stays an ordinary dev server. The pages read their ids from
  // the path either way (lib/route-params.ts).
  ...(process.env.NODE_ENV === 'production' ? { output: 'export' as const } : {}),
  env: {
    NEXT_PUBLIC_APP_VERSION: rootPkg.version,
    NEXT_PUBLIC_GIT_SHA: process.env.MANTLE_GIT_SHA ?? '',
    NEXT_PUBLIC_BUILD_TIME: process.env.MANTLE_BUILD_TIME ?? '',
  },
  // No /app-runtime here: every mini-app sandbox frames a document the BRAIN
  // renders (`${apiBase}/frame`), whose import map and CSP both point at the
  // brain's own /app-runtime. Nothing ever loaded a copy from this origin.
};

export default nextConfig;
