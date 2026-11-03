# mantle-client: repo guidance

## Runtime: Bun first

The brain (the mantle repo) runs on Bun on every box since 2026-11-03, and
this repo's box image already serves the static UI on Bun (`Dockerfile`,
final stage; `client/host`). Node stays the fallback only, until the review
on 2026-11-10 (plan: mantle dev-brain page 06966c22).

- New code must work on Bun. Until Node is dropped it must also keep working
  on Node; do not add a path that works on one runtime only.
- The developer tools run on both: `pnpm dev:bun`, `pnpm build:bun`,
  `pnpm test:bun`, `pnpm verify:bun` beside the Node commands
  (`docs/bun-tooling.md`). A change that only passes on Node is not done:
  check it with the `:bun` command too, and the Bun lane
  (`.github/workflows/bun-lane.yml`) on push.
- The Tauri desktop app lives in `client/tauri` (Rust, its own README);
  the Electron app in `client/desktop`.

## Commits

This repo is public. Never add a `Co-Authored-By` or "Generated with" line
to a commit; no client names, host names or IPs in commits or docs.
