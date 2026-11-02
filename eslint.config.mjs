// Flat ESLint config for the whole monorepo. Formatting is Prettier's job
// (see .prettierrc.json / `pnpm format`); ESLint here is purely for *code*
// correctness — dead code, unsafe patterns, real bugs — never style.
//
// Scope is deliberately syntactic (typescript-eslint `recommended`, not the
// type-checked `recommendedTypeChecked`): it needs no per-file type program, so
// `eslint .` stays fast enough for a pre-commit / CI gate. The type-aware rules
// (no-floating-promises, no-misused-promises) and ratcheting the `warn` rules
// below up to `error` are documented follow-ups once the base gate has settled.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import nextPlugin from '@next/eslint-plugin-next';
import mantlePlugin from './eslint-rules/pair-fill-foreground.mjs';
import housePlugin from './eslint-rules/house-style.mjs';

/**
 * The jackdaw split boundary for the client tier (the blocks below): the
 * client may import ONLY the split-safe packages, not even `import type` from
 * a server package, because after the repo cut those types no longer exist on
 * this side. Wire shapes live in @mantle/client-types; browser-safe logic in
 * content-core / voice-client. `extra` widens it for one part of the client.
 */
function clientTierImports(extra = []) {
  const allowed = [
    '@mantle/client-types',
    '@mantle/content-core',
    '@mantle/voice-client',
    '@mantle/share-ui',
    '@mantle/web-ui',
    ...extra,
  ];
  const names = allowed.map((a) => a.replace('@mantle/', '')).join(',');
  return [
    'error',
    {
      // The UI is a static export: each dynamic route is ONE placeholder page,
      // so Next's own params read `_` there. Read them from the path.
      paths: [
        {
          name: 'next/navigation',
          importNames: ['useParams', 'useSelectedLayoutSegment', 'useSelectedLayoutSegments'],
          message:
            'static export: route params read the placeholder here; use useRouteParams (client/web/lib/route-params.ts)',
        },
      ],
      patterns: [
        {
          group: ['@mantle/*', ...allowed.flatMap((a) => [`!${a}`, `!${a}/*`])],
          message: `jackdaw split boundary — the client tier may import only @mantle/{${names}}`,
        },
        {
          // Gone since the P0 follow-up: the tsconfig alias itself was
          // removed, so this is a tripwire against reintroducing it.
          group: ['@server/*'],
          message:
            '@server/* no longer exists — wire types live in @mantle/client-types (or content-core)',
        },
      ],
    },
  ];
}

