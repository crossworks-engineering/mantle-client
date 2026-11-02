// Compares two static exports of this app (client/web/out), file by file, to
// prove that a build on another runtime (Bun) gives the same UI as the Node
// build. docs/bun-tooling.md says when to run it.
//
//   node scripts/compare-export.mjs <outA> <outB>
//     [--bytes] [--expect-reprint] [--show-reprints]
//
// outA is the Node build, outB the Bun build: the allowlist below is ordered.
// Exit 0: the trees are the same UI. Exit 1: a file differs or is missing, or
// --expect-reprint found no reprint. Exit 2: the compare could not run.
//
// Two builds never match as they come: Next gives each build a random build
// id, in a path (_next/static/<id>/) and inside the pages. So each tree's id is
// read and replaced first. Two Node builds are then byte-equal.
//
// One more difference is known, and it is not a change of the UI: next-themes
// writes its theme script into every page with Function.prototype.toString(),
// and Bun answers that with its own printing of the function (other spacing,
// `a === "class"` for `"class"===a`), not the minified source Node gives.
// That is allowed for one known pair of script bodies only (REPRINTS below),
// named by sha256, with A the Node build and B the Bun build. A page counts
// as REPRINTED only when all of this holds:
//   - it is an HTML page;
//   - after the build id swap, the page outside its bare inline scripts
//     (`<script>...</script>`, any case) is byte-equal;
//   - exactly one inline script body differs;
//   - neither copy of that body holds `<!--`, `<script` or `</script` in any
//     case, which could change where the browser ends the script;
//   - the A body and the B body hash to a pair in the allowlist.
// --bytes counts a reprint as a difference too. --expect-reprint fails unless
// at least one page was reprinted: only a Bun build gives one, so a "Bun"
// build that ran on Node fails it. --show-reprints prints every differing
// script pair found, pinned or not, so re-pinning is done on purpose.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLACEHOLDER = '__BUILD_ID__';
const INLINE_SCRIPT = /<script>([\s\S]*?)<\/script>/gi;
// Text that could move the end of a script, or hide one: a body that holds it
// is never counted as reprinted.
const UNSAFE_BODY = /<!--|<\/?script/i;

/**
 * The script pairs a reprint may differ by, as sha256 of the A body and of the
 * B body. There is one: the next-themes theme script (next-themes 0.4.6 under
 * Next 16.4.3), as a Node build prints it (A) and as a Bun 1.4.4 build prints
 * it (B). Two Node and Bun build pairs were compared with --show-reprints:
 * each differs on 109 HTML pages, all by this one pair. Both bodies were
 * checked to be the same program, once, by hand: esbuild's full minify prints
 * them to the same code. esbuild is not the rule here, the hashes are.
 * Re-pin when next-themes, Next or .bun-version moves: build both, read both
 * bodies with --show-reprints, check them again, then replace the hashes.
 */
export const REPRINTS = Object.freeze([
  {
    a: '9f8eaf3f0496b8c0b45bbd37a41a1f226bfcd99dbac68e0b5f29afd04f5c68f9',
    b: '6efa21a6632733a6ea7bc80e30319038eb54face88cf8ae3094489f5cb4dcbf5',
  },
]);

/** Every file under `dir`, as sorted paths relative to it with `/` separators. */
export function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

/** The build id of an export: the folder under _next/static that holds _buildManifest.js. */
export function findBuildId(dir) {
  const staticDir = join(dir, '_next', 'static');
  let names;
  try {
    names = readdirSync(staticDir);
  } catch {
    return null;
  }
  const ids = names.filter((n) => {
    try {
      return statSync(join(staticDir, n, '_buildManifest.js')).isFile();
    } catch {
      return false;
    }
  });
  if (ids.length > 1) throw new Error(`${dir}: more than one build id (${ids.join(', ')})`);
  return ids[0] ?? null;
}

/** latin1 keeps every byte, so a binary file survives the id swap unchanged. */
function normalised(buf, id) {
  const text = buf.toString('latin1');
  return id ? text.split(id).join(PLACEHOLDER) : text;
}

/** sha256 of a latin1 text, so of the bytes it was read from. */
function sha256(text) {
  return createHash('sha256').update(text, 'latin1').digest('hex');
}

/**
 * The one script body pair two pages differ by, or null when they differ in
 * any other way: outside the inline scripts, in more than one script, or in a
 * body with markup that could move the end of a script.
 */
export function differingScript(a, b) {
  const partsA = a.split(INLINE_SCRIPT);
  const partsB = b.split(INLINE_SCRIPT);
  if (partsA.length !== partsB.length) return null;
  let pair = null;
  for (let i = 0; i < partsA.length; i++) {
    if (partsA[i] === partsB[i]) continue;
    // split() with one capture group puts the captured script bodies at odd indexes.
    if (i % 2 === 0 || pair !== null) return null;
    if (UNSAFE_BODY.test(partsA[i]) || UNSAFE_BODY.test(partsB[i])) return null;
    pair = { a: partsA[i], b: partsB[i], shaA: sha256(partsA[i]), shaB: sha256(partsB[i]) };
  }
  return pair;
}

const pinned = (pair, allow) => allow.some((p) => p.a === pair.shaA && p.b === pair.shaB);

