# Bun for the developer tools

The developer tools run on Node by default, and on Bun beside it. Node stays
the default and the required gate (`pnpm verify`, `verify.yml`). The Bun path
gives the same results, checked test by test and file by file. It is faster
for tests, builds and the dev server's start, and slower for pages in a
browser under `next dev` (numbers below).

The box image already runs on Bun (`Dockerfile`, final stage). This page is
about the tools only.

## Commands

| Node (default)            | Bun                      | What                                         |
| ------------------------- | ------------------------ | -------------------------------------------- |
| `pnpm install`            | (the same)               | pnpm installs for both. See below why.       |
| `pnpm dev`                | `pnpm dev:bun`           | `next dev` (slower pages on Bun, see below)  |
| `pnpm -C client/web build`<br>`pnpm -C client/host build` | `pnpm build:bun` | the static export and the host bundle |
| `pnpm test`               | `pnpm test:bun`          | vitest                                       |
| `pnpm verify`             | `pnpm verify:bun`        | typecheck, lint, format check, vitest        |
| `pnpm e2e:workspace`      | `pnpm e2e:workspace:bun` | the workspace specs, `next dev` on Bun       |

Every `:bun` script goes through `scripts/bun.sh`. It refuses a Bun other than
the one `.bun-version` pins, then runs `bun run --bun <script>`. That puts a
`node` that is Bun first on PATH, so every process the script starts (the
nested `pnpm -r`, tsc, eslint, prettier, vitest and its workers, next and its
build workers, the esbuild scripts) runs on Bun too. This was checked by
reading `/proc/<pid>/exe` of every process under `scripts/bun.sh` during a
run: Bun only, no Node (esbuild and Turbopack are native binaries either
way). The `pnpm` that starts `pnpm verify:bun` is still on Node; it only
starts `scripts/bun.sh`. `bun run --bun` also points `NODE` and
`npm_node_execpath` at its Bun, so no tool finds Node through them.

Each run checks it too: `scripts/bun.sh` sets `MANTLE_EXPECT_RUNTIME=bun`, and
then `scripts/bun-runtime.test.ts` fails unless vitest and the `node` on PATH
are the pinned Bun. A plain `pnpm verify` does not set it.

Bun loads `.env` files and installs missing packages on its own when it runs
a file directly. Neither happens here, checked on 1.4.4: the scripts that
`bun run` starts saw no `.env` value, and with `node_modules` in place a
missing package is an error, not an install. A root `bunfig.toml` would not
help: Bun reads it from the working directory only, and most `:bun` scripts
run in `client/web`.

Install Bun: `scripts/install-bun.sh <dir>` on Linux x64 (it checks a pinned
sha256), or Bun's own installer for that exact version elsewhere.

## What stays on Node, and why

- **The installer: pnpm.** `bun install` was tried on a clean copy. It does
  not keep `pnpm-lock.yaml`'s versions: 119 of 832 packages came out at other
  versions (for example `next` 16.4.4, where the lock says 16.4.3). It also
  rewrites `package.json` (adds `workspaces`, `overrides` and
  `patchedDependencies`). The mantle repo's Bun plan puts the installer last,
  with its own audit, for the same reason. pnpm can run on Bun inside a
  `:bun` script: that runs scripts only, it installs nothing.
- **The image build stages (`deps`, `build`).** A Bun build of the export is
  the same UI but not the same bytes. `next-themes` writes its theme script
  into each page with `Function.prototype.toString()`, and Bun answers that
  with its own printing of the function, not the minified source Node gives.
  So 109 of 1186 files (the HTML pages) differ; each page is about 230 bytes
  larger. The `deps` stage would also have to run pnpm's install, with its
  build scripts, on Bun. The gain is about 3 s of a 38 s build. Not worth
  shipping bytes that differ from the desktop build.
- **The desktop shell (Electron, electron-vite, electron-builder).** Electron
  ships its own Node, and the desktop is moving to Tauri (no JS runtime).
- **The Playwright runner.** Playwright supports Node only. It did run the 30
  workspace specs on Bun, in the same time, so there is nothing to gain. It
  drives the browser; the UI under test is what `e2e:workspace:bun` moves.

## Proof of parity

- `pnpm verify` and `pnpm verify:bun`: both exit 0, the same tests pass. A
  test-by-test compare of vitest's JSON reports shows no test that differs.
- The builds: `pnpm compare:export <outA> <outB>`
  (`client/web/scripts/compare-export.mjs`). It replaces each build's random
  build id first; two Node builds are then byte-equal. A Node and a Bun build:
  `server.mjs` byte-equal, the export the same UI (only the theme script
  reprinted). The tool counts a page as reprinted only when the rest of the
  page is byte-equal, exactly one inline script differs, both copies end in
  the next-themes call `)("class","theme",...)` with the same arguments, and
  esbuild prints both to the same code with whitespace and syntax minifying
  only (names kept, `@__PURE__` ignored). `--bytes` makes a reprint fail.
- The workspace specs: 30 of 30 with `next dev` on Node and on Bun.

The Bun lane (`.github/workflows/bun-lane.yml`) runs this on main and on Bun
branches: the runtime check, `verify:bun`, both builds (the Bun one from a
clean tree) with the compare, and the workspace specs. It checks exit codes
and the build compare; the test-by-test compare of vitest's JSON reports was
a one-off, not part of the lane. It is not a required check.

## Numbers

Workstation, 16 cores, in one container with Node 26.13.0, Bun 1.4.4 and pnpm
11.1.2; 3 runs each, median. Install is with a warm store and no
node_modules.

| Job                                       | Node    | Bun      |
| ----------------------------------------- | ------- | -------- |
| `pnpm install` (pnpm for both)            | 3.4 s   | (pnpm)   |
| `bun install`, for the record, not used   |         | 0.7 s    |
| `verify` (typecheck, lint, format, tests) | 37.3 s  | 31.6 s   |
| `test` (vitest, 2681 tests)               | 6.6 s   | 5.5 s    |
| static build (`client/web` and host)      | 38.7 s  | 35.8 s   |
| `next dev` cold start, `/env.js` answers  | 2.4 s   | 0.9 s    |
| `next dev` cold start, first `/login`     | 5.1 s   | 3.4 s    |
| workspace specs (30, `next dev` under it) | 112 s   | 183 s    |

The first `verify` of a fresh copy takes longer on both (61 s and 32 s):
tsc's incremental cache was warm for the runs above.

**`next dev` on Bun is slower in a browser.** It starts faster and renders
each page as fast or faster, but it serves the page's JavaScript about ten
times slower: the 45 files of `/dashboard` (15 MB) take 0.79 s on Bun and
0.08 s on Node. That is Bun's `node:http` under Next's dev server, a known Bun
gap, and it is why the workspace specs take longer on Bun. So `pnpm dev`
stays the one to use day to day.

`member-shell.spec.ts:111` is a known flake on main (fixed apart from this
work). It failed in 2 of 3 Bun runs and 1 of 3 Node runs; with the fix
applied, Bun passed 30 of 30.
