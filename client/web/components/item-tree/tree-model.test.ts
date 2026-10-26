import { describe, expect, it } from 'vitest';
import type { TreeFilter, TreeFolder, TreeFolderPage, TreeItem } from '@mantle/web-ui/types/tree';
import {
  afterFor,
  afterForStep,
  canNestFolder,
  childEntries,
  childGuides,
  crumbLine,
  dropPosition,
  flattenTree,
  folderHasChildren,
  folderManaged,
  isOnTheWayTo,
  itemMovable,
  itemPlaceAt,
  liveFolder,
  mergeFolderPages,
  pickedAfterMove,
  rangeOfItems,
  refreshFor,
  type CachedFolderPages,
  type FolderLoad,
  type TreeRow,
} from './tree-model';
import { folderKey, folderUrl, searchKey, searchUrl, tagsKey, tagsUrl, treeKey } from './tree-api';
import { treeKindOfItem, treeKindsOf } from './use-tree-kinds';

const folder = (id: string, path: string): TreeFolder => ({
  id,
  path,
  name: id,
  icon: null,
  color: null,
  depth: path.split('.').length - 1,
  parentId: null,
  share: null,
  system: false,
  folderCount: 0,
  itemCount: 0,
  workspaces: [],
  hasLink: false,
});

const item = (id: string): TreeItem => ({
  id,
  title: id,
  icon: null,
  color: null,
  subtype: null,
  state: null,
  updatedAt: '2026-09-30T00:00:00.000Z',
  workspaces: [],
  hasLink: false,
});

const page = (
  folders: TreeFolder[],
  items: TreeItem[],
  nextCursor: string | null,
): TreeFolderPage => ({
  kind: 'files',
  folder: null,
  crumbs: [],
  folders,
  items,
  sort: 'name',
  nextCursor,
});

describe('folder pages', () => {
  it('merges item pages in order, once each, with the folders of the first', () => {
    const a = folder('a', 'files.a');
    const merged = mergeFolderPages([
      page([a], [item('1'), item('2')], 'c1'),
      page([], [item('2'), item('3')], null),
    ]);
    expect(merged.folders).toEqual([a]);
    expect(merged.items.map((i) => i.id)).toEqual(['1', '2', '3']);
    expect(merged.hasMore).toBe(false);
    expect(mergeFolderPages(undefined)).toEqual({ folders: [], items: [], hasMore: false });
  });

  it('lists folders first and closes the last row only when nothing is left to load', () => {
    const done = childEntries({
      folders: [folder('a', 'files.a')],
      items: [item('1')],
      hasMore: false,
    });
    expect(done.map((e) => [e.type, e.isLast])).toEqual([
      ['folder', false],
      ['item', true],
    ]);
    const more = childEntries({ folders: [], items: [item('1')], hasMore: true });
    expect(more.map((e) => e.isLast)).toEqual([false]);
    const picker = childEntries(
      { folders: [folder('a', 'files.a')], items: [item('1')], hasMore: true },
      true,
    );
    expect(picker.map((e) => [e.type, e.isLast])).toEqual([['folder', true]]);
  });

  it('carries the guides down one level', () => {
    expect(childGuides([], true)).toEqual([true]);
    expect(childGuides([false], false)).toEqual([false, false]);
  });

  it('writes crumbs as one line', () => {
    expect(crumbLine([])).toBe('');
    expect(
      crumbLine([
        { id: '1', name: 'Clients' },
        { id: '2', name: 'Acme' },
      ]),
    ).toBe('Clients / Acme');
  });

  it('opens the folders on the way to a target, and no sibling that shares a prefix', () => {
    expect(isOnTheWayTo('files.a.b', 'files.a')).toBe(true);
    expect(isOnTheWayTo('files.a.b', 'files.a.b')).toBe(true);
    expect(isOnTheWayTo('files.ab', 'files.a')).toBe(false);
    expect(isOnTheWayTo(null, 'files.a')).toBe(false);
  });
});

