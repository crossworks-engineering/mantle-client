import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FIT_SLACK, FOLD_BELOW, UNFOLD_AT, tabsCompact } from './view-tabs';

/**
 * The view tabs (Folders, Recent, Most used, A to Z) fold to icons when the
 * panel is too narrow for their labels, measured in the user's own font.
 */
describe('tabsCompact', () => {
  const need = 200;
  const fold = need * FOLD_BELOW + FIT_SLACK;
  const unfold = need * UNFOLD_AT + FIT_SLACK;

  it('folds before the labels touch, with room to spare', () => {
    expect(tabsCompact(need, need, false)).toBe(true);
    expect(tabsCompact(fold - 1, need, false)).toBe(true);
    expect(fold).toBeGreaterThan(need);
  });

  it('shows the labels again only with clearly more room', () => {
    expect(tabsCompact(unfold, need, true)).toBe(false);
    expect(tabsCompact(unfold - 1, need, true)).toBe(true);
  });

  it('keeps what it was between the two, so a drag does not flicker', () => {
    const between = (fold + unfold) / 2;
    expect(tabsCompact(between, need, true)).toBe(true);
    expect(tabsCompact(between, need, false)).toBe(false);
  });

  it('scales with the font: a larger font needs a wider panel', () => {
    const width = 260;
    expect(tabsCompact(width, 180, false)).toBe(false);
    expect(tabsCompact(width, 240, false)).toBe(true);
  });

  it('keeps the current state before anything is measured', () => {
    expect(tabsCompact(0, need, false)).toBe(false);
    expect(tabsCompact(300, 0, true)).toBe(true);
  });
});

// The node runner cannot mount the tree, so the wiring is pinned by reading
// it, as tree-view.test.ts does; the real fold is checked in a browser.
const tree = readFileSync(
  fileURLToPath(new URL('./item-tree.tsx', import.meta.url)),
  'utf8',
).replace(/\s+/g, ' ');

describe('the tree wires the fold', () => {
  it('measures the tab group against a hidden copy of the labels', () => {
    expect(tree).toContain('useCompactTabs(tabsRef, tabLabelsRef, !searching)');
    expect(tree).toContain('ref={tabsRef}');
    expect(tree).toContain('<div ref={tabLabelsRef} className="flex w-max');
  });

  it('a folded tab keeps its name as a tooltip and an accessible name', () => {
    expect(tree).toContain('aria-label={compactTabs ? v.label : undefined}');
    expect(tree).toContain('title={compactTabs ? v.label : undefined}');
    expect(tree).toContain('{compactTabs ? <v.icon aria-hidden /> : v.label}');
  });
});
