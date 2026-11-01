#!/usr/bin/env bash
set -euo pipefail
#
# build-ui.sh — build client/web as static files and stage them into
# client/desktop/ui/ for the Electron shell to serve (src/main/static-host.ts,
# contract in docs/static-ui-host.md).
#
# The export is plain files (no node_modules, no links), so a plain recursive
# copy does it, and node does the copy so the same command works in Git Bash on
# Windows. Every path handed to node is RELATIVE to the repo root: Git Bash
# reports absolute paths POSIX-style (/d/a/…), which node on Windows reads as
# drive-relative.

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # resolved BEFORE any cd below
root="$(cd "$here/../../.." && pwd)"

echo "→ next build (static export) in client/web"
cd "$root/client/web"
pnpm build

echo "→ staging into client/desktop/ui"
cd "$root"
node -e "
const fs = require('fs');
const [src, dest] = process.argv.slice(1);
for (const need of ['_mantle/routes.json', '_mantle/csp.txt', '_mantle/boot.js', 'index.html']) {
  if (!fs.existsSync(src + '/' + need)) { console.error('✗ ' + src + '/' + need + ' missing'); process.exit(1); }
}
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
" "client/web/out" "client/desktop/ui"

echo "✓ static UI staged ($(du -sh "$root/client/desktop/ui" | cut -f1))"