describe('flattening the tree for the virtual list', () => {
  const withCounts = (f: TreeFolder, folderCount: number, itemCount: number): TreeFolder => ({
    ...f,
    folderCount,
    itemCount,
  });
  const a = withCounts(folder('a', 'files.a'), 1, 1);
  // Counts that say one item, a load that finds none (moved away meanwhile).
  const b = withCounts(folder('b', 'files.a.b'), 0, 1);
  const c = withCounts(folder('c', 'files.c'), 0, 2);
  const ok = (folders: TreeFolder[], items: TreeItem[], hasMore = false): FolderLoad => ({
    status: 'ok',
    children: { folders, items, hasMore },
    loadingMore: false,
  });
  const loads: Record<string, FolderLoad> = {
    root: ok([a, c], [item('r1')], true),
    a: ok([b], [item('a1')]),
    b: ok([], []),
    c: { status: 'pending' },
  };
  const shape = (rows: TreeRow[]) =>
    rows.map((r) => ('depth' in r ? `${r.key}@${r.depth}` : r.key));

  it('puts each open folder’s rows below it, depth first, and names what must load', () => {
    const open = new Set(['a', 'b', 'c']);
    const { rows, needed } = flattenTree(
      (id) => loads[id ?? 'root']!,
      (id) => open.has(id),
      { emptyText: 'none' },
    );
    expect(shape(rows)).toEqual([
      'f:a@0',
      'f:b@1',
      's:b@2',
      'i:a1@1',
      'f:c@0',
      's:c@1',
      'i:r1@0',
      'm:root:1@0',
    ]);
    expect(needed).toEqual([null, 'a', 'b', 'c']);
    const empty = rows.find((r) => r.key === 's:b');
    expect(empty?.type === 'status' && empty.label).toBe('Empty');
  });

  it('keeps closed folders shut and gives the picker folders only', () => {
    const { rows, needed } = flattenTree(
      (id) => loads[id ?? 'root']!,
      (id) => id === 'a',
      { foldersOnly: true, emptyText: 'none' },
    );
    expect(shape(rows)).toEqual(['f:a@0', 'f:b@1', 'f:c@0']);
    expect(needed).toEqual([null, 'a']);
  });

  it('draws an item or folder met twice (just moved, one page stale) once, where first met', () => {
    const moved: Record<string, FolderLoad> = { ...loads, a: ok([b], [item('a1'), item('r1')]) };
    const { rows } = flattenTree(
      (id) => moved[id ?? 'root']!,
      (id) => id === 'a',
      { emptyText: 'none' },
    );
    expect(shape(rows).filter((k) => k.startsWith('i:r1'))).toEqual(['i:r1@1']);
    const twice: Record<string, FolderLoad> = { ...loads, root: ok([a, c, a], []) };
    const { rows: folders } = flattenTree(
      (id) => twice[id ?? 'root']!,
      () => false,
      { emptyText: 'none' },
    );
    expect(shape(folders)).toEqual(['f:a@0', 'f:c@0']);
  });

  it('shows the root’s own loading, failure and emptiness', () => {
    const one = (load: FolderLoad) =>
      flattenTree(
        () => load,
        () => false,
        { emptyText: 'No files yet.' },
      ).rows[0];
    expect(one({ status: 'pending' })).toMatchObject({ type: 'status', busy: true });
    expect(one({ status: 'error' })).toMatchObject({ type: 'status', retry: null });
    expect(one(ok([], []))).toMatchObject({ type: 'note', text: 'No files yet.' });
  });

  it('says a folder the brain no longer shows is gone, with no Retry that would fail', () => {
    const rows = (load: FolderLoad, goneText?: string) =>
      flattenTree(
        () => load,
        () => false,
        { emptyText: 'x', goneText },
      ).rows;
    const gone = rows({ status: 'error', gone: true }, 'No longer shared.')[0]!;
    expect(gone).toMatchObject({ type: 'status', label: 'No longer shared.' });
    expect(gone).not.toHaveProperty('retry');
    expect(rows({ status: 'error', gone: true })[0]).toMatchObject({ label: 'No longer here.' });
    expect(rows({ status: 'error' })[0]).toMatchObject({
      label: 'Couldn’t load this folder.',
      retry: null,
    });
  });
});

