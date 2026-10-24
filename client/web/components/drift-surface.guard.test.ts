import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LoginCredit } from '@/app/login/login-credit';

/**
 * The two Drift looks (owner decision 2026-10-24), pinned where the node test
 * runner cannot render the screens. Inside the app the background holds the
 * legibility floor ('app'); the sign-in and invite screens paint the spec's
 * full colour ('public'), which is safe only because they keep every word on
 * an opaque card. The brain's share-ui drift.test.ts measures the two looks;
 * this file pins who asks for which, and the public screens' half of the rule.
 */
const here = fileURLToPath(new URL('.', import.meta.url));
const web = join(here, '..');
const src = (rel: string) => readFileSync(join(web, rel), 'utf8');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

const PUBLIC = ['app/login/page.tsx', 'app/invite/page.tsx'];

describe('every Drift backdrop names its surface', () => {
  const uses = [...sources(join(web, 'app')), ...sources(join(web, 'components'))].flatMap(
    (path) => {
      const rel = relative(web, path).split(sep).join('/');
      const text = readFileSync(path, 'utf8');
      return [...text.matchAll(/<DriftThemeBackdrop\b[^>]*>/g)].map((m) => ({ rel, tag: m[0] }));
    },
  );

  it('finds the known callers', () => {
    expect(uses.map((u) => u.rel).sort()).toEqual(
      [
        'app/invite/page.tsx',
        'app/login/page.tsx',
        'components/appearance/background-generator.tsx',
        'components/appearance/drift-lab.tsx',
        'components/drift-surface.tsx',
      ].sort(),
    );
  });

  it('full colour only on the sign-in and invite screens; the floor everywhere else', () => {
    for (const { rel, tag } of uses) {
      expect(tag, rel).toMatch(/\bsurface="(public|app)"/);
      expect(tag.includes('surface="public"'), rel).toBe(PUBLIC.includes(rel));
    }
  });
});

describe('the public screens keep their text off the gradient', () => {
  it('lay out only the backdrop, the card column and the credit on the gradient', () => {
    for (const rel of PUBLIC) {
      const main = src(rel).match(/<main\b[\s\S]*<\/main>/)![0];
      // Direct text in the layout itself would sit on full colour.
      expect(main.replace(/\{\/\*[\s\S]*?\*\/\}/g, ''), rel).not.toMatch(/>\s*[A-Za-z][^<{]*</);
      expect(main, rel).toContain('<LoginCredit');
    }
  });

  it('put every form on an opaque card', () => {
    for (const rel of ['app/login/login-client.tsx', 'app/invite/invite-client.tsx']) {
      const text = src(rel);
      // One root: the sectioned card, solid bg-card (never a bg-card/NN wash).
      expect(text.match(/^ {2}return \(/gm), rel).toHaveLength(1);
      expect(text, rel).toMatch(/<section className="rounded-xl border border-border bg-card">/);
      expect(text, rel).not.toMatch(/bg-card\/\d/);
    }
  });

  it('the credit is the product logotype alone, no text of its own', () => {
    const html = renderToStaticMarkup(createElement(LoginCredit, { show: true }));
    expect(html.replace(/<[^>]*>/g, '').trim()).toBe('');
  });
});
