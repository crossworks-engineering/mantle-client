import type { TreeItem, TreeKind } from '@mantle/web-ui/types/tree';

/**
 * "Move to folder…" from outside the tree (the item header's More menu,
 * contract 2026-10-21): the tree of that kind opens its own Move dialog for
 * the item, so the move takes the same path as one from the tree (who would
 * see it, the folder confirm, a partial failure).
 */
const EVENT = 'mantle:tree-move';

export type TreeMoveRequest = { kind: TreeKind; item: Pick<TreeItem, 'id' | 'title'> };

export function requestTreeMove(request: TreeMoveRequest): void {
  window.dispatchEvent(new CustomEvent<TreeMoveRequest>(EVENT, { detail: request }));
}

/** The tree's side: `onRequest` for every move asked of this kind. */
export function onTreeMoveRequest(kind: TreeKind, onRequest: (item: TreeItem) => void): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<TreeMoveRequest>).detail;
    if (!detail || detail.kind !== kind) return;
    // The fields a move reads; the rest of a row is the tree's own.
    onRequest({
      id: detail.item.id,
      title: detail.item.title,
      icon: null,
      color: null,
      subtype: null,
      state: null,
      updatedAt: '',
    } as TreeItem);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
