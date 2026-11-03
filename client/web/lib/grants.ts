/**
 * Grants (plan 4887b8e7, phase W5b): the pure rules the Grant Access panel,
 * the workspace chips, the folder confirm and the move dialog follow, so
 * each rule is unit-tested (grants.test.ts) without a browser.
 *
 * An item is shared by a grant to a workspace. Each grant has its own Write
 * switch. A folder passes its grants to what is in it ("via folder X"); a
 * child can change that row by hand. There is no level any more.
 *
 * The wire shapes are lib/contract/grants.ts: a verbatim copy of mantle
 * packages/client-types/src/dto/grants.ts (brain W5b2 part B, 63b38c1f6).
 * Replace the copy by hand when the brain's file changes; switch to
 * @mantle/client-types once a release carries it, then delete the copy.
 */
import { ApiError } from '@mantle/web-ui/api-fetch';
import type {
  GrantEmbedSkip,
  GrantMoveContentsPreview,
  GrantMovePreviewResponse,
  GrantMoveResponse,
  GrantPreviewResponse,
  GrantRow,
  GrantServedRef,
  GrantsResponse,
  ListWorkspace,
} from './contract/grants';

export type {
  GrantContactShare,
  GrantEmbed,
  GrantRow,
  GrantsResponse,
  GrantsWriteResponse,
  ListWorkspace,
} from './contract/grants';

/** A workspace as a list row or a chip names it. */
export type WorkspaceRef = ListWorkspace;

/** One entry of an open link's served list (contract change 35): title null
 *  when the caller cannot read the item. */
export type ServedEntry = GrantServedRef;

/** GET /api/grants/:nodeId. */
export type GrantsView = GrantsResponse;

/** A served entry's id, lower-case. */
export const servedId = (e: ServedEntry): string => e.nodeId.toLowerCase();

export const lostSight = (r: unknown): r is { visible: false } =>
  !!r && typeof r === 'object' && (r as { visible?: unknown }).visible === false;

export const LOST_SIGHT_TEXT = 'Done. You can no longer see this item.';

/** One pair the embeds write did not grant (contract change 11). */
export type SkippedEmbed = GrantEmbedSkip;

const SKIP_REASON: Record<string, string> = {
  forbidden: 'you may not share it there',
  kind_not_allowed: 'that kind of item cannot be shared',
  confirm_required: 'an app needs a yes first',
};

/** Why embeds were not shared, one sentence per reason. Null when none.
 *  `confirm_required` pairs are asked again, so they are left out here. */
