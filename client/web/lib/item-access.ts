/**
 * What the brain says a login may do with one item, as the item screens read
 * it (workspaces W6b, fix round contract changes 1 and 2). Every list row and
 * item response of pages, notes, drawings, tables, files and apps carries the
 * caller's ItemCaps (lib/contract/grants.ts):
 *
 * - `mayEdit`: the login may change it. False: no editor.
 * - `mayManage`: the login may delete it, share it and move it anywhere (a
 *   Moderator of its home). False: no Delete, no Grant Access.
 * - `mayMove`: the login may move it (a Moderator of its home, or of a
 *   workspace that holds it: a shared item moves inside that workspace,
 *   the brain refuses a folder outside it). False: no Move. A brain before
 *   it sends none: Move follows `mayManage`.
 * - `readOnly: true` with `snapshotOf`: a snapshot copy of an accepted item
 *   (the author's copy, in its private or Former user workspace). Nobody
 *   edits it, moves it or shares it; its author may delete it.
 *
 * A field the brain does not send (a brain before the fix round) leaves that
 * control on: the brain decides each write, and a refusal shows in its own
 * words.
 *
 * Pure: pinned by item-access.test.ts.
 */
import { ApiError } from '@mantle/web-ui/api-fetch';
import type { ItemCaps } from './contract/grants';

export type { ItemCaps };

/** The note an item screen shows on a snapshot copy. */
export const SNAPSHOT_COPY_NOTE =
  'This is your copy of an item that was accepted into the brain. It is read only. You can delete it.';

/** The note an item screen shows when the login may read the item but not
 *  change it. */
export const NO_EDIT_NOTE = 'You can read this item. You cannot change it.';

/** Whether the item is a read-only snapshot copy: `readOnly: true`, or (a
 *  brain that sends only the copy's source) a non-empty `snapshotOf`. */
export function isReadOnlyItem(item: object | null | undefined): boolean {
  if (!item) return false;
  const it = item as { readOnly?: unknown; snapshotOf?: unknown };
  return it.readOnly === true || (typeof it.snapshotOf === 'string' && it.snapshotOf !== '');
}

/** What the item screens offer for one item. */
export type ItemAccess = {
  /** A read-only snapshot copy. */
  copy: boolean;
  /** The editor, the draft controls, the import and the rename. */
  edit: boolean;
  /** Delete. */
  manage: boolean;
  /** Move: drag, the Move menu, a new parent or folder (`mayMove`, else
   *  `mayManage`). */
  move: boolean;
  /** Grant Access. */
  share: boolean;
};

/** The caps of an item, as the screens use them. Only an explicit `false`
 *  turns a control off; a snapshot copy is never edited, moved or shared. */
export function itemAccess(item: object | null | undefined): ItemAccess {
  const it = (item ?? {}) as { mayEdit?: unknown; mayManage?: unknown; mayMove?: unknown };
  const copy = isReadOnlyItem(item);
  const manage = it.mayManage !== false;
  const move = it.mayMove === undefined ? manage : it.mayMove !== false;
  return {
    copy,
    edit: !copy && it.mayEdit !== false,
    manage,
    move: move && !copy,
    share: manage && !copy,
  };
}

/** The note to show under an item's header: why there is no editor. Null
 *  when the login may edit it. */
export function readOnlyNote(access: Pick<ItemAccess, 'copy' | 'edit'>): string | null {
  if (access.copy) return SNAPSHOT_COPY_NOTE;
  return access.edit ? null : NO_EDIT_NOTE;
}

/** Whether an error is the brain's workspace refusal of a change: a 403
 *  whose reason is `item-workspace` (its code is the generic `forbidden`).
 *  A read-only copy's refusal may carry the same reason with `readOnly`,
 *  and says its own words, so it is not one. Any other 403 is not one
 *  either. */
export function isItemWorkspaceRefusal(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 403) return false;
  const body = err.body ?? {};
  if (body.readOnly === true) return false;
  return body.reason === 'item-workspace';
}
