/**
 * The item tree's wire: query keys, URLs and writes for /api/tree (the brain's
 * docs/folder-tree.md). Everything a kind's tree caches sits under
 * `['tree', kind]`, so one invalidation refreshes every open folder, the
 * flat views and the pins together.
 */
import { noteListAnswer } from '@/lib/workspace-filter';
import { ApiError, apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import type { AppTint } from '@mantle/client-types/app-nav';
import type {
  TreeFilter,
  TreeFolder,
  TreeFolderPage,
  TreeKind,
  TreeMarkList,
  TreeMarkView,
  TreeSearchResult,
  TreeSort,
  TreeTagList,
} from '@mantle/web-ui/types/tree';

/**
 * Who the tree is read as: since workspaces W6b every login reads and writes
 * /api/tree in its own scope (the member tree, /api/member/tree, is gone and
 * answers 410). Kept as a type so a later reader of its own has one place.
 */
export type TreeSource = 'owner';

const BASE: Record<TreeSource, string> = {
  owner: '/api/tree',
};

/** The cache scope of a kind's tree: the kind for the owner, prefixed for a
 *  reader, so the two never share a cached folder. */
export const treeScope = (kind: TreeKind, source: TreeSource = 'owner'): string =>
  source === 'owner' ? kind : `${source}:${kind}`;

export const treeKey = (kind: TreeKind, source: TreeSource = 'owner') =>
  ['tree', treeScope(kind, source)] as const;

/** `ws`: the switcher's workspace (W5b; null = all). It ends every list key,
 *  so a switch loads the lists again and a `['tree', scope]` refresh still
 *  reaches them all. Only the owner's tree takes it. */
export const folderKey = (
  kind: TreeKind,
  folderId: string | null,
  sort: TreeSort,
  source: TreeSource = 'owner',
  ws: string | null = null,
) => ['tree', treeScope(kind, source), 'folder', folderId ?? 'root', sort, ws ?? 'all'] as const;

export const searchKey = (
  kind: TreeKind,
  q: string,
  filter: TreeFilter = {},
  source: TreeSource = 'owner',
  ws: string | null = null,
) => ['tree', treeScope(kind, source), 'search', q, filter.tag ?? null, ws ?? 'all'] as const;

/** `ws`: the switcher's workspace (null = all), as on the folder and
 *  search keys: the tag counts follow it. */
export const tagsKey = (kind: TreeKind, ws: string | null = null) =>
  ['tree', kind, 'tags', ws ?? 'all'] as const;

export const marksKey = (kind: TreeKind, view: TreeMarkView) =>
  ['tree', kind, 'marks', view] as const;

function query(params: Record<string, string | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function folderUrl(
  kind: TreeKind,
  folderId: string | null,
  sort: TreeSort,
  cursor: string | null,
  source: TreeSource = 'owner',
  ws: string | null = null,
): string {
  return `${BASE[source]}/${kind}${query({ folder: folderId, sort, cursor, ws: source === 'owner' ? ws : null })}`;
}

/** An empty `q` is the A to Z view: every item by name, no folders. A
 *  filter narrows the items and drops the folders. A search with a term
 *  asks `across` (brain task f26a516e): every workspace the login reads,
 *  the switcher's workspace (`ws`) first, each item naming the workspace it
 *  opens in. A brain before it ignores `across` and narrows by `ws`. */
export function searchUrl(
  kind: TreeKind,
  q: string,
  cursor: string | null,
  filter: TreeFilter = {},
  source: TreeSource = 'owner',
  ws: string | null = null,
): string {
  // A reader's search takes no tag or workspace (it is not offered one). The
  // level filter is gone (W5b2 contract 29): `ws` narrows by workspace.
  // Across also brings matching folders under a workspace (a folders-only picker gets them): intended.
  const across = ws && q.trim() ? '1' : null;
  const rest = query(
    source === 'owner' ? { cursor, tag: filter.tag, ws, across } : { cursor },
  ).replace(/^\?/, '&');
  return `${BASE[source]}/${kind}/search?q=${encodeURIComponent(q.trim())}${rest}`;
}

export function marksUrl(kind: TreeKind, view: TreeMarkView): string {
  return `/api/tree/${kind}/marks?view=${view}`;
}

export const fetchFolderPage = (
  kind: TreeKind,
  folderId: string | null,
  sort: TreeSort,
  cursor: string | null,
  source: TreeSource = 'owner',
  ws: string | null = null,
): Promise<TreeFolderPage> => {
  const url = folderUrl(kind, folderId, sort, cursor, source, ws);
  return apiFetch<TreeFolderPage>(url).then((r) => noteListAnswer(r, ws));
};

export const fetchSearch = (
  kind: TreeKind,
  q: string,
  cursor: string | null,
  filter: TreeFilter = {},
  source: TreeSource = 'owner',
  ws: string | null = null,
): Promise<TreeSearchResult> => {
  const url = searchUrl(kind, q, cursor, filter, source, ws);
  return apiFetch<TreeSearchResult>(url).then((r) => noteListAnswer(r, ws));
};

export function tagsUrl(kind: TreeKind, ws: string | null = null): string {
  return `/api/tree/${kind}/tags${query({ ws })}`;
}

/** The tags of a kind's items, counted in the switcher's workspace when
 *  one is picked (the brain's `?ws=` on /tags). */
export const fetchTags = (kind: TreeKind, ws: string | null = null) =>
  apiFetch<TreeTagList>(tagsUrl(kind, ws)).then((r) => noteListAnswer(r, ws));

export const fetchMarks = (kind: TreeKind, view: TreeMarkView) =>
  apiFetch<TreeMarkList>(marksUrl(kind, view));

export type TreeFolderPatch = {
  name?: string;
  icon?: string | null;
  color?: string | null;
  /** Move under this folder; null = the top level. */
  parentId?: string | null;
  /** Place directly after this sibling; null = first. */
  after?: string | null;
  /** Go ahead although it changes who can see items (else a visibility
   *  refusal, 409). */
  confirm?: boolean;
  /** With `confirm`: the `total` the dialog showed; a different change now is
   *  refused again with the new list. */
  seen?: number;
};

/** A brain before `seen` checks the folder PATCH strictly and refuses the
 *  field by name (400); the write is then repeated without it, as that brain
 *  would have taken it. */
function refusedSeen(err: unknown): boolean {
  return err instanceof ApiError && err.status === 400 && /\bseen\b/.test(err.message);
}

/** Who writes: /api/tree, for every login (W6b). */
export type TreeWriter = TreeSource;

/** A new folder's look, chosen in the create dialog: only what was set. */
export type TreeFolderLook = { icon?: string; color?: AppTint | null };

/** The look goes in the same POST, so a folder with a face is one write. */
export const createTreeFolder = (
  kind: TreeKind,
  parentId: string | null,
  name: string,
  source: TreeWriter = 'owner',
  look: TreeFolderLook = {},
) =>
  apiSend<{ folder: TreeFolder }>(`${BASE[source]}/${kind}/folders`, 'POST', {
    parentId,
    name,
    ...(look.icon ? { icon: look.icon } : {}),
    ...(look.color ? { color: look.color } : {}),
  }).then((r) => r.folder);

export const patchTreeFolder = async (
  kind: TreeKind,
  id: string,
  patch: TreeFolderPatch,
  source: TreeWriter = 'owner',
): Promise<TreeFolder> => {
  const url = `${BASE[source]}/${kind}/folders/${id}`;
  try {
    return (await apiSend<{ folder: TreeFolder }>(url, 'PATCH', patch)).folder;
  } catch (err) {
    if (patch.seen === undefined || !refusedSeen(err)) throw err;
    const { seen: _seen, ...older } = patch;
    return (await apiSend<{ folder: TreeFolder }>(url, 'PATCH', older)).folder;
  }
};

/** What the folder holds moves up to its parent first; a name clash there is
 *  a 409 and nothing moves, and so is a lift that changes who can see
 *  something, until it is repeated with `confirm` (and `seen`, the total the
 *  dialog showed). */
export const deleteTreeFolder = (
  kind: TreeKind,
  id: string,
  confirm = false,
  source: TreeWriter = 'owner',
  seen?: number,
) =>
  apiSend<{ ok: true }>(
    `${BASE[source]}/${kind}/folders/${id}${
      confirm ? `?confirm=true${seen !== undefined ? `&seen=${seen}` : ''}` : ''
    }`,
    'DELETE',
  );

export type TreeMoveResult = { moved: number; failed: Array<{ id: string; error: string }> };

/** Refused whole (nothing moves) when it changes who can see any of them,
 *  until it is repeated with `confirm` (and `seen`, the total shown). */
export const moveTreeItems = (
  kind: TreeKind,
  ids: string[],
  folderId: string | null,
  confirm = false,
  source: TreeWriter = 'owner',
  seen?: number,
) =>
  apiSend<TreeMoveResult>(`${BASE[source]}/${kind}/move`, 'POST', {
    ids,
    folderId,
    ...(confirm ? { confirm: true, ...(seen !== undefined ? { seen } : {}) } : {}),
  });

/** Put an item in its folder's custom order, right after another item of
 *  that folder (null = first). One order for everyone: Write on the folder
 *  (an Admin at the top level), else a 403 in the brain's words. */
export const placeTreeItem = (kind: TreeKind, id: string, after: string | null) =>
  apiSend<{ ok: true }>(`${BASE.owner}/${kind}/place`, 'POST', { id, after });

export const setTreeItemPinned = (id: string, pinned: boolean) =>
  apiSend<{ ok: true }>(`/api/tree/items/${id}/pin`, 'PUT', { pinned });

/** Count an open for Recent and Most used. Fire-and-forget: it must never
 *  delay or fail the open itself, and a private item has no counter. */
export function recordTreeItemOpened(id: string): Promise<void> {
  return apiSend(`/api/tree/items/${id}/opened`, 'POST').then(
    () => undefined,
    () => undefined,
  );
}
