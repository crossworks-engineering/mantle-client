import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A picked card or option (a list row, a theme or avatar card) wears the
 * theme's `selected` surface, which the theme generator solves so the card's
 * ordinary text keeps 4.5:1 on it in every theme and mode. A raw accent tint
 * under that text does not: half a light accent in Starry Night dark put the
 * muted preview of the selected chat at 1.3:1. So no selected or checked
 * state may tint with `bg-accent/NN`; a full `bg-accent` fill pairs with
 * `text-accent-foreground` and is not this rule's business.
 */
const web = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const kit = join(web, '..', '..', 'packages', 'web-ui', 'src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

const TINTED_PICK = /(selected=true|state=checked)\]:bg-accent\/\d+/;

describe('the selected surface', () => {
  it('no selected or checked state tints with a raw accent', () => {
    const offenders = [web, kit]
      .flatMap((root) => sources(root).map((path) => [root, path] as const))
      .filter(([, path]) => !path.includes(`${sep}e2e${sep}`))
      .filter(([, path]) => TINTED_PICK.test(readFileSync(path, 'utf8')))
      .map(([root, path]) => relative(root, path).split(sep).join('/'));
    expect(offenders, 'use bg-[color:var(--selected,…)] as ListCard does').toEqual([]);
  });

  it('the list card wears it, with the old tint as the fallback', () => {
    const card = readFileSync(join(kit, 'ui', 'list-card.tsx'), 'utf8');
    expect(card).toContain(
      'data-[selected=true]:bg-[color:var(--selected,color-mix(in_oklab,var(--accent)_50%,transparent))]',
    );
  });
});