export function skippedText(skipped: readonly SkippedEmbed[]): string | null {
  const counts = new Map<string, number>();
  for (const s of skipped) {
    if (s.code === 'confirm_required') continue;
    counts.set(s.code, (counts.get(s.code) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  return [...counts]
    .map(([code, n]) => {
      const reason = SKIP_REASON[code] ?? `the brain said ${code}`;
      return `${n === 1 ? 'One embed was' : `${n} embeds were`} not shared: ${reason}.`;
    })
    .join(' ');
}

/** The embed pairs the brain wants a yes for (an embedded app). */
export const needsConfirm = (skipped: readonly SkippedEmbed[]) =>
  skipped.filter((s) => s.code === 'confirm_required');

/** GET /api/grants/:id/preview: how many items gain or lose. */
export type FolderGrantPreview = GrantPreviewResponse;

/** POST /api/grants/move/preview. */
export type MovePreview = GrantMovePreviewResponse;

/** POST /api/grants/move. */
export type MoveResult = GrantMoveResponse;

export type MoveTo = { toFolderId: string | null } | { toWorkspaceId: string };

// ── URLs ────────────────────────────────────────────────────────────────

const enc = encodeURIComponent;
export const grantsUrl = (nodeId: string) => `/api/grants/${enc(nodeId)}`;
export const grantUrl = (nodeId: string, wsId: string) => `/api/grants/${enc(nodeId)}/${enc(wsId)}`;
export const grantsKey = (nodeId: string) => ['grants', nodeId] as const;

/** The folder preview of one change: adding or removing one workspace. */
export function folderPreviewUrl(folderId: string, change: GrantChange): string {
  const sp = new URLSearchParams();
  if (change.add) sp.set('add', change.add);
  if (change.remove) sp.set('remove', change.remove);
  return `${grantsUrl(folderId)}/preview?${sp.toString()}`;
}

/** One change to a folder's grants, for its preview and its confirm. */
export type GrantChange = { add?: string; remove?: string; name: string };

/** Add `?confirm=1` to a URL (DELETE, restore and hand carry no body). */
export const withConfirm = (url: string, confirm: boolean) =>
  confirm ? `${url}${url.includes('?') ? '&' : '?'}confirm=1` : url;

// ── The panel's rows ────────────────────────────────────────────────────

/** Home first, then by name; rows removed here last. */
export function sortRows(rows: readonly GrantRow[]): GrantRow[] {
  return [...rows].sort((a, b) => {
    if (a.isHome !== b.isHome) return a.isHome ? -1 : 1;
    if (a.excluded !== b.excluded) return a.excluded ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

/** The quiet line under a row's name. The home says nothing: its Home
 *  radio is ticked. */
export function rowNote(row: GrantRow): string | null {
  const folder = row.viaFolder ? (row.viaFolder.title ?? 'a folder you cannot open') : null;
  if (row.excluded && folder) return `Removed here (folder ${folder} grants it)`;
  if (row.excluded) return 'Removed here';
  if (row.isHome) return null;
  if (folder) return `Via folder ${folder}`;
  return null;
}

/** What a row offers a Moderator. The home has no remove (21.8: a move
 *  takes it away); a folder row is changed here first ("Change here")
 *  before its Write switch moves; a removed row only comes back. `move`:
 *  the row may be picked as the new home (its Home radio). */
export function rowActions(row: GrantRow): {
  write: boolean;
  remove: boolean;
  restore: boolean;
  changeHere: boolean;
  move: boolean;
} {
  if (row.excluded) {
    return { write: false, remove: false, restore: true, changeHere: false, move: false };
  }
  const folder = row.viaFolder !== null && !row.isHome;
  return {
    write: !folder,
    remove: !row.isHome,
    restore: false,
    changeHere: folder,
    move: !row.isHome,
  };
}

/**
 * What a row offers this user (contract change 10). A Moderator of the
 * item's home gets rowActions, except that a row becomes the home only
 * where they moderate it too (the brain's move answers 403 otherwise). A
 * Moderator of only that row's workspace may remove the row or turn its
 * Write off, nothing more. Anyone else reads.
 */
export function rowActionsFor(
  row: GrantRow,
  manage: boolean,
  moderatesRow: boolean,
): ReturnType<typeof rowActions> & { writeOffOnly: boolean } {
  if (manage) {
    const a = rowActions(row);
    return { ...a, move: a.move && moderatesRow, writeOffOnly: false };
  }
  const none = { write: false, remove: false, restore: false, changeHere: false, move: false };
  if (!moderatesRow || row.isHome || row.excluded) {
    return { ...none, writeOffOnly: false };
  }
  return { ...none, write: row.write && row.viaFolder === null, remove: true, writeOffOnly: true };
}

/** "Add workspace" choices: the Admin workspace first for an Admin user
 *  (21.8: "Add Admin" is the first choice), then by name. */
export function sortAddable<T extends { wsId: string; name: string }>(
  addable: readonly T[],
  adminWsId: string | null,
): T[] {
  return [...addable].sort((a, b) => {
    const aa = a.wsId === adminWsId;
    const bb = b.wsId === adminWsId;
    if (aa !== bb) return aa ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** The read-only panel's line for a row's switch. */
export const writeWord = (write: boolean) => (write ? 'Can change' : 'Read only');

/** The Write switch's label. On an app it is the data (the old
 *  "Informational" flag, now per workspace). */
export function writeLabel(type: string | undefined, name: string): string {
  return type === 'app' ? `Users in ${name} can change its data` : `Users in ${name} can change it`;
}

/** The panel's column labels, one header row over every workspace row. */
export const GRANT_COLUMNS = { home: 'Home', write: 'Writable', revoke: 'Revoke' } as const;

const RESTORE_FIRST = 'Removed here. Restore it first.';

/**
 * Each control's tooltip, and why it is off when it is. Every row keeps all
 * three controls in their columns; one the user cannot use is dimmed and
 * says why here.
 */
export function rowControlTitles(
  row: GrantRow,
  can: ReturnType<typeof rowActionsFor>,
  manage: boolean,
  type: string | undefined,
): { home: string; write: string; revoke: string } {
  const home = row.isHome
    ? `${row.name} is the home: its Moderators manage it`
    : row.excluded
      ? RESTORE_FIRST
      : can.move
        ? `Make ${row.name} the home`
        : manage
          ? `Only a Moderator of ${row.name} can make it the home.`
          : 'Only a Moderator of the home can move it.';
  const write = can.write
    ? writeLabel(type, row.name)
    : row.excluded
      ? RESTORE_FIRST
      : row.viaFolder && (manage || can.writeOffOnly)
        ? `${writeWord(row.write)}: set by the folder.${manage ? ' Change here first.' : ''}`
        : writeWord(row.write);
  // The brain removes a row for a Moderator of the item's home or of that
  // row's workspace (removeGrant), and never the home row itself.
  const revoke = can.remove
    ? `Revoke ${row.name}`
    : row.isHome
      ? manage
        ? 'The home stays. Pick another home first.'
        : 'The home stays.'
      : row.excluded
        ? 'Removed here already.'
        : `Only a Moderator of the home or of ${row.name} can revoke it.`;
  return { home, write, revoke };
}

/** Under the rows for a Moderator: Home lists only the rows, so a
 *  workspace not in the list is added first (the old Move menu offered it). */
export const HOME_ADD_FIRST_TEXT =
  'To make a workspace not listed here the home, add it first, then pick it as Home.';

/** The confirm a Home pick opens: it names the new home and who will
 *  manage the item there. */
export function homeMoveWords(itemTitle: string, name: string): { title: string; action: string } {
  return {
    title: `Make ${name} the home?`,
    action: `“${itemTitle || 'This item'}” moves to ${name}. The Moderators of ${name} will manage it.`,
  };
}

export const READ_ONLY_PANEL_TEXT =
  'You can see who has this item. Only a Moderator can change it.';
export const NO_ADDABLE_TEXT = 'You moderate no other workspace.';
export const APP_MCP_LABEL = 'MCP access: users reach its data from their own MCP client';
export const APP_MCP_HINT =
  'Read only for a workspace with Writable off. Who reaches it is who can run the app.';

/** The embeds line, with "Grant these too". */
export function embedsLine(n: number): string {
  return `${n === 1 ? 'One item it embeds is' : `${n} items it embeds are`} not shared with the same workspaces. People there do not see ${n === 1 ? 'it' : 'them'}.`;
}

// ── Chips ───────────────────────────────────────────────────────────────

/** The workspaces a list row carries (absent from a brain before W5b). */
export function workspacesOf(row: unknown): WorkspaceRef[] {
  const raw = (row as { workspaces?: unknown } | null)?.workspaces;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (w): w is WorkspaceRef =>
      !!w && typeof w === 'object' && typeof w.id === 'string' && typeof w.name === 'string',
  );
}

/** Whether a row has any share mark to show: a workspace, or an open link
 *  (the "public" mark). */
export function hasShareMarks(row: unknown): boolean {
  return workspacesOf(row).length > 0 || (row as { hasLink?: unknown } | null)?.hasLink === true;
}

/** Whether a row's workspaces carry their look (a brain from task 5edc9149
 *  on sends each chip's `kind`). An older brain's chips do not: an icon
 *  alone would be the same grey tile for every workspace. */
export function marksHaveLook(row: unknown): boolean {
  return workspacesOf(row).every((w) => w.kind !== undefined);
}

/** At most `max` chips, then "+N". The title names them all. */
export function chipsOf(
  workspaces: readonly WorkspaceRef[],
  max = 3,
): { shown: WorkspaceRef[]; more: number; title: string } {
  const sorted = [...workspaces].sort((a, b) => a.name.localeCompare(b.name));
  return {
    shown: sorted.slice(0, max),
    more: Math.max(0, sorted.length - max),
    title: sorted.length ? `Shared with: ${sorted.map((w) => w.name).join(', ')}` : '',
  };
}

// ── Folder confirm ──────────────────────────────────────────────────────

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** The folder confirm (plan 7.1, S5): how many items gain or lose. */
export function folderConfirmText(
  change: GrantChange,
  preview: Pick<FolderGrantPreview, 'gain' | 'lose' | 'tooBig'>,
): string {
  const parts: string[] = [];
  const verb = (n: number, v: string) => (n === 1 ? `${v}s` : v);
  if (preview.gain > 0)
    parts.push(`${plural(preview.gain, 'item')} ${verb(preview.gain, 'gain')} ${change.name}.`);
  if (preview.lose > 0)
    parts.push(`${plural(preview.lose, 'item')} ${verb(preview.lose, 'lose')} ${change.name}.`);
  if (parts.length === 0) parts.push('No item in it changes.');
  return parts.join(' ');
}

export const FOLDER_CONFIRM_NOTE =
  'Items in a folder take its workspaces. Items changed by hand keep their own.';
export const TOO_BIG_TEXT = 'This folder holds too many items. Share the sub-folders one by one.';

/** The app holder-add confirm (21.8 row 13): both effects, always. */
export function appHolderLines(
  name: string,
  holders: readonly string[],
  counts?: { rows: number | null; exportedTables: number },
): string[] {
  const what = counts
    ? [
        counts.rows !== null ? plural(counts.rows, 'row') : null,
        counts.exportedTables > 0 ? plural(counts.exportedTables, 'exported table') : null,
      ].filter(Boolean)
    : [];
  const data = what.length
    ? `This app's data (${what.join(', ')}) becomes visible to ${name}.`
    : `This app's data becomes visible to ${name}.`;
  const all = [...holders, name];
  const reads =
    all.length > 2
      ? `This app will then read only items that ${joinAnd(all)} all hold.`
      : all.length === 2
        ? `This app will then read only items that ${joinAnd(all)} both hold.`
        : `This app will then read only items that ${name} holds.`;
  return [data, reads];
}

function joinAnd(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// ── Move ────────────────────────────────────────────────────────────────

/** "This will also be visible to: ..." (21.8 row 1), or null. */
export function alsoVisibleLine(p: Pick<MovePreview, 'alsoVisibleTo'>): string | null {
  if (!p.alsoVisibleTo.length) return null;
  return `This will also be visible to: ${p.alsoVisibleTo.map((w) => w.name).join(', ')}.`;
}

/** "It will no longer be readable in: ..." (21.8 row 9), or null. */
export function removedLine(
  p: Pick<MovePreview, 'removedFrom'>,
  kept: string | null = null,
): string | null {
  const gone = p.removedFrom.filter((w) => w.wsId !== kept);
  if (!gone.length) return null;
  return `It will no longer be readable in: ${gone.map((w) => w.name).join(', ')}.`;
}

/** The line once "Keep it readable in H" is ticked. */
export const keptLine = (name: string) => `It stays readable in ${name}, read only.`;

/** A move of an app that adds workspaces (S7, 21.8 row 13): both effects.
 *  `holders`: the app's workspaces after the move, when known. */
export function appMoveLines(added: readonly string[], holders?: readonly string[]): string[] {
  const data = `This app's data becomes visible to ${joinAnd(added)}.`;
  const reads =
    holders && holders.length > 1
      ? `This app will then read only items that ${joinAnd(holders)} ${holders.length === 2 ? 'both' : 'all'} hold.`
      : 'This app will then read only items that every workspace it is in holds.';
  return [data, reads];
}

/** A move that changes nothing about who sees it needs no confirm. */
export const moveChangesAccess = (p: MovePreview) =>
  p.alsoVisibleTo.length > 0 || p.removedFrom.length > 0;

export const keepReadableLabel = (name: string) => `Keep it readable in ${name}`;

// ── A folder's home move with what is inside it ─────────────────────────

const itemCount = (n: number) => (n === 1 ? '1 item' : `${n.toLocaleString('en')} items`);

/** The tick on a folder's home move (on by default). */
export const withContentsLabel = (n: number) => `Also move the ${itemCount(n)} inside`;

/** What the move with the contents leaves where it is, and the apps it
 *  takes along: one line each, or none. */
export function contentsLines(c: GrantMoveContentsPreview): string[] {
  const out: string[] = [];
  if (c.otherHome) {
    const hidden = c.hidden ? `, ${c.hidden.toLocaleString('en')} of them you cannot open` : '';
    out.push(
      `${itemCount(c.otherHome)} inside ${c.otherHome === 1 ? 'has' : 'have'} another home and ${c.otherHome === 1 ? 'stays' : 'stay'} there${hidden}.`,
    );
  }
  if (c.notAllowed) {
    out.push(
      `${itemCount(c.notAllowed)} inside cannot live in that workspace and ${c.notAllowed === 1 ? 'stays' : 'stay'} in the old home.`,
    );
  }
  if (c.apps) {
    out.push(
      c.apps === 1
        ? 'One app inside moves too: the new home sees its data.'
        : `${c.apps.toLocaleString('en')} apps inside move too: the new home sees their data.`,
    );
  }
  return out;
}

/** The note after a folder's move with its contents: what stayed, or
 *  null. */
export function contentsLeftText(res: Pick<GrantMoveResponse, 'contents'>): string | null {
  const n = res.contents?.leftAloneCount ?? 0;
  if (!n) return null;
  return `${itemCount(n)} inside stayed where ${n === 1 ? 'it was' : 'they were'}: another home, or a kind that workspace cannot hold.`;
}

// ── Errors ──────────────────────────────────────────────────────────────

/** The brain's own words (`{ error, code }`), shown as is. */
export function grantErrorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.message) return err.message;
  return fallback;
}

export function grantErrorCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const code = err.body?.code;
  return typeof code === 'string' ? code : null;
}

/** A brain before W5b has no /api/grants: its 404 carries no grants code. */
export const isNoGrants = (err: unknown) =>
  err instanceof ApiError && err.status === 404 && grantErrorCode(err) === null;

/** The item is hidden from this user or removed (a 404 with the brain's
 *  code), not an old brain. */
export const isItemGone = (err: unknown) =>
  err instanceof ApiError && err.status === 404 && grantErrorCode(err) !== null;

export const ITEM_GONE_TEXT = 'This item is no longer visible to you.';

// ── What a write sends (pure, so the confirm rules are tested) ────────

export type GrantRequest = { url: string; method: 'POST' | 'PATCH' | 'DELETE'; body?: object };

/** Adding a workspace: a folder and an app need `confirm` (contract 2, 3). */
export function addRequest(nodeId: string, wsId: string, type: string | undefined): GrantRequest {
  const confirm = type === 'branch' || type === 'app';
  return {
    url: grantsUrl(nodeId),
    method: 'POST',
    body: { wsId, ...(confirm ? { confirm: true } : {}) },
  };
}

/** Removing a row: a folder's goes with `?confirm=1`. */
export function removeRequest(
  nodeId: string,
  wsId: string,
  type: string | undefined,
): GrantRequest {
  return { url: withConfirm(grantUrl(nodeId, wsId), type === 'branch'), method: 'DELETE' };
}

/** The folder confirm's words, or Cancel only when it is too big. */
export function folderConfirm(
  change: GrantChange,
  preview: Pick<FolderGrantPreview, 'gain' | 'lose' | 'tooBig'> | null,
): { title: string; lines: string[]; blocked: boolean } {
  return {
    title: change.add
      ? `Share this folder with ${change.name}?`
      : `Remove ${change.name} from this folder?`,
    lines: preview
      ? preview.tooBig
        ? [TOO_BIG_TEXT]
        : [folderConfirmText(change, preview)]
      : ['Items in it take this change.'],
    blocked: preview?.tooBig === true,
  };
}

// ── Upload into a folder ────────────────────────────────────────────────

/** Who reads what lands in a folder (S6), when it is shared beyond its home:
 *  every row that is not removed here. Null when nobody else reads it. */
export function uploadVisibleTo(
  view: Pick<GrantsView, 'rows'> | null | undefined,
): string[] | null {
  const live = (view?.rows ?? []).filter((r) => !r.excluded);
  if (!live.some((r) => !r.isHome)) return null;
  return live.map((r) => r.name);
}

/** The question before an upload into a shared folder. */
export function uploadLine(names: readonly string[], count: number): string {
  const what = count === 1 ? 'This file' : `These ${count} files`;
  return `${what} will also be visible to: ${names.join(', ')}.`;
}

// ── The open link's served list (plan 8.1, contract 30 and 32) ─────────

/** A folder offers at most this many items to serve (the brain's
 *  FOLDER_SERVE_OFFER_MAX). */
export const FOLDER_SERVE_OFFER_MAX = 500;

export type ServeRow = { nodeId: string; title: string; kind: string; served: boolean };

/** The panel's served list: each item the user may put on the link, ticked
 *  when the link serves it. Ids compare lower-case (the brain stores them so). */
export function serveRows(
  view: Pick<GrantsView, 'link' | 'serveCandidates'> | null | undefined,
): ServeRow[] {
  const served = new Set((view?.link?.served ?? []).map(servedId));
  return (view?.serveCandidates ?? []).map((c) => ({
    nodeId: c.nodeId,
    title: c.title,
    kind: c.kind,
    served: served.has(c.nodeId.toLowerCase()),
  }));
}

/** Served items this user cannot change here (not among the candidates):
 *  they stay on the list on every write. `title` null: the user cannot read
 *  it (or it is gone). */
export function servedElsewhere(
  view: Pick<GrantsView, 'link' | 'serveCandidates'> | null | undefined,
): { nodeId: string; title: string | null }[] {
  const offered = new Set((view?.serveCandidates ?? []).map((c) => c.nodeId.toLowerCase()));
  return (view?.link?.served ?? [])
    .filter((e) => !offered.has(servedId(e)))
    .map((e) => ({ nodeId: servedId(e), title: e.title }));
}

/** The served list after ticking (`on`) or clearing items. The list is sent
 *  whole (PATCH /api/shares/:id { serve }): items the user cannot change
 *  stay on it. */
export function nextServed(
  view: Pick<GrantsView, 'link' | 'serveCandidates'>,
  ids: readonly string[],
  on: boolean,
): string[] {
  const change = new Set(ids.map((id) => id.toLowerCase()));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of view.link?.served ?? []) {
    const k = servedId(e);
    if (seen.has(k) || (!on && change.has(k))) continue;
    seen.add(k);
    out.push(k);
  }
  if (on) {
    for (const k of change) {
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

/** What a link write sends: make it (POST /api/shares, with `serve` when
 *  given) or change its served list (PATCH /api/shares/:id). */
export function linkCreateRequest(nodeId: string, serve?: readonly string[]): GrantRequest {
  return {
    url: '/api/shares',
    method: 'POST',
    body: serve === undefined ? { nodeId } : { nodeId, serve: [...serve] },
  };
}

export function linkServeRequest(shareId: string, serve: readonly string[]): GrantRequest {
  return {
    url: `/api/shares/${encodeURIComponent(shareId)}`,
    method: 'PATCH',
    body: { serve: [...serve] },
  };
}

/** The line over the served list. */
export function servedHint(type: string | undefined): string {
  return type === 'branch'
    ? 'People with the link see the folder. Tick the items in it they can also open.'
    : 'People with the link see this item. Tick what it shows that they can also open.';
}

/** How many items the link serves besides the item, for the summary line. */
export function servedCountText(n: number): string {
  if (n === 0) return 'The link shows only this item.';
  return `The link also shows ${n === 1 ? 'one item' : `${n} items`}.`;
}

/** Served items this user cannot change here, named when the brain sends
 *  their titles. Null when none. */
export function servedElsewhereText(items: readonly { title: string | null }[]): string | null {
  const n = items.length;
  if (n === 0) return null;
  const named = items.map((i) => i.title).filter((t): t is string => !!t);
  const hidden = n - named.length;
  const names = [
    ...named,
    ...(hidden
      ? [hidden === 1 ? 'one item you cannot open' : `${hidden} items you cannot open`]
      : []),
  ];
  const lead = n === 1 ? 'One more item stays' : `${n} more items stay`;
  const it = n === 1 ? 'it' : 'them';
  return named.length
    ? `${lead} on the list: ${names.join(', ')}. You cannot change ${it} here.`
    : `${lead} on the list. You cannot change ${it} here.`;
}

/** A folder offers only the first FOLDER_SERVE_OFFER_MAX items in it that
 *  the user may edit. */
export function serveCappedText(type: string | undefined, offered: number): string | null {
  return type === 'branch' && offered >= FOLDER_SERVE_OFFER_MAX
    ? `Only the first ${FOLDER_SERVE_OFFER_MAX} items in this folder that you can edit are listed here.`
    : null;
}

/** Said when the link changed under the panel (another user, another tab). */
export const LINK_CHANGED_TEXT = 'This link changed. Check the list again.';

/** The brain's 404 for a link that is gone (revoked by another user or tab
 *  after the panel read it). Only that 404: any other 404 is thrown. */
function isLinkGone(e: ApiError): boolean {
  return e.status === 404 && (e.body?.error === 'not_found' || e.message === 'not_found');
}

/** A served-list write: the panel's view can be old, and the brain replaces
 *  the whole list, so a write from it could put back an item another user
 *  took off. Read the link again first and apply only this change to what
 *  it serves now. 'changed' when the link is gone or is another link now,
 *  when the brain refuses with 409, or when the link went between the read
 *  and the write (404 not_found); the caller then shows LINK_CHANGED_TEXT
 *  and loads the panel again. Other refusals are thrown. */
export async function sendServeChange(
  deps: {
    read: () => Promise<Pick<GrantsView, 'link' | 'serveCandidates'>>;
    send: (req: GrantRequest) => Promise<unknown>;
  },
  linkId: string,
  ids: readonly string[],
  on: boolean,
): Promise<'done' | 'changed'> {
  const fresh = await deps.read();
  if (!fresh.link || fresh.link.id !== linkId) return 'changed';
  try {
    await deps.send(linkServeRequest(linkId, nextServed(fresh, ids, on)));
  } catch (e) {
    if (e instanceof ApiError && (e.status === 409 || isLinkGone(e))) return 'changed';
    throw e;
  }
  return 'done';
}
