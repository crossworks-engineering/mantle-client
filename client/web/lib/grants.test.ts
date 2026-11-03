/**
 * Grants (W5b2): the rules the Grant Access panel, the chips, the folder
 * confirm and the move dialog follow.
 */
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@mantle/web-ui/api-fetch';
import {
  alsoVisibleLine,
  appHolderLines,
  contentsLeftText,
  contentsLines,
  withContentsLabel,
  chipsOf,
  folderConfirmText,
  folderPreviewUrl,
  grantErrorCode,
  grantErrorText,
  lostSight,
  moveChangesAccess,
  removedLine,
  GRANT_COLUMNS,
  homeMoveWords,
  rowActions,
  rowControlTitles,
  rowActionsFor,
  addRequest,
  removeRequest,
  folderConfirm,
  isItemGone,
  isNoGrants,
  uploadVisibleTo,
  uploadLine,
  appMoveLines,
  needsConfirm,
  rowNote,
  skippedText,
  sortAddable,
  sortRows,
  withConfirm,
  workspacesOf,
  type GrantRow,
  type SkippedEmbed,
  FOLDER_SERVE_OFFER_MAX,
  LINK_CHANGED_TEXT,
  linkCreateRequest,
  linkServeRequest,
  nextServed,
  serveCappedText,
  serveRows,
  servedCountText,
  servedElsewhere,
  servedElsewhereText,
  sendServeChange,
} from './grants';

const row = (over: Partial<GrantRow> = {}): GrantRow => ({
  wsId: 'w1',
  name: 'Sales',
  write: false,
  isHome: false,
  viaFolder: null,
  excluded: false,
  ...over,
});

describe('rows', () => {
  it('home first, removed rows last, else by name', () => {
    const rows = [
      row({ wsId: 'z', name: 'Zed' }),
      row({ wsId: 'x', name: 'Alpha', excluded: true, viaFolder: { id: 'f', title: 'F' } }),
      row({ wsId: 'h', name: 'Team', isHome: true }),
      row({ wsId: 'b', name: 'Beta' }),
    ];
    expect(sortRows(rows).map((r) => r.wsId)).toEqual(['h', 'b', 'z', 'x']);
  });

  it('says where a row comes from', () => {
    expect(rowNote(row({ isHome: true }))).toBeNull();
    expect(rowNote(row({ viaFolder: { id: 'f', title: 'Plans' } }))).toBe('Via folder Plans');
    expect(rowNote(row({ viaFolder: { id: 'f', title: null } }))).toBe(
      'Via folder a folder you cannot open',
    );
    expect(rowNote(row({ excluded: true, viaFolder: { id: 'f', title: 'Plans' } }))).toBe(
      'Removed here (folder Plans grants it)',
    );
    expect(rowNote(row())).toBeNull();
  });

  it('the home row has no remove and is not a new home; its Write switch works', () => {
    expect(rowActions(row({ isHome: true }))).toEqual({
      write: true,
      remove: false,
      restore: false,
      changeHere: false,
      move: false,
    });
  });

  it('any other listed row may be picked as the new home', () => {
    expect(rowActions(row()).move).toBe(true);
    expect(rowActions(row({ viaFolder: { id: 'f', title: 'F' } })).move).toBe(true);
  });

  it('a folder row offers Change here, not its Write switch', () => {
    expect(rowActions(row({ viaFolder: { id: 'f', title: 'F' } }))).toMatchObject({
      write: false,
      remove: true,
      changeHere: true,
    });
  });

  it('a removed row offers only Restore', () => {
    expect(rowActions(row({ excluded: true, viaFolder: { id: 'f', title: 'F' } }))).toEqual({
      write: false,
      remove: false,
      restore: true,
      changeHere: false,
      move: false,
    });
  });

  it('an Admin or Team home row offers Write like any home (contract 23)', () => {
    expect(rowActions(row({ wsId: 'team', name: 'Team', isHome: true }))).toEqual({
      write: true,
      remove: false,
      restore: false,
      changeHere: false,
      move: false,
    });
    expect(rowActions(row({ wsId: 'team', name: 'Team' })).move).toBe(true);
  });

  it('Add workspace lists Admin first for an Admin user (21.8), then by name', () => {
    const addable = [
      { wsId: 's', name: 'Sales' },
      { wsId: 'a', name: 'Admin' },
      { wsId: 'b', name: 'Board' },
    ];
    expect(sortAddable(addable, 'a').map((w) => w.wsId)).toEqual(['a', 'b', 's']);
    expect(sortAddable(addable, null).map((w) => w.wsId)).toEqual(['a', 'b', 's']);
    expect(sortAddable([{ wsId: 'z', name: 'Zed' }, ...addable], 'z')[0]!.wsId).toBe('z');
  });
});