export default tseslint.config(
  {
    // Build output, deps, generated/vendored — never linted.
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/out/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      'packages/db/migrations/**',
      // Generated Next type shim + generated @host kit bundles (minified,
      // gitignored) — not ours to lint.
      '**/next-env.d.ts',
      'server/web/public/app-runtime/**',
      'client/web/public/app-runtime/**',
      // The static UI's generated boot script + CSP template (build-boot.mjs).
      'client/web/public/_mantle/**',
      // The box server bundle (client/host/scripts/build.mjs).
      'client/host/dist/**',
      // The desktop shell's STAGED copy of the built owner UI — the whole
      // static export (gitignored). CI never sees it because it
      // lints a fresh checkout, but anyone who runs `build:ui` locally and
      // then `pnpm verify` gets hundreds of errors from minified vendor
      // bundles that are not ours to lint.
      'client/desktop/ui/**',
      // Generated share-surface bundle + route manifest (gitignored).
      'server/web/public/share-runtime/**',
      'server/web/server/route-manifest.gen.ts',
      // Local Docker-stack runtime bind-mounts (gitignored; often root-owned
      // mode 700 — must be pruned so `eslint .` doesn't die on EACCES).
      'data/**',
      // Sibling git worktrees live under .claude/ in the integrator clone
      // (gitignored). Each worktree lints itself; never lint them from here.
      '.claude/**',
      // The pre-v0.202 tree (apps/web, apps/api, apps/mcp, apps/agent) was
      // renamed to server/* + client/*. A leftover apps/ is untracked AND
      // ungitignored, so `eslint .` walks it and parses its minified
      // app-runtime bundles as source — 752 errors from a directory that is
      // not part of the repo. That turned the pre-push gate into a wolf-cry
      // (v0.206.3 had to be pushed from a worktree). Deleted 2026-07-27; this
      // stays so a stale checkout can never re-break the gate.
      'apps/**',
      // Agent-tooling trees (.agents/, .codex/, .github/{agents,hooks,skills}).
      // Same wolf-cry as apps/** above: these carry minified vendor bundles that
      // `eslint .` parses as source — 2,428 errors on main, 2026-08-04, entirely
      // from .agents/skills/impeccable + .github/skills/impeccable. Note these
      // are ALREADY gitignored and that is NOT sufficient: flat config does not
      // read .gitignore, so the ignore has to be repeated here.
      '.agents/**',
      '.codex/**',
      '.github/agents/**',
      '.github/hooks/**',
      '.github/skills/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // noUnusedLocals is OFF in tsconfig, so ESLint is the only thing catching
      // dead variables/imports. Allow intentional `_`-prefixed throwaways.
      // Backlog burned down (audit #4) — now `error` so CI blocks new dead code.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // `any` is a smell; the few pragmatic untyped-boundary uses carry an
      // inline `eslint-disable` with a reason. Backlog burned down (audit #4) —
      // now `error` so new `any` must be justified explicitly.
      '@typescript-eslint/no-explicit-any': 'error',
      // The `cond ? a() : b()` / `cond && side()` statement idiom is used
      // deliberately for side effects across the UI — allow it while still
      // catching a genuinely dead bare expression.
      '@typescript-eslint/no-unused-expressions': [
        'error',
        { allowShortCircuit: true, allowTernary: true, allowTaggedTemplates: true },
      ],
    },
  },
  {
    // Plain-JS tooling (no TS to declare Node globals) — teach ESLint about
    // process/console/etc. so no-undef doesn't false-positive.
    files: ['**/*.mjs', '**/*.cjs', '**/*.js', 'scripts/**'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // React/Next linting for the web app. These resolve the inline
    // `eslint-disable react-hooks/*` / `@next/next/*` directives left from the
    // old `next lint` setup, and add real value (hook-deps, next foot-guns).
    // exhaustive-deps backlog triaged + burned down (audit #4) — now `error`;
    // intentional omissions carry an inline `eslint-disable` with a reason.
    //
    // packages/web-ui IS included, and was the gap that proved it matters: the
    // shared components moved there over time while this glob still named only
    // the two apps, so ~30 hook-using components — every provider, the sandbox,
    // the share presenters — were silently unlinted. A missing `tint` dep in
    // the avatar component shipped a picker whose previews never repainted:
    // the state changed, the memo did not.
    files: [
      'server/web/**/*.{ts,tsx}',
      'client/web/**/*.{ts,tsx}',
      'packages/web-ui/**/*.{ts,tsx}',
      'packages/share-ui/**/*.{ts,tsx}',
    ],
    plugins: { 'react-hooks': reactHooks, '@next/next': nextPlugin },
    rules: {
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'error',
      '@next/next/no-img-element': 'warn',
    },
  },
  {
    // FILE SIZE, as a descending ceiling.
    //
    // Four screens sit between 2,100 and 2,500 lines with 14 to 30 `useState`
    // each and no tests, which is the audit's structure finding: a component
    // that long has no seam to assert against, so every change to it is
    // verified by clicking. The pass that fixes it is planned in
    // docs/handover-structure.md, and this is its phase zero — because the same
    // audit's central observation was that every lint-backed rule held and
    // every prose-only rule decayed. A structure pass with no gate behind it is
    // a prose rule.
    //
    // A CEILING, NOT A WARNING COUNT. `pnpm lint` now runs `--max-warnings 0`
    // — the no-raw-form-control budget that used to occupy it went to zero in
    // v0.6.97 — so a size WARNING could never be emitted at all without failing
    // the build, and raising the cap to make room is what the house rule
    // forbids. A threshold ratchets the same way without needing a budget:
    // set to the worst file that exists, so nothing fails today and nothing may
    // grow past it, then lowered with each landing. It only ever goes down.
    // 2507 when it landed; 1866 after phase 1 moved the already-standalone
    // components out of the four oversized screens.
    //
    // Comments and blank lines COUNT. This repo comments heavily and on
    // purpose, and that is weight a reader carries too — so the number means
    // what `wc -l` says, and cannot be gamed by moving prose around.
    files: [
      'client/web/**/*.{ts,tsx}',
      'packages/web-ui/**/*.{ts,tsx}',
      'packages/share-ui/**/*.{ts,tsx}',
    ],
    rules: {
      'max-lines': ['error', { max: 1799, skipBlankLines: false, skipComments: false }],
    },
  },
  {
    // A themed fill must carry an ink that is legible on it. The style guide has
    // said so for months and it still shipped invisible text twice (v0.205.7,
    // v0.206.1) — found by a user, not CI. See eslint-rules/ for why the rule is
    // deliberately narrow: the common `text-muted-foreground hover:bg-accent
    // hover:text-accent-foreground` idiom is CORRECT and must not be flagged.
    files: [
      'client/web/**/*.{ts,tsx}',
      'server/web/**/*.{ts,tsx}',
      'packages/web-ui/**/*.{ts,tsx}',
      'packages/share-ui/**/*.{ts,tsx}',
    ],
    plugins: { mantle: mantlePlugin },
    rules: { 'mantle/pair-fill-foreground': 'error', 'mantle/use-ink-for-text': 'error' },
  },
  {
    // The three house rules that decayed while they were prose. The 2026-09-07
    // audit found the pattern exactly: every lint-backed rule was perfect,
    // every prose-only one had rotted — 359 palette literals, 166 raw buttons
    // (six with any focus style), 60 unthinned scrollers.
    //
    // They land as WARN, not error, because the backlog is real (465 warnings
    // the day they landed) and burning it down is its own piece of work. What
    // stops them being ignored is the ratchet: `pnpm lint` runs with
    // `--max-warnings 188`, so the count can fall but never rise — a new raw
    // button fails CI today, while the existing ones wait their turn. Lower the
    // cap as it burns down, then promote the rule to `error`, the same path
    // `no-unused-vars`, `no-explicit-any` and `exhaustive-deps` each took (see
    // above), and the path the two rules below have now finished walking: their
    // backlog reached zero in the v0.6.55 pass, so a violation is an error and
    // the ratchet no longer has to hold them.
    files: [
      'client/web/**/*.{ts,tsx}',
      'packages/web-ui/**/*.{ts,tsx}',
      'server/web/**/*.{ts,tsx}',
      'packages/share-ui/**/*.{ts,tsx}',
    ],
    plugins: { house: housePlugin },
    rules: {
      'house/no-palette-literal': 'error',
      'house/require-thin-scrollbar': 'error',
      // Straight to `error`, no ratchet: the backlog was two sites, not a
      // hundred, and both are fixed in the commit that adds this.
      'house/require-noopener': 'error',
    },
  },
  {
    // Raw controls, everywhere EXCEPT the kit's own primitives — those files
    // are where the raw <button>/<input> is supposed to live, since wrapping
    // them is the whole point of the kit.
    files: ['client/web/**/*.{ts,tsx}', 'server/web/**/*.{ts,tsx}'],
    plugins: { house: housePlugin },
    // `error` since v0.6.97, the landing that cleared the last of the 188.
    // The remaining raw controls in these trees are each behind a deliberate
    // eslint-disable naming its reason — a field whose box belongs to the
    // wrapper around it, which the kit's boxed primitives cannot give up.
    rules: { 'house/no-raw-form-control': 'error' },
  },
  {
    // Tests + one-shot scripts: relax rules that only make sense for shipped code.
    files: ['**/*.test.ts', '**/*.test.tsx', 'scripts/**', '**/scripts/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // ── The split boundary ──────────────────────────────────────────────────
    // client/web + packages/web-ui are the ZERO-SECRET tier: server packages
    // may be imported as TYPES only (erased at compile); values would drag
    // Postgres/node into the browser bundle. The content BARREL is banned as a
    // value even server-side of the fence — clients use its runtime-pure
    // subpaths. `@server/*` and `@/…`-fallback resolution exist for TYPE
    // reach-through only.
    files: ['client/**/*.{ts,tsx}', 'packages/web-ui/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/no-restricted-imports': clientTierImports() },
  },
  {
    // The UI keeps no cookies of its own: the desktop app's URL scheme
    // (mantle-ui://localhost) keeps none, so a value kept there was lost on
    // every load. Its small preferences go through ui-prefs (localStorage),
    // the one file that still reads document.cookie, to move an older
    // build's values over.
    files: ['client/web/**/*.{ts,tsx}', 'packages/web-ui/**/*.{ts,tsx}'],
    ignores: ['packages/web-ui/src/ui-prefs.ts', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='document'][property.name='cookie']",
          message: 'Keep UI state in @mantle/web-ui/ui-prefs, not document.cookie.',
        },
      ],
    },
  },
  {
    // client/desktop also takes @mantle/client-host: the node-side host of the
    // static UI, bundled into the Electron main process. Never client/web or
    // web-ui: it reads files from disk and has no place in a browser bundle.
    files: ['client/desktop/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': clientTierImports(['@mantle/client-host']),
    },
  },
  {
    // The published contract/browser-safe packages are self-contained by
    // design: no @mantle sibling may leak in, or the repo split (and npm
    // publish) breaks. web-ui is deliberately NOT here — it may consume the
    // three packages below (enforced by the client-tier block above).
    files: [
      'packages/client-types/**/*.ts',
      'packages/content-core/**/*.ts',
      'packages/voice-client/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@mantle/*'],
              message:
                'contract packages are zero-dep by design (jackdaw split P0) — move shared code here instead of importing it',
            },
          ],
        },
      ],
    },
  },
  {
    // share-ui sits one layer up: it may consume the zero-dep contract
    // packages but nothing else @mantle — in particular NOT web-ui, or the
    // published package would drag the whole UI kit into the server image.
    files: ['packages/share-ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@mantle/*',
                '!@mantle/client-types',
                '!@mantle/client-types/*',
                '!@mantle/content-core',
                '!@mantle/content-core/*',
              ],
              message:
                'share-ui may import only @mantle/{client-types,content-core} (jackdaw split boundary)',
            },
          ],
        },
      ],
    },
  },
  {
    // Server tier must never import the client app.
    files: ['server/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/client/web/**', '@mantle/client-web*'],
              message: 'server tier must not import the client app',
            },
          ],
        },
      ],
    },
  },
);