describe('items in another workspace (task f26a516e)', () => {
  const ok = (children: Extract<FolderLoad, { status: 'ok' }>['children']): FolderLoad => ({
    status: 'ok',
    children,
    loadingMore: false,
  });
  const admin = { id: 'wa', name: 'Admin', count: 2 };

  it('a folder whose items only another workspace reads still unfolds', () => {
    const f = { ...folder('a', 'files.a'), folderCount: 0, itemCount: 0 };
    expect(folderHasChildren(f)).toBe(false);
    expect(folderHasChildren({ ...f, itemsElsewhere: 2 })).toBe(true);
    // The picker lists folders only.
    expect(folderHasChildren({ ...f, itemsElsewhere: 2 }, true)).toBe(false);
  });

  it('keeps the brain’s hint from the first page, only while no item shows', () => {
    const first = { ...page([], [], null), elsewhere: [admin] };
    expect(mergeFolderPages([first]).elsewhere).toEqual([admin]);
    const withItem = { ...page([], [item('1')], null), elsewhere: [admin] };
    expect(mergeFolderPages([withItem])).not.toHaveProperty('elsewhere');
  });

  it('says where the items are in place of the empty note, and after the folders', () => {
    const root = flattenTree(
      () => ok({ folders: [], items: [], hasMore: false, elsewhere: [admin] }),
      () => false,
      { emptyText: 'No files yet.' },
    ).rows;
    expect(root).toEqual([
      {
        type: 'elsewhere',
        key: 'e:root:wa',
        depth: 0,
        guides: [],
        workspace: { id: 'wa', name: 'Admin' },
        count: 2,
      },
    ]);
    const b = { ...folder('b', 'files.b'), folderCount: 0, itemCount: 0 };
    const rows = flattenTree(
      () => ok({ folders: [b], items: [], hasMore: false, elsewhere: [admin] }),
      () => false,
      { emptyText: 'x' },
    ).rows;
    expect(rows.map((r) => r.key)).toEqual(['f:b', 'e:root:wa']);
    // The picker never says it.
    const picker = flattenTree(
      () => ok({ folders: [], items: [], hasMore: false, elsewhere: [admin] }),
      () => false,
      { emptyText: 'x', foldersOnly: true },
    ).rows;
    expect(picker).toEqual([]);
  });
});

describe('picking a range', () => {
  const rowOf = (id: string, state: TreeItem['state'] = null): TreeRow => ({
    type: 'item',
    key: `i:${id}`,
    item: { ...item(id), state },
    parent: null,
    folderPath: null,
    depth: 0,
    isLast: false,
    guides: [],
  });
  const rows: TreeRow[] = [
    rowOf('1'),
    { type: 'divider', key: 'd' },
    rowOf('2', 'private'),
    rowOf('3'),
    rowOf('1'),
    rowOf('4'),
  ];
  const movable = (i: TreeItem) => i.state !== 'private';

  it('takes every movable item between the two, either way round, once each', () => {
    expect(rangeOfItems(rows, '1', '4', movable)).toEqual(['1', '3', '4']);
    expect(rangeOfItems(rows, '4', '3', movable)).toEqual(['3', '4']);
    expect(rangeOfItems(rows, 'gone', '3', movable)).toEqual(['3']);
    expect(rangeOfItems(rows, '1', '2', movable)).toEqual([]);
  });
});

