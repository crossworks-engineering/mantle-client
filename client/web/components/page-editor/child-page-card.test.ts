/**
 * A page link card read, not edited (static-doc.tsx): the schema's own
 * `renderHTML` writes an empty `div[data-child-page]` that holds the
 * snapshot in data attributes, and the read view draws the editor's card
 * from them. Before this, the div stayed empty: a bordered box with no title.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import { ChildPage } from './child-page';
import { ChildPageCard, childPageSnapshotOf } from './child-page-card';

/** The div `renderHTML` writes for a card, as its attributes. */
function renderedAttrs(attrs: Record<string, unknown>): Record<string, string> {
  const schema = getSchema([StarterKit, ChildPage]);
  const node = schema.nodes.childPage!.create(attrs);
  const spec = schema.nodes.childPage!.spec.toDOM!(node) as unknown as [
    string,
    Record<string, string>,
  ];
  expect(spec[0]).toBe('div');
  return spec[1];
}

/** The card a static read portals into that div, for a login of `role`
 *  (null: the shell has not said, or no role this code knows). */
function readCard(attrs: Record<string, string>, role: 'admin' | 'member' | null): string {
  const qc = new QueryClient();
  if (role) qc.setQueryData(['shell'], { role });
  const snap = childPageSnapshotOf({ getAttribute: (k: string) => attrs[k] ?? null });
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client: qc }, createElement(ChildPageCard, snap)),
  );
}

describe('a page link card, read', () => {
  const attrs = renderedAttrs({ pageId: 'p-1', title: 'Site plan', icon: '📐' });

  it('is written as an empty div that keeps its snapshot', () => {
    expect(attrs).toMatchObject({
      'data-child-page': '',
      'data-page-id': 'p-1',
      'data-title': 'Site plan',
      'data-icon': '📐',
    });
  });

  it('shows the title and icon, and links for an admin and a member', () => {
    for (const role of ['admin', 'member'] as const) {
      const html = readCard(attrs, role);
      expect(html).toContain('Site plan');
      expect(html).toContain('📐');
      expect(html).toContain('href="/pages/p-1"');
    }
  });

  it('shows the title but links nowhere for a login with no known role', () => {
    const html = readCard(attrs, null);
    expect(html).toContain('Site plan');
    expect(html).not.toContain('href=');
  });

  it('says Untitled page for a card with no title', () => {
    const html = readCard(renderedAttrs({ pageId: 'p-2', title: '' }), 'admin');
    expect(html).toContain('Untitled page');
  });
});