describe('the panel columns', () => {
  const titles = (r: GrantRow, manage: boolean, moderatesRow = true, type?: string) =>
    rowControlTitles(r, rowActionsFor(r, manage, moderatesRow), manage, type);

  it('labels Home, Writable and Revoke', () => {
    expect(GRANT_COLUMNS).toEqual({ home: 'Home', write: 'Writable', revoke: 'Revoke' });
  });

  it('says what each control does for a Moderator', () => {
    expect(titles(row(), true)).toEqual({
      home: 'Make Sales the home',
      write: 'Users in Sales can change it',
      revoke: 'Revoke Sales',
    });
    expect(titles(row(), true, false, 'app').write).toBe('Users in Sales can change its data');
  });

  it('says why a dimmed control is off', () => {
    const home = titles(row({ isHome: true, name: 'Team' }), true);
    expect(home.home).toBe('Team is the home: its Moderators manage it');
    expect(home.revoke).toBe('The home stays. Pick another home first.');
    const folder = titles(row({ viaFolder: { id: 'f', title: 'F' } }), true);
    expect(folder.write).toBe('Read only: set by the folder. Change here first.');
    const gone = titles(row({ excluded: true }), true);
    expect(gone).toEqual({
      home: 'Removed here. Restore it first.',
      write: 'Removed here. Restore it first.',
      revoke: 'Removed here already.',
    });
    expect(titles(row(), true, false).home).toBe('Only a Moderator of Sales can make it the home.');
    expect(titles(row({ write: true }), false, false)).toEqual({
      home: 'Only a Moderator of the home can move it.',
      write: 'Can change',
      revoke: 'Only a Moderator of the home or of Sales can revoke it.',
    });
    // A reader is not told to pick another home: they cannot.
    expect(titles(row({ isHome: true }), false, false).revoke).toBe('The home stays.');
    // A Moderator of only that row reads why its folder switch is off.
    const viaFolder = row({ write: true, viaFolder: { id: 'f', title: 'F' } });
    expect(titles(viaFolder, false, true).write).toBe('Can change: set by the folder.');
    expect(titles(viaFolder, false, false).write).toBe('Can change');
  });

  it('the Home confirm names the new home and who will manage it', () => {
    expect(homeMoveWords('Plan', 'Sales')).toEqual({
      title: 'Make Sales the home?',
      action: '“Plan” moves to Sales. The Moderators of Sales will manage it.',
    });
    expect(homeMoveWords('', 'Sales').action).toContain('“This item” moves to Sales.');
  });
});

describe('chips', () => {
  it('reads workspaces from any row, and none from an older brain', () => {
    expect(workspacesOf({ workspaces: [{ id: 'a', name: 'A' }, { bad: 1 }] })).toEqual([
      { id: 'a', name: 'A' },
    ]);
    expect(workspacesOf({ audience: 'team' })).toEqual([]);
    expect(workspacesOf(null)).toEqual([]);
  });

  it('three chips by name, then +N; the title names them all', () => {
    const ws = ['Delta', 'Alpha', 'Echo', 'Bravo'].map((n) => ({ id: n, name: n }));
    const c = chipsOf(ws);
    expect(c.shown.map((w) => w.name)).toEqual(['Alpha', 'Bravo', 'Delta']);
    expect(c.more).toBe(1);
    expect(c.title).toBe('Shared with: Alpha, Bravo, Delta, Echo');
  });
});

