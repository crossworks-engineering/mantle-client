// Compares two static exports of this app (client/web/out), file by file, to
// prove that a build on another runtime (Bun) gives the same UI as the Node
// build. docs/bun-tooling.md says when to run it.
//
//   node scripts/compare-export.mjs <outA> <outB> [--bytes]
//
// Exit 0: the trees are the same UI. Exit 1: a file differs or is missing.
// Exit 2: the compare could not run.
//
// Two builds never match as they come: Next gives each build a random build
// id, in a path (_next/static/<id>/) and inside the pages. So each tree's id is
// read and replaced first. Two Node builds are then byte-equal.
//
// One more difference is known, and it is not a change of the UI: next-themes
// writes its theme script into every page with Function.prototype.toString(),
// and Bun answers that with its own printing of the function (other spacing,
// `a === "class"` for `"class"===a`), not the minified source Node gives. An
// inline script counts as REPRINTED only when esbuild minifies both copies to
// the same code, and only when the rest of the page is byte-equal. --bytes
// counts a reprint as a difference too.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const PLACEHOLDER = '__BUILD_ID__';
const INLINE_SCRIPT = /<script>([\s\S]*?)<\/script>/g;

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

function minified(code) {
  try {
    return transformSync(code, { minify: true, loader: 'js' }).code;
  } catch {
    return null;
  }
}

/**
 * True when two pages differ only in inline scripts that esbuild minifies to
 * the same code. The text between the scripts must be byte-equal.
 */
export function sameAfterReprint(a, b) {
  const partsA = a.split(INLINE_SCRIPT);
  const partsB = b.split(INLINE_SCRIPT);
  if (partsA.length !== partsB.length) return false;
  let reprinted = false;
  for (let i = 0; i < partsA.length; i++) {
    if (partsA[i] === partsB[i]) continue;
    // split() with one capture group puts the captured script bodies at odd indexes.
    if (i % 2 === 0) return false;
    const ma = minified(partsA[i]);
    if (ma === null || ma !== minified(partsB[i])) return false;
    reprinted = true;
  }
  return reprinted;
}

/** Compares two export trees. Paths are reported with the build id replaced. */
export function compareTrees(dirA, dirB) {
  const idA = findBuildId(dirA);
  const idB = findBuildId(dirB);
  const key = (path, id) => (id ? path.split(id).join(PLACEHOLDER) : path);
  const filesA = new Map(listFiles(dirA).map((p) => [key(p, idA), p]));
  const filesB = new Map(listFiles(dirB).map((p) => [key(p, idB), p]));
  const result = { files: 0, equal: 0, reprinted: [], different: [], onlyA: [], onlyB: [] };
  for (const [k, pathA] of filesA) {
    const pathB = filesB.get(k);
    if (pathB === undefined) {
      result.onlyA.push(k);
      continue;
    }
    result.files++;
    const a = normalised(readFileSync(join(dirA, pathA)), idA);
    const b = normalised(readFileSync(join(dirB, pathB)), idB);
    if (a === b) result.equal++;
    else if (k.endsWith('.html') && sameAfterReprint(a, b)) result.reprinted.push(k);
    else result.different.push(k);
  }
  for (const k of filesB.keys()) if (!filesA.has(k)) result.onlyB.push(k);
  return result;
}

function main(argv) {
  const bytes = argv.includes('--bytes');
  const dirs = argv.filter((a) => a !== '--bytes');
  if (dirs.length !== 2) {
    console.error('usage: node scripts/compare-export.mjs <outA> <outB> [--bytes]');
    return 2;
  }
  let r;
  try {
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
  show('reprinted (an inline script printed another way, the same after minify)', r.reprinted);
  show('different', r.different);
  show(`only in ${dirs[0]}`, r.onlyA);
  show(`only in ${dirs[1]}`, r.onlyB);
  const failed =
    r.different.length + r.onlyA.length + r.onlyB.length + (bytes ? r.reprinted.length : 0);
  console.log(failed === 0 ? 'compare-export: the same UI' : 'compare-export: NOT the same');
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
