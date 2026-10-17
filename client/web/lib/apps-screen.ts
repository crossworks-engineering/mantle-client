/**
 * The admin's /apps screen on the item tree (2026-10-09): the URL rules and
 * the copy it shares with its tests. Pure, so the rules are testable without
 * a DOM.
 *
 * /apps is the same folder view as Pages, Notes, Tables, Draw and Files: the
 * tree in the list column (search in `?q=`), the picked app in `?id=`, and
 * the app's own screen at /apps/<id> (Builder, Code, History, Activity and
 * the switches).
 */
import { apiFetch } from '@mantle/web-ui/api-fetch';
import type { AppDetail, AppRestoreMode } from '@mantle/client-types';
import {
  SNAPSHOT_COPY_NOTE,
  isItemWorkspaceRefusal,
  itemAccess,
  readOnlyNote,
} from './item-access';

/**
 * One app as its own screen reads it (GET /api/apps/:id), cached at
 * `['apps', id]` as the route answers it: `{ app }`. Every screen that reads
 * one app goes through this, so the cache entry has one shape. The /apps pane
 * once cached the bare app under the same key, and opening the app's own
 * screen from there read `data.app` as undefined and crashed.
 */
export const appDetailKey = (id: string) => ['apps', id] as const;
export function appDetailQuery(id: string) {
  return {
    queryKey: appDetailKey(id),
    queryFn: () => apiFetch<{ app: AppDetail }>(`/api/apps/${encodeURIComponent(id)}`),
    retry: false as const,
  };
}

/** Params the old /apps screens wrote that this one does not read: the paged
 *  list's `sort`, the old member app review's `review` (gone in W5c), and
 *  the list's `page` once the tree is the list. */
const LEGACY_ALWAYS = ['sort', 'review'] as const;
const LEGACY_IN_TREE = ['page'] as const;

/**
 * Where an old /apps link lands: the same screen with the params it no longer
 * reads dropped, and `?selected=<id>` (the other workspaces' deep link) read
 * as `?id=`. Null when the URL is already current. `tree`: whether the list
 * is the item tree (a brain that serves it) rather than the paged list.
 */
export function appsLegacyHref(
  params: Pick<URLSearchParams, 'get' | 'has' | 'toString'>,
  tree: boolean,
): string | null {
  const drop: string[] = [...LEGACY_ALWAYS, ...(tree ? LEGACY_IN_TREE : [])];
  const selected = params.get('selected');
  if (!drop.some((k) => params.has(k)) && selected === null) return null;
  const next = new URLSearchParams(params.toString());
  for (const k of drop) next.delete(k);
  next.delete('selected');
  if (selected && !next.get('id')) next.set('id', selected);
  const qs = next.toString();
  return qs ? `/apps?${qs}` : '/apps';
}

/** The app the URL opens: `?id=`, else an old `?selected=`. */
export function appsUrlId(params: Pick<URLSearchParams, 'get'>): string | null {
  return params.get('id')?.trim() || params.get('selected')?.trim() || null;
}

/** Delete moves an app to the brain's trash (GET /api/apps/deleted), its
 *  code and data kept as a snapshot. The brain owner's delete (`isOwner` on
 *  GET /api/shell) is removed after 30 days. */
export const APP_DELETE_CONFIRM =
  'It moves to the trash: restore it under Recently deleted apps for 30 days, with its code and data. No one can run it until then.';
export const APP_DELETED_TOAST =
  'Moved to the trash. Restore it under Recently deleted apps for 30 days.';

/** A delete by any login that is not the brain's owner, an Admin user too
 *  (W6b fix round 2): the app stays in the brain's trash until the owner
 *  deletes it for good (the nightly sweep never removes it). No days:
 *  nothing counts down. */
export const HELD_APP_DELETE_CONFIRM =
  'It moves to the trash with its code and data. No one can run it there. It stays in the trash until the brain owner deletes it for good.';
export const HELD_APP_DELETED_TOAST =
  'Moved to the trash. It stays there until the brain owner deletes it for good.';

/** The delete confirm and toast for this login: the 30-day text for the
 *  brain owner only (useIsBrainOwner), the held text for anyone else. */