describe('folder confirm', () => {
  it('builds the preview URL of one change', () => {
    expect(folderPreviewUrl('f1', { add: 'w2', name: 'Sales' })).toBe(
      '/api/grants/f1/preview?add=w2',
    );
    expect(folderPreviewUrl('f1', { remove: 'w2', name: 'Sales' })).toBe(
      '/api/grants/f1/preview?remove=w2',
    );
  });

  it('says how many items gain or lose a workspace', () => {
    const add = { add: 'w', name: 'Sales' };
    expect(folderConfirmText(add, { gain: 12, lose: 0, tooBig: false })).toBe(
      '12 items gain Sales.',
    );
    expect(folderConfirmText(add, { gain: 1, lose: 0, tooBig: false })).toBe('1 item gains Sales.');
    expect(
      folderConfirmText({ remove: 'w', name: 'Sales' }, { gain: 0, lose: 3, tooBig: false }),
    ).toBe('3 items lose Sales.');
    expect(folderConfirmText(add, { gain: 0, lose: 0, tooBig: false })).toBe(
      'No item in it changes.',
    );
  });

  it('an app holder add says both effects (21.8 row 13), with or without counts', () => {
    expect(appHolderLines('Admin', ['Team'], { rows: 40, exportedTables: 2 })).toEqual([
      "This app's data (40 rows, 2 exported tables) becomes visible to Admin.",
      'This app will then read only items that Team and Admin both hold.',
    ]);
    expect(appHolderLines('Admin', ['Team'], { rows: null, exportedTables: 0 })[0]).toBe(
      "This app's data becomes visible to Admin.",
    );
    expect(appHolderLines('Ops', ['Team', 'Admin'])[1]).toBe(
      'This app will then read only items that Team, Admin and Ops all hold.',
    );
    expect(appHolderLines('Sales', [])).toEqual([
      "This app's data becomes visible to Sales.",
      'This app will then read only items that Sales holds.',
    ]);
  });

  it('adds confirm=1 to a URL', () => {
    expect(withConfirm('/api/grants/a/b', true)).toBe('/api/grants/a/b?confirm=1');
    expect(withConfirm('/api/grants/a/b', false)).toBe('/api/grants/a/b');
  });
});

describe('move', () => {
  const p = {
    alsoVisibleTo: [{ wsId: 'c', name: 'Client A' }],
    removedFrom: [{ wsId: 'h', name: 'Team' }],
  };
  it('says what it becomes visible to and where it stops', () => {
    expect(alsoVisibleLine(p)).toBe('This will also be visible to: Client A.');
    expect(removedLine(p)).toBe('It will no longer be readable in: Team.');
    expect(moveChangesAccess(p)).toBe(true);
    expect(moveChangesAccess({ alsoVisibleTo: [], removedFrom: [] })).toBe(false);
    expect(alsoVisibleLine({ alsoVisibleTo: [] })).toBeNull();
  });
});

describe('a folder home move with what is inside it', () => {
  const c = { move: 203, apps: 0, otherHome: 0, notAllowed: 0, hidden: 0, calls: 2 };
  it('the tick counts the items that move', () => {
    expect(withContentsLabel(203)).toBe('Also move the 203 items inside');
    expect(withContentsLabel(1)).toBe('Also move the 1 item inside');
  });
  it('says what stays and the apps that go along', () => {
    expect(contentsLines(c)).toEqual([]);
    expect(contentsLines({ ...c, otherHome: 3, hidden: 1, notAllowed: 1, apps: 2 })).toEqual([
      '3 items inside have another home and stay there, 1 of them you cannot open.',
      '1 item inside cannot live in that workspace and stays in the old home.',
      '2 apps inside move too: the new home sees their data.',
    ]);
    expect(contentsLines({ ...c, otherHome: 1, apps: 1 })).toEqual([
      '1 item inside has another home and stays there.',
      'One app inside moves too: the new home sees its data.',
    ]);
  });
  it('after the move: what stayed, or nothing', () => {
    expect(contentsLeftText({})).toBeNull();
    const res = (n: number) => ({
      contents: { moved: 0, remaining: 0, leftAlone: [], leftAloneCount: n, hidden: 0 },
    });
    expect(contentsLeftText(res(0))).toBeNull();
    expect(contentsLeftText(res(2))).toBe(
      '2 items inside stayed where they were: another home, or a kind that workspace cannot hold.',
    );
  });
});

