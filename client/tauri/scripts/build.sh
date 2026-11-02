#!/usr/bin/env bash
# The release build of the Tauri shell: the owner UI's static export is
# embedded at compile time, so it must exist first.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export_dir="$here/../web/out"

if [ ! -f "$export_dir/_mantle/routes.json" ] || [ ! -f "$export_dir/_mantle/csp.txt" ]; then
  echo "The owner UI export is missing ($export_dir)." >&2
  echo "Build it first: pnpm -C client/web build" >&2
  exit 1
fi

cd "$here"
exec cargo build --release --features custom-protocol