export function appDeleteCopy(isOwner: boolean): { confirm: string; toast: string } {
  return isOwner
    ? { confirm: APP_DELETE_CONFIRM, toast: APP_DELETED_TOAST }
    : { confirm: HELD_APP_DELETE_CONFIRM, toast: HELD_APP_DELETED_TOAST };
}

/** The note on an app that was in its author's own trash when the personal
 *  spaces were folded into the brain (W6b contract item 4). */
export const APP_WAS_IN_TRASH =
  'This app was in your trash. It is yours again: keep it, or delete it.';

/** Whether the brain marks the app as one that was in its author's trash
 *  (`trashedBeforeFold`, W6b). False when the brain sends nothing. */
export function wasInTrash(app: object): boolean {
  return (app as { trashedBeforeFold?: unknown }).trashedBeforeFold === true;
}

/** The hint under the Access panel: what a workspace grant means for an app. */
export const APP_SHARE_HINT =
  'Users in a workspace it is shared with can run the app and use its MantleOS tools. With Writable on, they also change its data. Every action is audited to that user. An open link can only read the app’s own data.';

/**
 * Whether the login may change the app's code (brain F4): saving or
 * discarding the draft, Preview (the build) and Commit (the publish) need
 * the app's manage right, a Moderator of its workspace, besides edit; the
 * brain answers 403 to a login that edits but does not manage it. Read from
 * the caps every app answer carries (`mayEdit`, `mayManage`); a brain that
 * sends none leaves it on, and its refusal shows as appCodeErrorText.
 */
export function canChangeAppCode(app: object | null | undefined): boolean {
  const access = itemAccess(app);
  return access.edit && access.manage;
}

/** Why the code controls are off for a login that cannot change the code. */
export const APP_CODE_MANAGE_TEXT =
  "Only a Moderator of this app's workspace can change its code, preview it or commit it.";

/** Why the code controls are off, in the words the Code tab shows: on a
 *  read-only snapshot copy the copy's note (nobody changes a copy, a
 *  Moderator included), else the Moderator sentence for a login that
 *  cannot change the code. Null when they are on. */
export function appCodeWhy(app: object | null | undefined): string | null {
  const access = itemAccess(app);
  if (access.copy) return readOnlyNote(access);
  return canChangeAppCode(app) ? null : APP_CODE_MANAGE_TEXT;
}

/** What a failed draft save, discard, Preview or Commit says: the
 *  workspace refusal (403 item-workspace) in plain words, else the brain's
 *  own (any other 403 included), else the fallback. On a snapshot copy
 *  (`copy`) the brain answers the plain workspace refusal with no
 *  `readOnly`, so the copy's note says it instead of the Moderator one. */
export function appCodeErrorText(
  err: unknown,
  fallback: string,
  { copy = false }: { copy?: boolean } = {},
): string {
  if (isItemWorkspaceRefusal(err)) return copy ? SNAPSHOT_COPY_NOTE : APP_CODE_MANAGE_TEXT;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** Why a History restore is off (F4 audit L1): a code or full restore
 *  writes the draft, so it is off whenever the code controls are, with the
 *  same words (`codeWhy`, from appCodeWhy: the copy's note on a snapshot
 *  copy, else the Moderator sentence); a data restore does not touch the
 *  code and stays open (the brain decides it). Null when open. */
export function restoreBlockedReason(mode: AppRestoreMode, codeWhy: string | null): string | null {
  return mode !== 'data' ? codeWhy : null;
}

/** What a failed History restore says: a code or full restore's workspace
 *  refusal in plain words (appCodeErrorText, the copy's note on a snapshot
 *  copy); a data restore keeps the brain's own words, as a Moderator
 *  sentence about code would be wrong. */
export function restoreErrorText(
  err: unknown,
  mode: AppRestoreMode,
  { copy = false }: { copy?: boolean } = {},
): string {
  const fallback = 'Could not restore.';
  if (mode !== 'data') return appCodeErrorText(err, fallback, { copy });
  return err instanceof Error && err.message ? err.message : fallback;
}