describe('writes and errors', () => {
  it('knows the { visible: false } answer and counts skipped embeds', () => {
    expect(lostSight({ visible: false })).toBe(true);
    expect(lostSight({ rows: [] })).toBe(false);
    expect(skippedText([])).toBeNull();
    const sk = (code: string) => ({ nodeId: 'n', wsId: 'w', code: code as SkippedEmbed['code'] });
    expect(skippedText([sk('forbidden'), sk('forbidden')])).toBe(
      '2 embeds were not shared: you may not share it there.',
    );
    // A code this UI does not know is named as the brain sent it.
    expect(skippedText([sk('too_big')])).toBe('One embed was not shared: the brain said too_big.');
    // An embedded app is asked again, not reported as refused.
    expect(skippedText([sk('confirm_required')])).toBeNull();
    expect(needsConfirm([sk('forbidden'), sk('confirm_required')])).toEqual([
      sk('confirm_required'),
    ]);
  });

  it('shows the brain words as is and reads the code', () => {
    const e = new ApiError('This folder holds too many items.', 409, {
      error: 'This folder holds too many items.',
      code: 'too_big',
    });
    expect(grantErrorText(e, 'x')).toBe('This folder holds too many items.');
    expect(grantErrorCode(e)).toBe('too_big');
    expect(isItemGone(e)).toBe(false);
    expect(grantErrorText(new Error('boom'), 'Could not share it')).toBe('Could not share it');
  });
});

describe('who may change a row (contract 10)', () => {
  it('a Moderator of only that workspace may remove the row or turn Write off', () => {
    expect(rowActionsFor(row({ write: true }), false, true)).toMatchObject({
      write: true,
      remove: true,
      changeHere: false,
      restore: false,
      move: false,
      writeOffOnly: true,
    });
    // Write is off already: nothing to turn off, only remove.
    expect(rowActionsFor(row({ write: false }), false, true)).toMatchObject({
      write: false,
      remove: true,
    });
  });

  it('a Moderator of the home makes a row the home only where they moderate it too', () => {
    // The brain answers 403 to a move into a workspace the caller does not moderate.
    expect(rowActionsFor(row(), true, true).move).toBe(true);
    expect(rowActionsFor(row(), true, false)).toMatchObject({ move: false, remove: true });
    expect(rowActionsFor(row({ isHome: true }), true, true).move).toBe(false);
  });

  it('not on the home, a removed row or a row they do not moderate', () => {
    expect(rowActionsFor(row({ isHome: true }), false, true).remove).toBe(false);
    expect(rowActionsFor(row({ excluded: true }), false, true).remove).toBe(false);
    expect(rowActionsFor(row(), false, false).remove).toBe(false);
  });
});

describe('what a write sends', () => {
  it('a folder add and an app add send confirm, a plain add does not', () => {
    expect(addRequest('f', 'w', 'branch').body).toEqual({ wsId: 'w', confirm: true });
    expect(addRequest('a', 'w', 'app').body).toEqual({ wsId: 'w', confirm: true });
    expect(addRequest('p', 'w', 'page')).toEqual({
      url: '/api/grants/p',
      method: 'POST',
      body: { wsId: 'w' },
    });
  });

  it('a folder remove goes with ?confirm=1', () => {
    expect(removeRequest('f', 'w', 'branch').url).toBe('/api/grants/f/w?confirm=1');
    expect(removeRequest('p', 'w', 'page').url).toBe('/api/grants/p/w');
  });

  it('a too-big folder blocks the confirm, with the words to share sub-folders', () => {
    const c = folderConfirm({ add: 'w', name: 'Sales' }, { gain: 0, lose: 0, tooBig: true });
    expect(c.blocked).toBe(true);
    expect(c.lines[0]).toContain('Share the sub-folders one by one');
    expect(folderConfirm({ add: 'w', name: 'Sales' }, { gain: 2, lose: 0, tooBig: false })).toEqual(
      { title: 'Share this folder with Sales?', lines: ['2 items gain Sales.'], blocked: false },
    );
  });

  it('an old brain (no code) is told apart from a hidden item (a code)', () => {
    const old = new ApiError('Not found', 404);
    const gone = new ApiError('not found', 404, { error: 'not found', code: 'not_found' });
    expect(isNoGrants(old)).toBe(true);
    expect(isItemGone(old)).toBe(false);
    expect(isNoGrants(gone)).toBe(false);
    expect(isItemGone(gone)).toBe(true);
  });
});

