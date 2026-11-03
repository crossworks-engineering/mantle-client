#!/usr/bin/env bash
# The release build of the Tauri shell: the owner UI's static export is
# embedded at compile time, so it must exist first.
#
# On macOS it builds the app bundle (target/release/bundle/macos/MantleOS.app):
# macOS takes the app's name in the menu bar and its icon in the Dock from
# the bundle, never from a bare binary. Unsigned, no installer. On Linux it
# builds the binary alone (target/release/mantle-desktop).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export_dir="$here/../web/out"
tauri_cli="2.12.4"

if [ ! -f "$export_dir/_mantle/routes.json" ] || [ ! -f "$export_dir/_mantle/csp.txt" ]; then
  echo "The owner UI export is missing ($export_dir)." >&2
  echo "Build it first: pnpm -C client/web build" >&2
  exit 1
fi

cd "$here"

if [ "$(uname -s)" != "Darwin" ]; then
  exec cargo build --release --features custom-protocol
fi

if [ "$(cargo tauri --version 2>/dev/null)" != "tauri-cli $tauri_cli" ]; then
  echo "The macOS build needs tauri-cli $tauri_cli." >&2
  echo "Install it: cargo install tauri-cli --version '=$tauri_cli' --locked" >&2
  exit 1
fi
exec cargo tauri build --bundles app --no-sign --features custom-protocol
