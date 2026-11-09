'use client';

import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { ChildPageCard, childPageSnapshot } from './child-page-card';

/**
 * The editor's chrome for a `childPage` block: the shared page link card
 * (child-page-card.tsx), which the read view (static-doc.tsx) draws too. The
 * node is an atom, so the whole card is a Next `Link` to the page.
 */
export function ChildPageView({ node }: NodeViewProps) {
  const snap = childPageSnapshot(node.attrs);
  return (
    <NodeViewWrapper className="my-2" data-drag-handle>
      <ChildPageCard {...snap} />
    </NodeViewWrapper>
  );
}
