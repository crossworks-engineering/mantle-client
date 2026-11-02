import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPRINTS, compareTrees, findBuildId, sameAfterReprint } from './compare-export.mjs';

/**
 * scripts/compare-export.mjs proves a Bun build of the export is the same UI
 * as the Node build (docs/bun-tooling.md). These cases pin what it lets
 * through: the random build id, and on an HTML page one inline script whose
 * Node and Bun bodies are a pair its allowlist names by sha256, with the rest
 * of the page byte-equal. The allowlist holds the one real pair, the
 * next-themes theme script; most cases pass a small allowlist of their own.
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

const sha = (s: string) => createHash('sha256').update(s, 'latin1').digest('hex');
const allow = (...pairs: [string, string][]) => pairs.map(([a, b]) => ({ a: sha(a), b: sha(b) }));

// A small script pair, printed the Node way (A) and the Bun way (B).
const NODE_SCRIPT = `((a,b)=>{let c="class"===a;c&&b()})("class",f)`;
const BUN_SCRIPT = `((a, b) => {\n  let c = a === "class";\n  c && b();\n})("class",f)`;
const PINNED = allow([NODE_SCRIPT, BUN_SCRIPT]);
const page = (script: string, text = 'hello') =>
  `<html><script>${script}</script><p>${text}</p><script>self.b="<id>"</script></html>`;

// The real theme script of a Node build and of a Bun build (the pinned pair).
const REAL_A =
  '((a,b,c,d,e,f,g,h)=>{let i=document.documentElement,j=["light","dark"];function k(b){var c;(Array.isArray(a)?a:[a]).forEach(a=>{let c="class"===a,d=c&&f?e.map(a=>f[a]||a):e;c?(i.classList.remove(...d),i.classList.add(f&&f[b]?f[b]:b)):i.setAttribute(a,b)}),c=b,h&&j.includes(c)&&(i.style.colorScheme=c)}if(d)k(d);else try{let a=localStorage.getItem(b)||c,d=g&&"system"===a?window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light":a;k(d)}catch(a){}})("class","theme","system",null,["light","dark"],null,true,true)';
const REAL_B =
  '((a, b, c, d, e, f, g, h) => {\n      let i = document.documentElement, j = ["light", "dark"];\n      function k(b) {\n        var c;\n        (Array.isArray(a) ? a : [a]).forEach((a) => {\n          let c = a === "class", d = c && f ? e.map((a) => f[a] || a) : e;\n          c ? (i.classList.remove(...d), i.classList.add(f && f[b] ? f[b] : b)) : i.setAttribute(a, b);\n        }), c = b, h && j.includes(c) && (i.style.colorScheme = c);\n      }\n      if (d)\n        k(d);\n      else\n        try {\n          let a = localStorage.getItem(b) || c, d = g && a === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light" : a;\n          k(d);\n        } catch (a) {}\n    })("class","theme","system",null,["light","dark"],null,true,true)';

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

  it('holds exactly the one real pair in its default allowlist', () => {
    expect(REPRINTS).toEqual([
      {
        a: '9f8eaf3f0496b8c0b45bbd37a41a1f226bfcd99dbac68e0b5f29afd04f5c68f9',
        b: '6efa21a6632733a6ea7bc80e30319038eb54face88cf8ae3094489f5cb4dcbf5',
      },
    ]);
    expect(allow([REAL_A, REAL_B])).toEqual(REPRINTS);
  });

  it('counts the real theme script pair as reprinted, and only from A to B', () => {
    const r = compareTrees(
      tree('idA', { 'index.html': page(REAL_A) }),
      tree('idB', { 'index.html': page(REAL_B) }),
    );
    expect(r.reprinted).toEqual(['index.html']);
    expect(r.different).toEqual([]);
    expect(sameAfterReprint(page(REAL_B), page(REAL_A))).toBe(false);
  });

  it('counts a pinned pair as reprinted, not equal and not different', () => {
    const r = compareTrees(
      tree('idA', { 'index.html': page(NODE_SCRIPT) }),
      tree('idB', { 'index.html': page(BUN_SCRIPT) }),
      PINNED,
    );
    expect(r.reprinted).toEqual(['index.html']);
    expect(r.different).toEqual([]);
    expect(r.pairs).toMatchObject([{ shaA: sha(NODE_SCRIPT), pinned: true, pages: 1 }]);
  });

  it('counts a pair the allowlist does not name as different, and still reports it', () => {
    const r = compareTrees(
      tree('idA', { 'index.html': page(NODE_SCRIPT) }),
      tree('idB', { 'index.html': page(BUN_SCRIPT) }),
    );
    expect(r.different).toEqual(['index.html']);
    expect(r.pairs).toMatchObject([{ shaB: sha(BUN_SCRIPT), pinned: false }]);
  });

  it('splits scripts in any case', () => {
    const upper = (s: string) => `<html><SCRIPT>${s}</SCRIPT><p>x</p></html>`;
    expect(sameAfterReprint(upper(NODE_SCRIPT), upper(BUN_SCRIPT), PINNED)).toBe(true);
  });

  it('counts a changed page around a pinned pair as different', () => {
    expect(sameAfterReprint(page(NODE_SCRIPT), page(BUN_SCRIPT, 'other'), PINNED)).toBe(false);
  });

  it('lets one reprinted script per page through, not two', () => {
    const twice = (s: string) => `<html><script>${s}</script><script>${s}</script></html>`;
    expect(sameAfterReprint(twice(NODE_SCRIPT), twice(BUN_SCRIPT), PINNED)).toBe(false);
    expect(sameAfterReprint(twice(REAL_A), twice(REAL_B))).toBe(false);
  });

  // Each of these beat an earlier rule. A hash names only the body it was
  // taken from, so markup that could move the end of a script is refused even
  // when the case pins its own bodies.
  describe('refuses markup that could end a script early, even when pinned', () => {
    const cases: [string, string, string][] = [
      ['a close tag in capitals', 'f()', 'f()/*</SCRIPT><h1>x</h1><script>*/'],
      ['a close tag with a space', 'f()', 'f()/*</script ><h1>x</h1>*/'],
      ['a comment that opens a script', 'f()', '<!--<script>f()'],
    ];
    for (const [name, a, b] of cases) {
      it(name, () => {
        expect(sameAfterReprint(page(a), page(b), allow([a, b]))).toBe(false);
      });
    }
  });

  // A program that prints the same after some canonical step is not enough:
  // only the pinned pair is let through.
  describe('counts as different a pair the allowlist does not name', () => {
    const cases: [string, string, string][] = [
      [
        'a named and an anonymous function',
        'let g=function(){};h(g.name)',
        'let g = function k() {};\nh(g.name);',
      ],
      [
        'a function read as a string',
        'h(String(function(){return 1+1}))',
        'h(String(function () {\n  return 2;\n}))',
      ],
      ['a call marked pure', '/* @__PURE__ */ track();', ''],
    ];
    for (const [name, a, b] of cases) {
      it(name, () => {
        expect(sameAfterReprint(page(a), page(b))).toBe(false);
        expect(sameAfterReprint(page(a), page(b), PINNED)).toBe(false);
      });
    }
  });

  it('never lets a reprint through outside an HTML page', () => {
    const r = compareTrees(
      tree('idA', { 'a.txt': page(NODE_SCRIPT) }),
      tree('idB', { 'a.txt': page(BUN_SCRIPT) }),
      PINNED,
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
    // A Node tree and a Bun tree, as the real builds differ.
    const trees = (): [string, string] => [
      tree('idA', { 'index.html': page(REAL_A) }),
      tree('idB', { 'index.html': page(REAL_B) }),
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
      expect(run(script, [a, b, '--byte']).status).toBe(2);
      // One tree against itself proves nothing.
      expect(run(script, [a, a]).status).toBe(2);
    });

    it('with --expect-reprint exits 0 on a Bun tree and 1 on two Node trees', () => {
      const [a, b] = trees();
      expect(run(script, [a, b, '--expect-reprint']).status).toBe(0);
      const node = tree('idC', { 'index.html': page(REAL_A) });
      expect(run(script, [a, node]).status).toBe(0);
      const twoNode = run(script, [a, node, '--expect-reprint']);
      expect(twoNode.status).toBe(1);
      expect(twoNode.out).toContain('no page was reprinted');
    });

    it('with --show-reprints prints each pair, its hashes and its start', () => {
      const [a, b] = trees();
      const r = run(script, [a, b, '--show-reprints']);
      expect(r.status).toBe(0);
      expect(r.out).toContain('differing script pairs (1):');
      expect(r.out).toContain('pinned, on 1 page(s)');
      expect(r.out).toContain(`a: ${sha(REAL_A)}`);
      expect(r.out).toContain(`b: ${sha(REAL_B)}`);
      expect(r.out).toContain(JSON.stringify(REAL_B.slice(0, 200)));
      const unpinned = run(script, [
        tree('idA', { 'index.html': page(NODE_SCRIPT) }),
        tree('idB', { 'index.html': page(BUN_SCRIPT) }),
        '--show-reprints',
      ]);
      expect(unpinned.status).toBe(1);
      expect(unpinned.out).toContain(`NOT pinned, on 1 page(s)`);
      expect(unpinned.out).toContain(`a: ${sha(NODE_SCRIPT)}`);
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