/** True when two pages differ only by one script pair the allowlist names. */
export function sameAfterReprint(a, b, allow = REPRINTS) {
  const pair = differingScript(a, b);
  return pair !== null && pinned(pair, allow);
}

/** Compares two export trees. Paths are reported with the build id replaced. */
export function compareTrees(dirA, dirB, allow = REPRINTS) {
  const idA = findBuildId(dirA);
  const idB = findBuildId(dirB);
  const key = (path, id) => (id ? path.split(id).join(PLACEHOLDER) : path);
  const filesA = new Map(listFiles(dirA).map((p) => [key(p, idA), p]));
  const filesB = new Map(listFiles(dirB).map((p) => [key(p, idB), p]));
  const result = { files: 0, equal: 0, reprinted: [], different: [], onlyA: [], onlyB: [] };
  // Every differing script pair, pinned or not, for --show-reprints.
  const pairs = new Map();
  for (const [k, pathA] of filesA) {
    const pathB = filesB.get(k);
    if (pathB === undefined) {
      result.onlyA.push(k);
      continue;
    }
    result.files++;
    const a = normalised(readFileSync(join(dirA, pathA)), idA);
    const b = normalised(readFileSync(join(dirB, pathB)), idB);
    if (a === b) {
      result.equal++;
      continue;
    }
    const pair = k.endsWith('.html') ? differingScript(a, b) : null;
    if (pair === null) {
      result.different.push(k);
      continue;
    }
    const ok = pinned(pair, allow);
    const id = `${pair.shaA} ${pair.shaB}`;
    const seen = pairs.get(id);
    if (seen) seen.pages++;
    else pairs.set(id, { ...pair, pinned: ok, pages: 1 });
    (ok ? result.reprinted : result.different).push(k);
  }
  for (const k of filesB.keys()) if (!filesA.has(k)) result.onlyB.push(k);
  return { ...result, pairs: [...pairs.values()] };
}

const FLAGS = ['--bytes', '--expect-reprint', '--show-reprints'];
const USAGE = `usage: node scripts/compare-export.mjs <outA> <outB> [${FLAGS.join('] [')}]`;

function main(argv) {
  const flag = (f) => argv.includes(f);
  const unknown = argv.filter((a) => a.startsWith('--') && !FLAGS.includes(a));
  const dirs = argv.filter((a) => !a.startsWith('--'));
  if (dirs.length !== 2 || unknown.length > 0) {
    console.error(USAGE);
    return 2;
  }
  let r;
  try {
    // One tree against itself is always "the same": a typo, not a proof.
    if (realpathSync(dirs[0]) === realpathSync(dirs[1])) {
      console.error('compare-export: both paths are the same tree');
      return 2;
    }
    r = compareTrees(dirs[0], dirs[1]);
  } catch (err) {
    console.error(`compare-export: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  if (r.files === 0) {
    console.error('compare-export: no file is in both trees');
    return 2;
  }
  const show = (label, list) => {
    if (list.length === 0) return;
    console.log(`${label} (${list.length}):`);
    for (const p of list.slice(0, 20)) console.log(`  ${p}`);
    if (list.length > 20) console.log(`  ... and ${list.length - 20} more`);
  };
  console.log(
    `${r.files} files in both: ${r.equal} byte-equal, ${r.reprinted.length} reprinted, ${r.different.length} different`,
  );
  show('reprinted (a pinned script pair, REPRINTS)', r.reprinted);
  show('different', r.different);
  show(`only in ${dirs[0]}`, r.onlyA);
  show(`only in ${dirs[1]}`, r.onlyB);
  if (flag('--show-reprints')) {
    console.log(`differing script pairs (${r.pairs.length}):`);
    for (const p of r.pairs) {
      console.log(`  ${p.pinned ? 'pinned' : 'NOT pinned'}, on ${p.pages} page(s)`);
      console.log(`  a: ${p.shaA}\n     ${JSON.stringify(p.a.slice(0, 200))}`);
      console.log(`  b: ${p.shaB}\n     ${JSON.stringify(p.b.slice(0, 200))}`);
    }
  }
  let failed =
    r.different.length +
    r.onlyA.length +
    r.onlyB.length +
    (flag('--bytes') ? r.reprinted.length : 0);
  if (flag('--expect-reprint') && r.reprinted.length === 0) {
    console.log(
      'compare-export: no page was reprinted, so B is not a Bun build (--expect-reprint)',
    );
    failed++;
  }
  console.log(failed === 0 ? 'compare-export: the same UI' : 'compare-export: NOT the same');
  return failed === 0 ? 0 : 1;
}

// import.meta.main is the runtime's own answer (Node 26 and Bun both have it).
// Comparing import.meta.url with argv[1] is not: Node resolves symlinks in the
// first and not in the second, so a call through a symlinked path never ran
// and exited 0. The realpath compare covers a runtime without import.meta.main.
// A path that cannot be resolved is not this file.
function calledAsScript() {
  try {
    return (
      process.argv[1] !== undefined &&
      realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}
const isMain = import.meta.main ?? calledAsScript();
if (isMain) process.exitCode = main(process.argv.slice(2));
