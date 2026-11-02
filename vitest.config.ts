import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// A `:bun` run (scripts/bun.sh sets MANTLE_EXPECT_RUNTIME=bun) must not end up
// on Node, also when a file filter leaves scripts/bun-runtime.test.ts out.
// Unset, as on the Node path, this does nothing.
if (process.env.MANTLE_EXPECT_RUNTIME === 'bun') {
  const pinned = readFileSync(new URL('./.bun-version', import.meta.url), 'utf8').trim();
  const have = process.versions.bun;
  if (have !== pinned) {
    const on = have ? `Bun ${have}` : `Node ${process.versions.node}`;
    throw new Error(
      `MANTLE_EXPECT_RUNTIME=bun, but vitest runs on ${on} (.bun-version: ${pinned})`,
    );
  }
}

/**
 * Minimal vitest setup. Each package can ship `*.test.ts` files anywhere
 * under its `src/` directory and they'll be picked up. No jsdom — we
 * test pure logic only for now; UI behaviour goes through `pnpm build`
 * + manual smoke for the time being.
 */
export default defineConfig({
  test: {
    include: [
      'packages/**/src/**/*.test.ts',
      'server/**/*.test.ts',
      'client/**/*.test.ts',
      'e2e/lib/**/*.test.ts',
      'eslint-rules/**/*.test.ts',
      // The release script's harness (scripts/tag-release.test.ts runs it).
      'scripts/**/*.test.ts',
    ],
    environment: 'node',
    globals: false,
    // The 5s default assumes a test only times its own logic. Several tests
    // import modules INSIDE the test body — sometimes because the module reads
    // env that a `beforeAll` has to set first — so module resolution and the
    // esbuild transform are billed against this budget too. On a many-core box
    // vitest runs ~one worker per core, all transforming at once (this suite
    // reports ~250s of aggregate import time), and a `require('mathjs')` that
    // costs 411ms idle can pass 5s when the machine is genuinely busy. That
    // failed the pre-push gate on a green tree, which is the expensive kind of
    // false alarm: it teaches people to retry rather than to read.
    testTimeout: 15_000,
    // Workspace packages export raw TS — vitest's esbuild handles them.
    server: { deps: { inline: [/^@mantle\//] } },
  },
  // The app's tsconfig says `jsx: preserve` (Next compiles it), which leaves
  // esbuild on the classic runtime, where a component file needs `React` in
  // scope. Tests that render an app component (renderToStaticMarkup) need
  // the automatic runtime the kit's own tsconfig already asks for.
  esbuild: { jsx: 'automatic' },
  // The app's own `@/` alias (client/web/tsconfig.json `paths`), so a test can
  // render an app component that imports its siblings that way. Anchored on
  // the slash: `@mantle/...` and every other scoped package are untouched.
  resolve: {
    alias: [
      { find: /^@\//, replacement: fileURLToPath(new URL('./client/web/', import.meta.url)) },
    ],
  },
});
