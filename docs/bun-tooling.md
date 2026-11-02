# Bun for the developer tools

The developer tools run on Node by default, and on Bun beside it. Node stays
the default and the required gate (`pnpm verify`, `verify.yml`). The Bun path
gives the same results, checked test by test and file by file. It is faster
for tests, builds and the dev server's start, and slower for pages in a
browser under `next dev` (numbers below).

The box image already runs on Bun (`Dockerfile`, final stage). This page is
about the tools only.

## Commands

| Node (default)                                            | Bun                      | What                                        |
| --------------------------------------------------------- | ------------------------ | ------------------------------------------- |
| `pnpm install`                                            | (the same)               | pnpm installs for both. See below why.      |
| `pnpm dev`                                                | `pnpm dev:bun`           | `next dev` (slower pages on Bun, see below) |
| `pnpm -C client/web build`<br>`pnpm -C client/host build` | `pnpm build:bun`         | the static export and the host bundle       |
| `pnpm test`                                               | `pnpm test:bun`          | vitest                                      |
| `pnpm verify`                                             | `pnpm verify:bun`        | typecheck, lint, format check, vitest       |
| `pnpm e2e:workspace`                                      | `pnpm e2e:workspace:bun` | the workspace specs, `next dev` on Bun      |

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

Each run checks it too: `scripts/bun.sh` sets `MANTLE_EXPECT_RUNTIME=bun`,
and then these fail unless they run on the pinned Bun:
`vitest.config.ts` (vitest, for `verify:bun` and `test:bun`, with or without
a file filter), `scripts/bun-runtime.test.ts` (also the `node` on PATH),
`client/web/next.config.ts` (`next dev` and `next build`, for
`dev:bun`, `build:bun` and `e2e:workspace:bun`) and
`client/host/scripts/build.mjs` (`build:bun`). Other tools a script starts are
not checked one by one; the Bun lane checks the `node` that a nested pnpm
finds. Only the exact value `bun` asks for a check. A plain `pnpm verify`, a
Node build and the image build do not set the variable, and then nothing is
checked.

Bun loads `.env` files and installs missing packages on its own when it runs
a file directly. Neither happens here, checked on 1.4.4: the scripts that
`bun run` starts saw no `.env` value, and with `node_modules` in place a
missing package is an error, not an install. `scripts/bun.sh` refuses to run
when the root `node_modules` is missing. A root `bunfig.toml` would not
help: Bun reads it from the working directory only, and most `:bun` scripts
run in `client/web`.

Install Bun: `scripts/install-bun.sh <dir>` on Linux x64. It checks a pinned
sha256. Only Linux x64 is pinned here; on another machine, install that exact
version yourself (`bun.sh` refuses any other).

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
- The builds: `pnpm compare:export <node-out> <bun-out>`
  (`client/web/scripts/compare-export.mjs`). It replaces each build's random
  build id first; two Node builds are then byte-equal. A Node and a Bun build:
  `server.mjs` byte-equal, the export the same UI (only the theme script
  reprinted). The tool counts a page as reprinted only when it is an HTML
  page, the page outside its bare inline scripts (`<script>`, any case) is
  byte-equal, exactly one inline script body differs, neither copy holds
  `<!--`, `<script` or `</script` (any case), and the Node body and the Bun
  body hash (sha256) to a pair the tool pins. It pins one pair, the
  next-themes theme script, the only pair on the 109 pages; esbuild's full
  minify prints both bodies to the same code, checked once by hand when it
  was pinned. The hashes are the rule, not esbuild. When next-themes, Next or
  `.bun-version` moves, the pair can change and the compare then fails: build
  both, read the pair with `--show-reprints`, check it, and pin the new
  hashes. `--bytes` makes a reprint fail;
  `--expect-reprint` fails unless a page was reprinted, which only a Bun build
  gives.
- The workspace specs: 30 of 30 with `next dev` on Node and on Bun.

The Bun lane (`.github/workflows/bun-lane.yml`) runs this on main and on Bun
branches: the runtime check, `verify:bun`, both builds (the Bun one from a
clean tree) with both compares (`--expect-reprint`), and the workspace specs.
It checks exit codes and the build compares; the test-by-test compare of
vitest's JSON reports was a one-off, not part of the lane. It is not a
required check.

## Numbers

Workstation, 16 cores, in one container with Node 26.13.0, Bun 1.4.4 and pnpm
11.1.2; 3 runs each, median. Install is with a warm store and no
node_modules.

| Job                                       | Node   | Bun    |
| ----------------------------------------- | ------ | ------ |
| `pnpm install` (pnpm for both)            | 3.4 s  | (pnpm) |
| `bun install`, for the record, not used   |        | 0.7 s  |
| `verify` (typecheck, lint, format, tests) | 37.3 s | 31.6 s |
| `test` (vitest, 2681 tests)               | 6.6 s  | 5.5 s  |
| static build (`client/web` and host)      | 38.7 s | 35.8 s |
| `next dev` cold start, `/env.js` answers  | 2.4 s  | 0.9 s  |
| `next dev` cold start, first `/login`     | 5.1 s  | 3.4 s  |
| workspace specs (30, `next dev` under it) | 112 s  | 183 s  |

The first `verify` of a fresh copy takes longer on both (61 s and 32 s):
tsc's incremental cache was warm for the runs above.

**`next dev` on Bun is slower in a browser.** It starts faster and renders
each page as fast or faster. But every request waits about 10 ms for its
first byte on Bun, and about 1 ms on Node, whatever the file (a 1.2 MB chunk
or `favicon.ico`). The 45 files of `/dashboard` (15 MB) then take 0.79 s on
Bun and 0.08 s on Node, and the workspace specs take longer. So `pnpm dev`
stays the one to use day to day.

The wait is inside Next's dev server when it runs on Bun, not in Bun's
`node:http`. On the same workstation:

| Test                                                          | Node  | Bun   |
| ------------------------------------------------------------- | ----- | ----- |
| A plain `node:http` server sends one 15 MB file               | 4 ms  | 5 ms  |
| The same, as a file stream                                    | 15 ms | 15 ms |
| The box host (`client/host`), all `/dashboard` files (2.3 MB) | 50 ms | 50 ms |
| `next dev`, first byte of any file                            | 1 ms  | 10 ms |

Timers, `fs` calls and small HTTP requests are as fast on Bun as on Node. The
exact cause inside Next's dev path is not found. The box host, which runs on
Bun in the client image, is not affected.

`member-shell.spec.ts:111` is a known flake on main (fixed apart from this
work). It failed in 5 of 7 Bun runs and 1 of 7 Node runs; with the fix
applied, both passed 30 of 30.

In `e2e:workspace:bun`, a check waits up to 15 s (Playwright's `expect`), not
5 s. The first visit to a route makes `next dev` compile it, and on a 4-CPU
machine such as a GitHub runner that can take more than 5 s. It does on Node
too: at 4 CPUs on the workstation, `admin-shell.spec.ts:30` failed on Node
and on Bun, and the Node `e2e-workspace` job on main failed 4 times in 14
runs. Bun's extra 10 ms per request makes it more likely. The Node lane keeps
the 5 s default.
