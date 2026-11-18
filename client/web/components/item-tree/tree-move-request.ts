import type { TreeItem, TreeKind } from '@mantle/web-ui/types/tree';

/**
 * "Move to folder…" from outside the tree (the item header's More menu,
 * contract 2026-10-21, and a pick in the Files list or thumbnails): the tree
 * of that kind opens its own Move dialog for the items, so the move takes
 * the same path as one from the tree (who would see it, the folder confirm,
 * a partial failure).
 */
const EVENT = 'mantle:tree-move';

type MoveItem = Pick<TreeItem, 'id' | 'title'>;

export type TreeMoveRequest = {
  kind: TreeKind;
  /** One item (the item header). */
  item?: MoveItem;
  /** Several (a pick in a list). */
  items?: readonly MoveItem[];
  /** The folder they all sit in (null = the top level): not offered again.
   *  Absent when unknown or several. */
  from?: string | null;
};

export function requestTreeMove(request: TreeMoveRequest): void {
  window.dispatchEvent(new CustomEvent<TreeMoveRequest>(EVENT, { detail: request }));
}

/** The items a request names, one or several, each once. */
export function requestedItems(request: TreeMoveRequest): MoveItem[] {
  const all = [...(request.item ? [request.item] : []), ...(request.items ?? [])];
  return all.filter((it, i) => all.findIndex((o) => o.id === it.id) === i);
}

/** The tree's side: `onRequest` for every move asked of this kind. */
export function onTreeMoveRequest(
  kind: TreeKind,
  onRequest: (items: TreeItem[], from: string | null | undefined) => void,
): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<TreeMoveRequest>).detail;
    if (!detail || detail.kind !== kind) return;
    const items = requestedItems(detail);
    if (items.length === 0) return;
    // The fields a move reads; the rest of a row is the tree's own.
    onRequest(
      items.map(
        (it) =>
          ({
            id: it.id,
            title: it.title,
            icon: null,
            color: null,
            subtype: null,
            state: null,
            updatedAt: '',
          }) as TreeItem,
      ),
      detail.from,
    );
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