describe('dragging', () => {
  it('drops an item into a folder anywhere over it, a folder beside it at the edges', () => {
    expect(dropPosition(0.1, 'item')).toBe('inside');
    expect(dropPosition(0.1, 'folder')).toBe('before');
    expect(dropPosition(0.5, 'folder')).toBe('inside');
    expect(dropPosition(0.9, 'folder')).toBe('after');
  });

  it('never nests a folder in itself, below itself, or past the third level', () => {
    const a = folder('a', 'files.a');
    expect(canNestFolder(a, a)).toBe(false);
    expect(canNestFolder(a, folder('b', 'files.a.b'))).toBe(false);
    expect(canNestFolder(a, folder('x', 'files.ab'))).toBe(true);
    expect(canNestFolder(a, folder('d', 'files.x.y.z'))).toBe(false);
    expect(canNestFolder(a, null)).toBe(true);
  });

  it('places a folder after the target, or after what precedes it', () => {
    const sibs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(afterFor(sibs, 'c', 'a', 'before')).toBeNull();
    expect(afterFor(sibs, 'c', 'b', 'before')).toBe('a');
    expect(afterFor(sibs, 'a', 'b', 'before')).toBeNull();
    expect(afterFor(sibs, 'a', 'c', 'after')).toBe('c');
  });

  it('places an item before or after another item of its folder (a custom order)', () => {
    expect(dropPosition(0.2, 'item', 'item')).toBe('before');
    expect(dropPosition(0.8, 'item', 'item')).toBe('after');
    const f = folder('f', 'notes.f');
    const a = { item: item('a'), parent: f, mayOrder: true };
    const b = { item: item('b'), parent: f };
    expect(itemPlaceAt(a, b, 0.2, 1)).toBe('before');
    expect(itemPlaceAt(a, b, 0.8, 1)).toBe('after');
    // Not when the login may not order it, on itself, across folders, or
    // carrying a pick of several (a pick moves, never orders).
    expect(itemPlaceAt({ ...a, mayOrder: false }, b, 0.8, 1)).toBeNull();
    expect(itemPlaceAt(a, { item: item('a'), parent: f }, 0.8, 1)).toBeNull();
    expect(itemPlaceAt(a, { ...b, parent: folder('g', 'notes.g') }, 0.8, 1)).toBeNull();
    expect(itemPlaceAt(a, b, 0.8, 2)).toBeNull();
    // At the top level both sit in no folder.
    expect(itemPlaceAt({ ...a, parent: null }, { ...b, parent: null }, 0.2, 1)).toBe('before');
  });

  it('carries the folder page’s order right and its items to each row', () => {
    const pages = [
      { ...page([folder('s', 'notes.s')], [item('1'), item('2')], null), mayOrder: true },
    ];
    const children = mergeFolderPages(pages);
    expect(children.mayOrder).toBe(true);
    expect(mergeFolderPages([page([], [item('1')], null)]).mayOrder).toBeUndefined();
    const { rows } = flattenTree(
      (id) =>
        id === null ? { status: 'ok', children, loadingMore: false } : { status: 'pending' },
      () => false,
      { emptyText: 'none' },
    );
    const items = rows.filter((r): r is Extract<TreeRow, { type: 'item' }> => r.type === 'item');
    expect(items.map((r) => [r.item.id, r.mayOrder, r.siblings?.map((x) => x.id)])).toEqual([
      ['1', true, ['1', '2']],
      ['2', true, ['1', '2']],
    ]);
    const f = rows.find((r) => r.type === 'folder') as Extract<TreeRow, { type: 'folder' }>;
    expect(f.mayOrder).toBe(true);
  });

  it('steps a folder up or down among its siblings', () => {
    const sibs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(afterForStep(sibs, 'b', -1)).toBeNull();
    expect(afterForStep(sibs, 'c', -1)).toBe('a');
    expect(afterForStep(sibs, 'a', 1)).toBe('b');
    expect(afterForStep(sibs, 'b', 1)).toBe('c');
    expect(afterForStep(sibs, 'a', -1)).toBeUndefined();
    expect(afterForStep(sibs, 'c', 1)).toBeUndefined();
  });
});