describe('upload into a folder (S6)', () => {
  it('names every workspace when the folder is shared beyond its home', () => {
    const rows = [
      row({ wsId: 'h', name: 'Admin', isHome: true }),
      row({ wsId: 's', name: 'Sales' }),
      row({ wsId: 'x', name: 'Board', excluded: true, viaFolder: { id: 'f', title: 'F' } }),
    ];
    expect(uploadVisibleTo({ rows })).toEqual(['Admin', 'Sales']);
    expect(uploadLine(['Admin', 'Sales'], 2)).toBe(
      'These 2 files will also be visible to: Admin, Sales.',
    );
  });

  it('asks nothing for a folder only its home reads', () => {
    expect(uploadVisibleTo({ rows: [row({ isHome: true })] })).toBeNull();
    expect(uploadVisibleTo(null)).toBeNull();
  });
});

describe('an app move (S7)', () => {
  it('says both effects', () => {
    expect(appMoveLines(['Sales'], ['Team', 'Sales'])).toEqual([
      "This app's data becomes visible to Sales.",
      'This app will then read only items that Team and Sales both hold.',
    ]);
    expect(appMoveLines(['Sales'])[1]).toBe(
      'This app will then read only items that every workspace it is in holds.',
    );
  });
});

describe('the served list ({nodeId, title}, contract 35)', () => {
  const view = {
    link: {
      id: 's1',
      path: '/s/tok',
      served: [
        { nodeId: 'AAA', title: 'Photo' },
        { nodeId: 'zzz', title: null },
      ],
    },
    serveCandidates: [{ nodeId: 'aaa', title: 'Photo', kind: 'file' }],
  };
  it('ticks, keeps and sends the ids, lower-case', () => {
    expect(serveRows(view)[0]!.served).toBe(true);
    expect(servedElsewhere(view)).toEqual([{ nodeId: 'zzz', title: null }]);
    expect(nextServed(view, ['aaa'], false)).toEqual(['zzz']);
    expect(nextServed(view, ['bbb'], true)).toEqual(['aaa', 'zzz', 'bbb']);
  });
});

describe('the open link serves a list (contract 30, 32)', () => {
  const view = {
    link: {
      id: 's1',
      path: '/s/tok',
      served: [
        { nodeId: 'aaa', title: 'Photo' },
        { nodeId: 'zzz', title: null },
      ],
    },
    serveCandidates: [
      { nodeId: 'AAA', title: 'Photo', kind: 'file' },
      { nodeId: 'bbb', title: 'Plan', kind: 'page' },
    ],
  };

  it('ticks the candidates the link serves (ids compare lower-case)', () => {
    expect(serveRows(view)).toEqual([
      { nodeId: 'AAA', title: 'Photo', kind: 'file', served: true },
      { nodeId: 'bbb', title: 'Plan', kind: 'page', served: false },
    ]);
    expect(serveRows(null)).toEqual([]);
    expect(serveRows({ link: null, serveCandidates: view.serveCandidates })[0]!.served).toBe(false);
  });

  it('keeps served items the user cannot change on every write', () => {
    expect(servedElsewhere(view)).toEqual([{ nodeId: 'zzz', title: null }]);
    expect(nextServed(view, ['bbb'], true)).toEqual(['aaa', 'zzz', 'bbb']);
    expect(nextServed(view, ['AAA'], false)).toEqual(['zzz']);
    // Ticking one already served changes nothing; no repeats.
    expect(nextServed(view, ['aaa'], true)).toEqual(['aaa', 'zzz']);
    expect(nextServed({ link: null, serveCandidates: [] }, ['x'], true)).toEqual(['x']);
  });

  it('sends POST /api/shares {nodeId, serve?} and PATCH /api/shares/:id {serve}', () => {
    expect(linkCreateRequest('n1')).toEqual({
      url: '/api/shares',
      method: 'POST',
      body: { nodeId: 'n1' },
    });
    expect(linkCreateRequest('n1', ['a']).body).toEqual({ nodeId: 'n1', serve: ['a'] });
    expect(linkServeRequest('s 1', ['a', 'b'])).toEqual({
      url: '/api/shares/s%201',
      method: 'PATCH',
      body: { serve: ['a', 'b'] },
    });
  });

  it('says what the link shows, what stays and when a folder list is cut', () => {
    expect(servedCountText(0)).toBe('The link shows only this item.');
    expect(servedCountText(1)).toBe('The link also shows one item.');
    expect(servedCountText(3)).toBe('The link also shows 3 items.');
    expect(servedElsewhereText([])).toBeNull();
    expect(servedElsewhereText([{ title: null }, { title: null }])).toBe(
      '2 more items stay on the list. You cannot change them here.',
    );
    expect(servedElsewhereText([{ title: 'Logo' }, { title: null }])).toBe(
      '2 more items stay on the list: Logo, one item you cannot open. You cannot change them here.',
    );
    expect(serveCappedText('branch', FOLDER_SERVE_OFFER_MAX)).toBe(
      'Only the first 500 items in this folder that you can edit are listed here.',
    );
    expect(serveCappedText('branch', 12)).toBeNull();
    expect(serveCappedText('page', 900)).toBeNull();
  });
});

