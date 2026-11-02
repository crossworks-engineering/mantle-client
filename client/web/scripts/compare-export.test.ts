import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compareTrees, findBuildId, sameAfterReprint } from './compare-export.mjs';

/**
 * scripts/compare-export.mjs proves a Bun build of the export is the same UI
 * as the Node build (docs/bun-tooling.md). These cases pin what it lets
 * through: the random build id and the one theme script printed another way,
 * and nothing else.
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

// The theme script as Node prints it (minified) and as Bun reprints it, with
// the call next-themes appends.
const CALL = '("class","theme","system",null,["light","dark"],null,true,true)';
const NODE_SCRIPT = `((a,b)=>{let c="class"===a;c&&b()})${CALL}`;
const BUN_SCRIPT = `((a, b) => {\n  let c = a === "class";\n  c && b();\n})${CALL}`;
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

  it('never lets a reprint through for a script that is not the theme script', () => {
    const a = '<html><script>((a,b)=>{let c="class"===a;c&&b()})(x)</script></html>';
    const b =
      '<html><script>((a, b) => {\n  let c = a === "class";\n  c && b();\n})(x)</script></html>';
    expect(sameAfterReprint(a, b)).toBe(false);
    // The pure annotation would let esbuild drop the call outright.
    expect(sameAfterReprint('<script>/* @__PURE__ */ track();</script>', '<script></script>')).toBe(
      false,
    );
  });

  it('counts a theme script with other arguments as different', () => {
    const other = BUN_SCRIPT.replace('"system"', '"dark"');
    expect(sameAfterReprint(page(NODE_SCRIPT), page(other))).toBe(false);
  });

  it('keeps a call marked pure in the theme script', () => {
    // No local names, so only the annotation can make these two the same.
    const plain = `(()=>{f()})${CALL}`;
    const tracked = `/* @__PURE__ */ track();(() => {\n  f();\n})${CALL}`;
    expect(sameAfterReprint(page(plain), page(tracked))).toBe(false);
  });

  it('counts a renamed function as different, since its .name can be read', () => {
    const a = `((a,b)=>{function k(){}b(k.name)})${CALL}`;
    const b = `((a, b) => {\n  function q() {}\n  b(q.name);\n})${CALL}`;
    expect(sameAfterReprint(page(a), page(b))).toBe(false);
  });

  it('lets one reprinted theme script per page through, not two', () => {
    const twice = (s: string) => `<html><script>${s}</script><script>${s}</script></html>`;
    expect(sameAfterReprint(twice(NODE_SCRIPT), twice(BUN_SCRIPT))).toBe(false);
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

  describe('as a command', () => {
    const script = join(__dirname, 'compare-export.mjs');
    const run = (path: string, args: string[]) => {
      try {
        const out = execFileSync(process.execPath, [path, ...args], {
          encoding: 'utf8',
          stdio: 'pipe',
        });
        return { status: 0, out };
      } catch (err) {
        const e = err as { status: number; stdout: string };
        return { status: e.status, out: e.stdout };
      }
    };
    const trees = (): [string, string] => [
      tree('idA', { 'index.html': page(NODE_SCRIPT) }),
      tree('idB', { 'index.html': page(BUN_SCRIPT) }),
    ];

    // The verdict line is asserted too: a script that never ran also exits 0.
    it('exits 1 on a reprint with --bytes, 0 without, 2 on bad use', () => {
      const [a, b] = trees();
      const same = run(script, [a, b]);
      expect(same.status).toBe(0);
      expect(same.out).toContain('compare-export: the same UI');
      const bytes = run(script, [a, b, '--bytes']);
      expect(bytes.status).toBe(1);
      expect(bytes.out).toContain('compare-export: NOT the same');
      expect(run(script, [a]).status).toBe(2);
    });

    it('runs when it is called through a symlinked path', () => {
      const [a, b] = trees();
      const link = join(tree('link', {}), 'compare-export.mjs');
      symlinkSync(script, link);
      const r = run(link, [a, b]);
      expect(r.status).toBe(0);
      expect(r.out).toContain('compare-export: the same UI');
    });
  });
});