describe('urls', () => {
  it('asks for a folder page and a search, the empty search being A to Z', () => {
    expect(folderUrl('files', null, 'name', null)).toBe('/api/tree/files?sort=name');
    expect(folderUrl('files', 'f1', 'updated', 'c/1')).toBe(
      '/api/tree/files?folder=f1&sort=updated&cursor=c%2F1',
    );
    expect(searchUrl('files', ' acme ', null)).toBe('/api/tree/files/search?q=acme');
    expect(searchUrl('files', '', 'x')).toBe('/api/tree/files/search?q=&cursor=x');
    expect(searchUrl('files', 'q', null, { tag: 'a b' })).toBe(
      '/api/tree/files/search?q=q&tag=a+b',
    );
    // No level= any more (contract 29): an old filter with a level sends none.
    expect(searchUrl('files', 'q', null, { level: 'team', tag: 'a' } as TreeFilter)).toBe(
      '/api/tree/files/search?q=q&tag=a',
    );
    expect(searchUrl('files', 'q', null, { tag: 'a' }, 'owner', 'w1')).toBe(
      '/api/tree/files/search?q=q&tag=a&ws=w1&across=1',
    );
  });

  it('a search with a term asks across workspaces (task f26a516e); A to Z never does', () => {
    expect(searchUrl('pages', 'plan', null, {}, 'owner', 'w1')).toBe(
      '/api/tree/pages/search?q=plan&ws=w1&across=1',
    );
    expect(searchUrl('pages', '  ', null, {}, 'owner', 'w1')).toBe(
      '/api/tree/pages/search?q=&ws=w1',
    );
    // All my workspaces: nothing to put first, nothing to ask.
    expect(searchUrl('pages', 'plan', null, {}, 'owner', null)).toBe(
      '/api/tree/pages/search?q=plan',
    );
  });

  it('keeps the cache keys of the one tree (W6b)', () => {
    expect(treeKey('notes')).toEqual(['tree', 'notes']);
    expect(folderKey('notes', null, 'name')).toEqual([
      'tree',
      'notes',
      'folder',
      'root',
      'name',
      'all',
    ]);
  });

  it('the switcher filter (W5b): ws on the owner tree only, and at the end of every key', () => {
    expect(folderUrl('notes', 'f1', 'name', null, 'owner', 'w1')).toBe(
      '/api/tree/notes?folder=f1&sort=name&ws=w1',
    );
    expect(searchUrl('notes', 'q', null, {}, 'owner', 'w1')).toBe(
      '/api/tree/notes/search?q=q&ws=w1&across=1',
    );
    expect(folderUrl('notes', null, 'name', null, 'owner', null)).toBe('/api/tree/notes?sort=name');
    expect(folderKey('notes', null, 'name', 'owner', 'w1').at(-1)).toBe('w1');
    expect(searchKey('notes', 'q', {}, 'owner', 'w1').at(-1)).toBe('w1');
    expect(searchKey('notes', 'q').at(-1)).toBe('all');
    // The tag menu counts in the picked workspace too.
    expect(tagsUrl('notes', 'w1')).toBe('/api/tree/notes/tags?ws=w1');
    expect(tagsUrl('notes')).toBe('/api/tree/notes/tags');
    expect(tagsKey('notes', 'w1').at(-1)).toBe('w1');
    expect(tagsKey('notes').at(-1)).toBe('all');
    expect(tagsKey('notes', 'w1').slice(0, 2)).toEqual(treeKey('notes'));
    // A refresh of the kind still reaches every workspace's lists.
    expect(folderKey('notes', null, 'name', 'owner', 'w1').slice(0, 2)).toEqual(treeKey('notes'));
  });

  it('maps a Library kind to its tree kind', () => {
    expect(treeKindOfItem('note')).toBe('notes');
    expect(treeKindOfItem('file')).toBe('files');
    expect(treeKindOfItem('nope')).toBeNull();
  });
});

describe('which kinds a brain serves as the tree', () => {
  it('reads the shell, keeping only kinds this client knows', () => {
    expect(treeKindsOf({ treeKinds: ['files', 'boards', 7] })).toEqual(['files']);
    expect(treeKindsOf({ treeKinds: ['recall'] })).toEqual(['recall']);
    expect(treeKindsOf({})).toEqual([]);
    expect(treeKindsOf(null)).toEqual([]);
  });
});

describe('pickedAfterMove', () => {
  it('keeps the items that did not move picked, in pick order', () => {
    const items = [item('a'), item('b'), item('c')];
    const failed: Array<{ id: string; error: string }> = [
      { id: 'c', error: 'x' },
      { id: 'a', error: 'y' },
    ];
    const left = pickedAfterMove(items, failed);
    expect([...left.keys()]).toEqual(['a', 'c']);
  });
  it('keeps nothing when all moved', () => {
    expect(pickedAfterMove([item('a')], []).size).toBe(0);
  });
});