describe('a served-list write reads the link again first (L4)', () => {
  const fresh = (served: string[], id = 's1') => ({
    link: { id, path: '/s/tok', served: served.map((nodeId) => ({ nodeId, title: null })) },
    serveCandidates: [{ nodeId: 'bbb', title: 'Plan', kind: 'page' }],
  });

  it('applies only this change to what the link serves now', async () => {
    // The panel was opened when the link served aaa only; since then
    // another user added zzz. Ticking bbb must keep zzz.
    const send = vi.fn(async () => ({ ok: true }));
    const out = await sendServeChange(
      { read: async () => fresh(['aaa', 'zzz']), send },
      's1',
      ['bbb'],
      true,
    );
    expect(out).toBe('done');
    expect(send).toHaveBeenCalledWith({
      url: '/api/shares/s1',
      method: 'PATCH',
      body: { serve: ['aaa', 'zzz', 'bbb'] },
    });
  });

  it('a cleared item another user took off stays off', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    await sendServeChange({ read: async () => fresh(['zzz']), send }, 's1', ['aaa'], false);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ body: { serve: ['zzz'] } }));
  });

  it('says the link changed when it is gone or is another link, and sends nothing', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const gone = { link: null, serveCandidates: [] };
    expect(await sendServeChange({ read: async () => gone, send }, 's1', ['a'], true)).toBe(
      'changed',
    );
    expect(
      await sendServeChange({ read: async () => fresh([], 's2'), send }, 's1', ['a'], true),
    ).toBe('changed');
    expect(send).not.toHaveBeenCalled();
    expect(LINK_CHANGED_TEXT).toBe('This link changed. Check the list again.');
  });

  it('a 409 or a 404 not_found from the brain is "changed"; other refusals are thrown', async () => {
    const conflict = vi.fn(async () => {
      throw new ApiError('conflict', 409);
    });
    expect(
      await sendServeChange({ read: async () => fresh([]), send: conflict }, 's1', ['a'], true),
    ).toBe('changed');
    const gone = vi.fn(async () => {
      throw new ApiError('not_found', 404, { error: 'not_found' });
    });
    expect(
      await sendServeChange({ read: async () => fresh([]), send: gone }, 's1', ['a'], true),
    ).toBe('changed');
    const otherMissing = vi.fn(async () => {
      throw new ApiError('Not Found', 404);
    });
    await expect(
      sendServeChange({ read: async () => fresh([]), send: otherMissing }, 's1', ['a'], true),
    ).rejects.toBeInstanceOf(ApiError);
    const refused = vi.fn(async () => {
      throw new ApiError('no', 403);
    });
    await expect(
      sendServeChange({ read: async () => fresh([]), send: refused }, 's1', ['a'], true),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
