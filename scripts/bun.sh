#!/usr/bin/env bash
set -euo pipefail
#
# bun.sh: run a package script (or a package's bin) on the Bun runtime, on the
# pinned Bun only. The `:bun` scripts in package.json go through here.
#
#   scripts/bun.sh verify                    a root script on Bun
#   scripts/bun.sh --cwd client/web dev      a script of one workspace
#
# `bun run --bun` puts a `node` that is Bun first on PATH for the script and
# for every process it starts, so the nested `pnpm -r`, tsc, eslint, vitest
# and next all run on Bun too. pnpm stays the package manager: install with
# `pnpm install` as always (docs/bun-tooling.md says why).
#
# The version is checked first. A different Bun can pass or fail for reasons
# of its own, and the Node and Bun results are only comparable on the one
# version .bun-version names (also the box image's, Dockerfile).
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
want="$(tr -d '[:space:]' < "$root/.bun-version")"
if ! command -v bun >/dev/null 2>&1; then
  echo "bun.sh: bun $want is not on PATH (docs/bun-tooling.md)" >&2
  exit 127
fi
have="$(bun --version)"
if [ "$have" != "$want" ]; then
  echo "bun.sh: bun $have found, but .bun-version pins $want" >&2
  exit 1
fi
exec bun run --bun "$@"