describe('liveFolder (the member tree’s New and Upload target)', () => {
  const page = (folders: TreeFolder[], of: TreeFolder | null = null): TreeFolderPage => ({
    kind: 'notes',
    folder: of,
    crumbs: [],
    folders,
    items: [],
    sort: 'updated',
    nextCursor: null,
  });
  const target = { ...folder('t', 'notes.a.t'), parentId: 'a' };

  it('follows a rename in its parent’s listing', () => {
    const renamed = { ...target, name: 'Renamed' };
    const cache: CachedFolderPages[] = [
      { folderId: 'a', ok: true, notFound: false, pages: [page([renamed])] },
    ];
    expect(liveFolder(cache, target)).toBe(renamed);
  });
  it('is gone when its parent loads without it', () => {
    const cache: CachedFolderPages[] = [
      { folderId: 'a', ok: true, notFound: false, pages: [page([])] },
    ];
    expect(liveFolder(cache, target)).toBeNull();
  });
  it('is gone when its own pages answer 404', () => {
    const cache: CachedFolderPages[] = [
      { folderId: 't', ok: false, notFound: true, pages: undefined },
    ];
    expect(liveFolder(cache, target)).toBeNull();
  });
  it('stays as it was when nothing cached says', () => {
    expect(liveFolder([], target)).toBe(target);
    const pending: CachedFolderPages[] = [
      { folderId: 'a', ok: false, notFound: false, pages: undefined },
    ];
    expect(liveFolder(pending, target)).toBe(target);
  });
  it('a top-level folder’s parent is the root page', () => {
    const top = folder('t', 'notes.t');
    const cache: CachedFolderPages[] = [
      { folderId: null, ok: true, notFound: false, pages: [page([])] },
    ];
    expect(liveFolder(cache, top)).toBeNull();
  });
});

describe('refreshFor (a realtime ping about one item)', () => {
  const page = (ids: string[]): TreeFolderPage => ({
    kind: 'files',
    folder: null,
    crumbs: [],
    folders: [],
    items: ids.map(item),
    sort: 'name',
    nextCursor: null,
  });
  const loaded = [
    { key: 'root', pages: [page(['a'])] },
    { key: 'f1', pages: [page(['b']), page(['c'])] },
    { key: 'f2', pages: undefined },
  ];

  it('an item a loaded folder holds refreshes only that folder (a re-index)', () => {
    expect(refreshFor(loaded, 'c')).toEqual({ all: false, keys: ['f1'] });
    expect(refreshFor(loaded, 'a')).toEqual({ all: false, keys: ['root'] });
  });
  it('an item no loaded folder holds refreshes them all (it is new)', () => {
    expect(refreshFor(loaded, 'z')).toEqual({ all: true });
    expect(refreshFor([], 'z')).toEqual({ all: true });
  });
});

describe('itemMovable and folderManaged (W6b fix round: the item caps)', () => {
  it('an item moves when the brain sends no caps, or says the login manages it', () => {
    expect(itemMovable(item('a'))).toBe(true);
    expect(itemMovable({ ...item('a'), mayEdit: true, mayManage: true } as TreeItem)).toBe(true);
  });

  it('never a snapshot copy, even for its author (who may delete it)', () => {
    const copy = { ...item('c'), mayManage: true, readOnly: true, snapshotOf: 'n1' };
    expect(itemMovable(copy as TreeItem)).toBe(false);
  });

  it('never an item the login does not manage, or a private one', () => {
    expect(itemMovable({ ...item('g'), mayEdit: true, mayManage: false } as TreeItem)).toBe(false);
    expect(itemMovable({ ...item('p'), state: 'private' })).toBe(false);
  });

  it('a folder: its caps, and never a system folder', () => {
    expect(folderManaged(folder('f', '1'))).toBe(true);
    expect(folderManaged({ ...folder('f', '1'), mayManage: false } as TreeFolder)).toBe(false);
    expect(folderManaged({ ...folder('s', '1'), system: true })).toBe(false);
  });
});
