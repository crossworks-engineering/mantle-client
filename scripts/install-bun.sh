#!/usr/bin/env bash
set -euo pipefail
#
# install-bun.sh <dir>: put the pinned Bun (.bun-version) into <dir>/bun, for
# Linux x64 (CI and the workstations). It downloads the official release zip
# and refuses it unless its sha256 is the one below. No install script runs.
#
# The hash is from the release's SHASUMS256.txt, and the zip was checked to
# unpack to the same binary as the oven/bun image of that version (the box
# image's base). Move PINNED together with .bun-version:
# scripts/bun-version.test.ts fails while they name different versions.
PINNED="1.4.4 bf8ccbfb2b0b80159e0f9a6d15c55317add8077534dbc6130a3edb52fccb395c"

dest="${1:?usage: scripts/install-bun.sh <dir>}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
want="$(tr -d '[:space:]' < "$root/.bun-version")"
version="${PINNED%% *}"
sha="${PINNED##* }"
if [ "$version" != "$want" ]; then
  echo "install-bun.sh: the pinned hash is for $version, but .bun-version says $want" >&2
  exit 1
fi
if [ "$(uname -s)-$(uname -m)" != "Linux-x86_64" ]; then
  echo "install-bun.sh: only Linux x64 is pinned here; install bun $want another way" >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --max-time 300 -o "$tmp/bun.zip" \
  "https://github.com/oven-sh/bun/releases/download/bun-v$version/bun-linux-x64.zip"
if ! echo "$sha  $tmp/bun.zip" | sha256sum -c - >/dev/null 2>&1; then
  echo "install-bun.sh: checksum mismatch for bun-linux-x64.zip (bun $version), not installed" >&2
  exit 1
fi
unzip -q "$tmp/bun.zip" -d "$tmp"
mkdir -p "$dest"
install -m 0755 "$tmp/bun-linux-x64/bun" "$dest/bun"
echo "install-bun.sh: bun $("$dest/bun" --version) in $dest"
