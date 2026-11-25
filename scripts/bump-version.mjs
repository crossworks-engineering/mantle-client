#!/usr/bin/env node
// Bump the Jackdaw app version. The root package.json `version` is the single
// source of truth; client/web/package.json is kept in lockstep so they
// never drift.
//
// Usage:
//   pnpm version:bump patch          # 0.6.19 -> 0.6.20
//   pnpm version:bump minor          # 0.6.19 -> 0.7.0
//   pnpm version:bump major          # 0.6.19 -> 1.0.0
//   pnpm version:bump 0.7.0-alpha    # set explicitly (pre-release tag allowed)
//
// Then commit, and tag with scripts/tag-release.sh (it asserts the release
// commit before tagging — never `git tag` by hand chained onto a merge).
//
// GUARD: refuses to run on any branch other than main (--force overrides).
// Bumping on a feature branch makes every concurrent worktree edit the same
// version lines — guaranteed conflicts whenever two sessions are in flight.
// The bump happens ON MAIN as part of the merge (scripts/merge-branch.sh),
// where merges are serialized by construction. Same contract as the mantle
// repo's bump-version.mjs.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const targets = ['package.json', 'client/web/package.json'].map((p) => join(root, p));

const args = process.argv.slice(2);
const force = args.includes('--force');
const arg = args.find((a) => !a.startsWith('--'));
if (!arg) {
  console.error('usage: pnpm version:bump <patch|minor|major|x.y.z> [--force]');
  process.exit(1);
}

// Main-only guard (see header). A detached HEAD (CI checkout) and a missing
// git are both allowed through — the guard targets exactly one mistake:
// bumping on a feature branch in a worktree.
let branch = null;
try {
  branch = execSync('git rev-parse --abbrev-ref HEAD', {
    cwd: root,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .toString()
    .trim();
} catch {
  /* no git / not a repo — nothing to guard */
}
if (!force && branch && branch !== 'main' && branch !== 'HEAD') {
  console.error(`✗ refusing to bump on branch "${branch}" — versions bump on main only.`);
  console.error('  Land the branch with scripts/merge-branch.sh (it bumps as part of the');
  console.error('  merge, where merges are serialized). Override with --force if you must.');
  process.exit(1);
}

const current = JSON.parse(readFileSync(targets[0], 'utf8')).version;

function bump(v, kind) {
  // Operate on the numeric core; any `-prerelease` tag is dropped (standard
  // semver behaviour — re-add it explicitly if you want to keep it).
  const [maj, min, pat] = v.replace(/-.*/, '').split('.').map(Number);
  if (kind === 'major') return `${maj + 1}.0.0`;
  if (kind === 'minor') return `${maj}.${min + 1}.0`;
  if (kind === 'patch') return `${maj}.${min}.${pat + 1}`;
  throw new Error(`unknown bump type "${kind}" — use patch | minor | major | x.y.z[-tag]`);
}

// Accept an explicit semver with an optional pre-release tag.
const next = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(arg) ? arg : bump(current, arg);

for (const file of targets) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  json.version = next;
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
}

console.log(`✔ ${current} → ${next}  (updated ${targets.length} package.json files)`);
console.log(`  Next:  git commit -am "release: v${next}"`);
console.log('         scripts/tag-release.sh   (asserts the release commit, then tags + pushes)');
