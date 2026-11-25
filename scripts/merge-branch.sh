#!/usr/bin/env bash
set -euo pipefail
#
# merge-branch.sh — land a finished feature branch on main: ff-only merge, then
# the version bump AS PART OF THE MERGE, on main, in the integrator clone.
# Ported from the mantle repo's script of the same name; same contract.
#
# Why: bumping on the feature branch makes every concurrent session edit the
# same version lines, so two sessions in flight means a guaranteed conflict at
# whichever rebase happens second. Merges into main are already serialized
# through the integrator — only it has main checked out — so a bump done HERE,
# as its own `release:` commit right after the merge, cannot race another
# session's. Feature branches never touch version fields at all; see the guard
# in bump-version.mjs.
#
# Usage:
#   scripts/merge-branch.sh <branch> [patch|minor|major]
#     branch  the finished feature branch (e.g. feat/neat-dedup)
#     bump    version part to bump on main after the merge (default: patch)
#
# Runs from anywhere in the repo (a worktree included) — it resolves the
# integrator clone from the shared git dir and operates there. No tag, no push:
# pushing a v* tag cuts a release (release.yml), and pushes stay
# explicit.
#
branch="${1:-}"
kind="${2:-patch}"
if [ -z "$branch" ]; then
  echo "usage: scripts/merge-branch.sh <branch> [patch|minor|major]" >&2
  exit 1
fi
case "$kind" in
  patch|minor|major) ;;
  *) echo "✗ bump must be patch, minor or major (got \"$kind\")" >&2; exit 1 ;;
esac

# The integrator clone (NOT the current worktree) — same resolution as
# new-worktree.sh, so this works from inside a worktree too.
common="$(git rev-parse --git-common-dir)"
case "$common" in /*) ;; *) common="$(pwd)/$common" ;; esac
repo="$(cd "$(dirname "$common")" && pwd)"
cd "$repo"

if ! git show-ref --verify --quiet "refs/heads/$branch"; then
  echo "✗ branch $branch does not exist" >&2
  exit 1
fi
current="$(git rev-parse --abbrev-ref HEAD)"
if [ "$current" != "main" ]; then
  echo "✗ the integrator clone is on \"$current\", not main — put it back first" >&2
  exit 1
fi
# Tracked changes block the merge; untracked files are fine (the integrator
# often carries local scratch).
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "✗ the integrator clone has uncommitted changes — commit or stash them first" >&2
  exit 1
fi

# Advisory lock: makes the serialization explicit if two sessions land at the
# exact same moment — the second one gets a clear message instead of a git
# index race. mkdir is atomic; a crashed run leaves the dir, so the message
# says how to clear it.
lock="$common/jackdaw-merge-branch.lock"
if ! mkdir "$lock" 2>/dev/null; then
  echo "✗ another merge-branch.sh appears to be running (lock: $lock)" >&2
  echo "  if you're sure it isn't, remove the dir: rmdir '$lock'" >&2
  exit 1
fi
trap 'rmdir "$lock" 2>/dev/null || true' EXIT

echo "→ git merge --ff-only $branch"
if ! git merge --ff-only "$branch"; then
  cat >&2 <<EOF
✗ not a fast-forward — main moved since $branch forked.
  Rebase in the branch's own worktree, then run this again:
    git rebase main      # from the worktree that has $branch checked out
    scripts/merge-branch.sh $branch $kind
EOF
  exit 1
fi

echo "→ version bump ($kind) on main"
node scripts/bump-version.mjs "$kind"
next="$(node -p "require('./package.json').version")"
git add package.json client/web/package.json
git commit -m "release: v$next"

cat <<EOF

✓ $branch merged, main is at v$next
    scripts/rm-worktree.sh ${branch##*/}   # tear the worktree down when done
    git branch -d $branch                  # then delete the branch
  To cut the release (pushing a v* tag is what triggers it):
    scripts/tag-release.sh                 # asserts HEAD == the v$next release
                                           # commit, then tags + pushes
  Never chain this script with a tag by hand — a failed merge with the tag
  still running is how a stale tree ships (see the mantle repo's v0.232.59).
EOF
