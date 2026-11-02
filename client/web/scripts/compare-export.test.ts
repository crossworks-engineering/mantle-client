import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compareTrees, findBuildId, sameAfterReprint } from './compare-export.mjs';

/**
 * scripts/compare-export.mjs proves a Bun build of the export is the same UI
 * as the Node build (docs/bun-tooling.md). These cases pin what it lets
 * through: the random build id and an inline script printed another way, and
 * nothing else.
 */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tree(id: string, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'compare-export-'));
  dirs.push(root);
  const all = { [`_next/static/${id}/_buildManifest.js`]: `self.__BUILD_MANIFEST={}`, ...files };
  for (const [p, body] of Object.entries(all)) {
    const file = join(root, p.split('<id>').join(id));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body.split('<id>').join(id));
  }
  return root;
}

// The theme script as Node prints it (minified) and as Bun reprints it.
const NODE_SCRIPT = '((a,b)=>{let c="class"===a;c&&b()})("class",x)';
const BUN_SCRIPT = '((a, b) => {\n  let c = a === "class";\n  c && b();\n})("class",x)';
const page = (script: string, text = 'hello') =>
  `<html><script>${script}</script><p>${text}</p><script>self.b="<id>"</script></html>`;

describe('compare-export', () => {
  it('reads the build id from the folder that holds _buildManifest.js', () => {
    expect(findBuildId(tree('AbC123', {}))).toBe('AbC123');
  });

  it('counts two trees as equal when only the build id differs', () => {
    const a = tree('idA', { 'index.html': page(NODE_SCRIPT), '_next/static/<id>/x.js': '"<id>"' });
    const b = tree('idB', { 'index.html': page(NODE_SCRIPT), '_next/static/<id>/x.js': '"<id>"' });
    const r = compareTrees(a, b);
    expect(r).toMatchObject({ different: [], reprinted: [], onlyA: [], onlyB: [] });
    expect(r.equal).toBe(r.files);
  });

  it('counts a reprinted inline script as reprinted, not equal and not different', () => {
    const r = compareTrees(
      tree('idA', { 'index.html': page(NODE_SCRIPT) }),
      tree('idB', { 'index.html': page(BUN_SCRIPT) }),
    );
    expect(r.reprinted).toEqual(['index.html']);
    expect(r.different).toEqual([]);
  });

  it('counts a changed script as different', () => {
    const changed = BUN_SCRIPT.replace('"class"', '"klass"');
    expect(sameAfterReprint(page(NODE_SCRIPT), page(changed))).toBe(false);
  });

  it('counts a changed page around an equal script as different', () => {
    expect(sameAfterReprint(page(NODE_SCRIPT), page(BUN_SCRIPT, 'other'))).toBe(false);
  });

  it('never lets a reprint through outside an HTML page', () => {
    const r = compareTrees(
      tree('idA', { 'a.txt': page(NODE_SCRIPT) }),
      tree('idB', { 'a.txt': page(BUN_SCRIPT) }),
    );
    expect(r.different).toEqual(['a.txt']);
  });

  it('names a file that only one tree has', () => {
    const r = compareTrees(tree('idA', { 'x.html': 'x' }), tree('idB', { 'y.html': 'y' }));
    expect(r.onlyA).toEqual(['x.html']);
    expect(r.onlyB).toEqual(['y.html']);
  });

  it('exits 1 on a reprint with --bytes, 0 without, 2 on bad use', () => {
    const script = join(__dirname, 'compare-export.mjs');
    const a = tree('idA', { 'index.html': page(NODE_SCRIPT) });
    const b = tree('idB', { 'index.html': page(BUN_SCRIPT) });
    const run = (args: string[]) => {
      try {
        execFileSync(process.execPath, [script, ...args], { stdio: 'pipe' });
        return 0;
      } catch (err) {
        return (err as { status: number }).status;
      }
    };
    expect(run([a, b])).toBe(0);
    expect(run([a, b, '--bytes'])).toBe(1);
    expect(run([a])).toBe(2);
  });
});
