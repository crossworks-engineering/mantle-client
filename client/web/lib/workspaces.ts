/**
 * Workspaces (plan 4887b8e7, phases W5a and W5b2): the pure rules the
 * workspace screens and the switcher follow, so each rule is unit-tested
 * (workspaces.test.ts) without a browser. The switcher filters the lists
 * that echo the workspace they were asked for (lib/workspace-filter.ts).
 *
 * The wire shapes are lib/contract/workspaces.ts: a verbatim copy of mantle
 * packages/client-types/src/dto/workspaces.ts (brain W5b2 part B,
 * 69a2ccd15). Replace the copy by hand when the brain's file changes.
 */
import { ApiError } from '@mantle/web-ui/api-fetch';
import { formatDate } from '@mantle/web-ui/lib/format-datetime';

import type {
  ShellWorkspace,
  Workspace,
  WorkspaceArchivePreview,
  WorkspaceConnectorKind,
  WorkspaceConnectorOption,
  WorkspaceDetailResponse as WorkspaceDetail,
  WorkspaceResource,
  WorkspaceUser,
  WorkspaceUserSearchHit as UserSearchHit,
} from './contract/workspaces';
import type { ShellRole } from './contract/shell';

export type {
  ShellWorkspace,
  Workspace,
  WorkspaceConnectorKind,
  WorkspaceConnectorOption,
  WorkspaceDetailResponse as WorkspaceDetail,
  WorkspaceResource,
  WorkspaceUser,
  WorkspaceUserSearchHit as UserSearchHit,
} from './contract/workspaces';

export type ArchivePreview = WorkspaceArchivePreview;

export const WORKSPACES_KEY = ['workspaces'] as const;
export const workspaceKey = (id: string) => ['workspaces', id] as const;

// ── Areas (plan 1.4: requireArea) ───────────────────────────────────────────

/** The Admin areas the brain names in /api/shell `areas`. */
export const AREAS = ['settings', 'users', 'assistants', 'connectors', 'keys'] as const;
export type Area = (typeof AREAS)[number];

/** Whether the login may manage this area. A brain before W5a sends no
 *  `areas`: it answers /api/shell only for an admin, who has all of them. */
export function hasArea(areas: readonly string[] | null | undefined, area: Area): boolean {
  return areas == null ? true : areas.includes(area);
}

/**
 * THE table of which area each screen needs (phase W5c: one shell for every
 * login). A row is a path prefix, matched as whole segments (`/settings/users`
 * covers `/settings/users/x`, not `/settings/usersx`); the first match wins,
 * so the narrower rows sit above `/settings`. `null`: open to every login.
 * `/` matches the home only. A path no row names needs `settings`: in W5c
 * every login that is not an admin holds no area, so for it only the `null`
 * rows are open.
 */
export const PATH_AREAS: ReadonlyArray<readonly [prefix: string, area: Area | null]> = [
  // Open to every login: the home, the workspace screens, and the screens
  // about the login itself.
  ['/', null],
  ['/files', null],
  ['/notes', null],
  ['/pages', null],
  ['/draw', null],
  ['/tables', null],
  ['/apps', null],
  ['/n', null],
  ['/settings/workspaces', null],
  ['/settings/mcp', null],
  ['/settings/api-access', null],
  // Every login pairs its own Telegram chat and lists its own chats (W7d).
  ['/settings/telegram', null],
  // Every login chats with its own assistants, in its own threads (W7c).
  ['/assistant', null],
  // Settings screens with an area of their own.
  ['/settings/users', 'users'],
  ['/settings/agents', 'assistants'],
  ['/settings/ai-workers', 'assistants'],
  ['/settings/worker-groups', 'assistants'],
  ['/settings/heartbeats', 'assistants'],
  ['/settings/skills', 'assistants'],
  ['/settings/connectors', 'connectors'],
  ['/settings/tool-groups', 'connectors'],
  ['/settings/tools', 'connectors'],
  ['/settings/peers', 'connectors'],
  ['/settings/keys', 'keys'],
  // Every other settings screen.
  ['/settings', 'settings'],
  // The brain's own screens: whoever manages the brain's settings.
  ['/journal', 'settings'],
  ['/inbox', 'settings'],
  ['/recall', 'settings'],
  ['/formulas', 'settings'],
  ['/events', 'settings'],
  ['/contacts', 'settings'],
  ['/secrets', 'settings'],
  ['/docs', 'settings'],
  ['/models', 'settings'],
  ['/pending', 'settings'],
  ['/nodes', 'settings'],
  ['/heartbeats', 'settings'],
  ['/studio', 'settings'],
  ['/dev-tools', 'settings'],
  ['/runners', 'settings'],
  ['/runs', 'settings'],
  ['/sandboxes', 'settings'],
  ['/traces', 'settings'],
  ['/debug', 'settings'],
  // The brain health Dashboard (task d78e7bde: no longer the home; every
  // login lands on its workspace's landing page at `/`).
  ['/dashboard', 'settings'],
  // /changelog reads GET /api/changelog, which the brain answers for an
  // admin only: the rail shows a login without this area the build as
  // plain text (components/layout/changelog-link.tsx).
  ['/changelog', 'settings'],
  ['/tasks', 'settings'],
  // The first-run wizard sets up the brain (outside the shell: onboardingExit).
  ['/onboarding', 'settings'],
];

function underPrefix(pathname: string, prefix: string): boolean {
  if (prefix === '/') return pathname === '/';
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** The area a path needs (PATH_AREAS), or null when every login may open it. */
export function areaForPath(pathname: string): Area | null {
  const path = pathname.split(/[?#]/)[0] || '/';
  for (const [prefix, area] of PATH_AREAS) {
    if (underPrefix(path, prefix)) return area;
  }
  return 'settings';
}

/** Whether the login may open this path, by the areas it holds. */
export function mayOpenPath(
  areas: readonly string[] | null | undefined,
  pathname: string,
): boolean {
  const area = areaForPath(pathname);
  return area === null || hasArea(areas, area);
}

/**
 * Where /onboarding sends a login: home when it does not hold the settings
 * area (a member typed the address; the wizard's routes answer
 * an admin only), else null (stay). Null too until the shell has answered.
 * /onboarding is outside the shell, so its gate asks this itself.
 */
export function onboardingExit(shell: { areas?: unknown } | null | undefined): '/' | null {
  if (!shell) return null;
  return mayOpenPath(shellAreasOf(shell), '/onboarding') ? null : '/';
}

/**
 * Whether the shell sends a login to the first-run wizard: not onboarded yet
 * AND it holds the settings area. A login without that area must stay: the
 * wizard sends it home again (onboardingExit), so a redirect here would loop
 * between / and /onboarding. Onboarding is an admin's.
 */
export function goesToOnboarding(
  shell: { onboarded?: unknown; areas?: unknown } | null | undefined,
): boolean {
  if (!shell || shell.onboarded) return false;
  return hasArea(shellAreasOf(shell), 'settings');
}

// ── Who may change what ────────────────────────────────────────────────────

/**
 * Whether the login manages this workspace: a Moderator of it, or a login
 * with the Users and workspaces area (plan R7: Admin users manage a
 * workspace's name, assistant and connectors). The brain checks again; this
 * only decides what the screen offers.
 */
export function canManageWorkspace(
  ws: Pick<Workspace, 'me' | 'archived'>,
  areas: readonly string[] | null | undefined,
): boolean {
  if (ws.archived) return false;
  return ws.me.moderator || hasArea(areas, 'users');
}

/** The built-in workspace: the brain's `builtIn` (Admin only since brain
 *  migration 0286; Admin and Team before), else (a brain before contract
 *  change 20) the two marks only they carried. */
export function isBuiltIn(
  ws: Pick<Workspace, 'isAdmin' | 'adminModerated'> & { builtIn?: boolean },
): boolean {
  return ws.builtIn ?? (ws.isAdmin || ws.adminModerated);
}

/** The member settings (the read posture, a brain-wide switch; Team
 *  admin's settings before W5c, on the built-in Team workspace's screen
 *  until brain migration 0286 made Team a normal workspace) show on the
 *  Admin workspace's screen, to an Admin user with the settings area. */
export function showsMemberSettings(
  ws: Pick<Workspace, 'isAdmin' | 'archived'>,
  areas: readonly string[] | null | undefined,
): boolean {
  return !ws.archived && ws.isAdmin && hasArea(areas, 'settings');
}

/**
 * May the login set this workspace's landing page (task d78e7bde)? A
 * Moderator of it only: no Admin area stands in (the brain answers 403
 * forbidden). Never on an archived workspace.
 */
export function canSetLanding(ws: Pick<Workspace, 'me' | 'archived'>): boolean {
  return !ws.archived && ws.me.moderator;
}

/** What the name field says on a built-in workspace (change 19: 409
 *  reserved_name on a rename). */
export const BUILT_IN_NAME_HINT = 'Built-in workspaces keep their names.';

/** Whether the screen offers Archive: a managed workspace that is not built
 *  in (the brain refuses Admin; Team too before brain migration 0286). */
export function canArchiveWorkspace(
  ws: Pick<Workspace, 'me' | 'archived' | 'isAdmin' | 'adminModerated'> & { builtIn?: boolean },
  areas: readonly string[] | null | undefined,
): boolean {
  return !isBuiltIn(ws) && canManageWorkspace(ws, areas);
}

/** The contact is set by an Admin user (the brain refuses anyone else),
 *  read here as the Users and workspaces area. */
export function canSetContact(areas: readonly string[] | null | undefined): boolean {
  return hasArea(areas, 'users');
}

/** Who is looking, as the shell names them: the login id (GET /api/shell
 *  `loginId`), and the email for a brain that sends no id. */
export type WorkspaceViewer = { loginId?: string | null; email?: string | null };

/**
 * Whether a user row is the viewer's own: by login id when the shell names
 * one, else by email; null when the viewer is not known yet (no shell). A
 * caller decides what unknown means, toward the side the brain still
 * checks (it refuses what the screen should not have offered).
 */
export function isViewerRow(
  user: Pick<WorkspaceUser, 'loginId' | 'email'>,
  viewer: WorkspaceViewer | null | undefined,
): boolean | null {
  const id = viewer?.loginId?.trim().toLowerCase();
  if (id) return user.loginId.trim().toLowerCase() === id;
  const email = viewer?.email?.trim().toLowerCase();
  if (email) return user.email.trim().toLowerCase() === email;
  return null;
}

/** Remove on a user row: never the viewer's own row in Admin (leaving Admin
 *  is the change to a member login; the brain refuses it, 403 self_demote).
 *  An unknown viewer keeps it on: the brain refuses that one. */
export function canRemoveUser(
  ws: Pick<Workspace, 'isAdmin'>,
  user: Pick<WorkspaceUser, 'loginId' | 'email'>,
  viewer: WorkspaceViewer | null | undefined,
): boolean {
  return !ws.isAdmin || isViewerRow(user, viewer) !== true;
}

/**
 * The colour and icon field (task 5edc9149): only from a brain that sends
 * the look (an older one refuses a look PATCH as "Nothing to update"), for
 * whoever may rename the workspace (canManageWorkspace), the same on every
 * workspace: on Admin its Moderators are Admin users.
 */
export function canSetLook(
  ws: Pick<Workspace, 'kind' | 'me' | 'archived'>,
  areas: readonly string[] | null | undefined,
): boolean {
  return ws.kind !== undefined && canManageWorkspace(ws, areas);
}

/** Who ticks or clears Moderator (brain migration 0286, owner decision
 *  2026-10-13): an Admin user, read here as the Users and workspaces area.
 *  A Moderator outside Admin still adds and removes users; the brain
 *  answers 403 admin_only to their tick. */
export function canTickModerator(areas: readonly string[] | null | undefined): boolean {
  return hasArea(areas, 'users');
}

/** Why the Moderator switch is off for a Moderator who is not an Admin user. */
export const MODERATOR_TICK_ADMIN_ONLY_TEXT = 'Only an Admin user can change the Moderator switch.';

/** An Admin user kept as a Moderator here: why their Remove is off. */
export const REMOVE_ADMIN_KEPT_TEXT =
  'Admin users stay in this workspace. To remove one, remove them from the Admin workspace.';
/** The viewer's own row in Admin: why their Remove is off. */
export const REMOVE_SELF_ADMIN_TEXT = 'You cannot remove yourself from the Admin workspace.';

/** Another Moderator's row, for a Moderator who is not an Admin user: why
 *  their Remove is off (removing a Moderator takes the tick away, so the
 *  brain asks the same as for the tick: 403 admin_only). */
export const REMOVE_MODERATOR_ADMIN_ONLY_TEXT = 'Only an Admin user can remove a Moderator.';

/**
 * Why Remove is off on a user row, or null when it may be used (task
 * 19790beb): every row keeps its Remove button, dimmed with this as its
 * tooltip when off, so the rows line up. canChangeUser, then canRemoveUser,
 * then the tick's own rule (canTickModerator) on another Moderator's row:
 * leaving, the viewer's own row, stays open to anyone. With the viewer not
 * known (isViewerRow null) no row is dimmed for that rule, so a Moderator
 * can always leave; the brain refuses another Moderator's removal (403
 * admin_only).
 */
export function removeBlockedReason(
  ws: Pick<Workspace, 'isAdmin'>,
  user: Pick<WorkspaceUser, 'adminViaArea' | 'loginId' | 'email' | 'moderator'>,
  viewer: WorkspaceViewer | null | undefined,
  areas: readonly string[] | null | undefined,
): string | null {
  if (!canChangeUser(user)) return REMOVE_ADMIN_KEPT_TEXT;
  if (!canRemoveUser(ws, user, viewer)) return REMOVE_SELF_ADMIN_TEXT;
  if (user.moderator && !canTickModerator(areas) && isViewerRow(user, viewer) === false) {
    return REMOVE_MODERATOR_ADMIN_ONLY_TEXT;
  }
  return null;
}

/** The assistant is picked with the Assistants area. */
export function canPickAssistant(areas: readonly string[] | null | undefined): boolean {
  return hasArea(areas, 'assistants');
}

/** An Admin user kept as a Moderator of Team is not demoted or removed
 *  there by anybody (contract change 14: 409 admin_kept). From a brain
 *  before migration 0286 only: no user is kept so since. */
export function canChangeUser(user: Pick<WorkspaceUser, 'adminViaArea'>): boolean {
  return !user.adminViaArea;
}

/**
 * Every Admin user moderates the Admin workspace, always (brain F4 fix
 * round 1, migration 0298; task b8eea6cf): the brain refuses to clear the
 * tick there (409 admin_workspace), and an add to Admin is one with the
 * tick. Every user of Admin is an Admin user (W5a), so on Admin each row's
 * switch is on and fixed, labelled Admin; Remove is unchanged (leaving
 * Admin is the change to a member login). Other workspaces: false.
 */
export function moderatorLockedByAdmin(ws: Pick<Workspace, 'isAdmin'>): boolean {
  return ws.isAdmin;
}

/**
 * Whether the login may add users to this workspace (F4 audit M1, owner
 * decision 2026-10-16): an add to the Admin workspace makes the person an
 * Admin user, so the brain asks for the Users and workspaces area
 * (canTickModerator) for any add there, and answers 403 admin_only
 * without it. Other workspaces: open (canManageWorkspace still decides
 * whether the screen offers Add at all).
 */
export function canAddToWorkspace(
  ws: Pick<Workspace, 'isAdmin'>,
  areas: readonly string[] | null | undefined,
): boolean {
  return !ws.isAdmin || canTickModerator(areas);
}

/** Why Add a user is off on the Admin workspace. */
export const ADMIN_ADD_AREA_TEXT =
  'Only an Admin user with the Users area can add people to the Admin workspace.';

/** What a failed add says: on Admin, the brain's 403 admin_only in plain
 *  words (ADMIN_ADD_AREA_TEXT); else as moderatorErrorText. */
export function addUserErrorText(err: unknown, ws: Pick<Workspace, 'isAdmin'>): string {
  if (ws.isAdmin && workspaceErrorCode(err) === 'admin_only') return ADMIN_ADD_AREA_TEXT;
  return moderatorErrorText(err);
}

/** Why the Moderator switch is fixed on the Admin workspace. */
export const ADMIN_WORKSPACE_MODERATOR_TEXT = 'Admin users always moderate the Admin workspace.';

/** What a Moderator change or an add says when it fails: the brain's 409
 *  admin_workspace in plain words (the same code also refuses archiving
 *  Admin, so it is mapped here, where only the tick can cause it), else
 *  the brain's own words. */
export function moderatorErrorText(err: unknown, fallback = 'Could not save.'): string {
  if (workspaceErrorCode(err) === 'admin_workspace') {
    return `${ADMIN_WORKSPACE_MODERATOR_TEXT} To take it away, remove them from the Admin workspace.`;
  }
  return workspaceErrorText(err, fallback);
}

/** "Added by NAME on DATE" (plan S1: every add shows on the screen), or
 *  null when the brain sends no date. */
export function addedText(
  user: Partial<Pick<WorkspaceUser, 'addedBy' | 'addedAt'>>,
): string | null {
  if (!user.addedAt || Number.isNaN(new Date(user.addedAt).getTime())) return null;
  const on = formatDate(user.addedAt);
  return user.addedBy?.name ? `Added by ${user.addedBy.name} on ${on}` : `Added on ${on}`;
}

// ── Words ──────────────────────────────────────────────────────────────────

/** The one sentence the screen shows for an admin-moderated workspace
 *  (plan 21.8 row 2: no magic, it is said on the screen). A brain before
 *  migration 0286 only: none is admin-moderated since. */
export const ADMIN_MODERATED_TEXT = 'Admin users moderate this workspace.';

/** The assistant has history here (plan 21.8 row 14). */
export const HAS_HISTORY_TEXT = 'Has history: clone to use elsewhere.';

/** The switcher's note while it filters nothing (W5a). */
export const SWITCHER_NOTE = 'Lists show the items of the workspace you pick.';

/** Said until the brain is seen filtering a list (useWsFilterHonoured). */
export const SWITCHER_NOTE_ALL = 'Lists show items from all your workspaces for now.';

/** The switcher's note: never claims a filter the brain does not apply. */
export const switcherNote = (honoured: boolean) => (honoured ? SWITCHER_NOTE : SWITCHER_NOTE_ALL);

export const ALL_WORKSPACES_LABEL = 'All my workspaces';

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A list card's second line: the users, and the assistant when there is
 *  one. (resourceCount counts the assistant too, so it is not "connectors".) */
export function workspaceMeta(ws: Pick<Workspace, 'userCount' | 'assistant'>): string {
  const users = plural(ws.userCount, 'user');
  return ws.assistant ? `${users} · ${ws.assistant.name}` : users;
}

/** Archive is refused while items have their home here (move them first). */
export function archiveBlocked(preview: ArchivePreview): boolean {
  return preview.itemCount > 0;
}

/** What the archive confirm says, with the counts the brain gave. */
export function archiveConfirmText(name: string, preview: ArchivePreview): string {
  if (archiveBlocked(preview)) {
    const items = plural(preview.itemCount, 'item');
    return `${items} ${preview.itemCount === 1 ? 'has its' : 'have their'} home in ${name}. Move ${preview.itemCount === 1 ? 'it' : 'them'} to another workspace first.`;
  }
  if (preview.grantCount === 0) {
    return `No items are shared with ${name}. Its users lose this workspace.`;
  }
  const shared = plural(preview.grantCount, 'item');
  return `${shared} shared with ${name} ${preview.grantCount === 1 ? 'loses' : 'lose'} that share. Users who read an item only through ${name} cannot read it after this.`;
}

/** The brain's own words for a failed call (`{ error, code }`), else a plain
 *  fallback. Shown as is. */
export function workspaceErrorText(err: unknown, fallback = 'Could not save.'): string {
  if (err instanceof ApiError && err.message) return err.message;
  return fallback;
}

/** The brain's error code, when it sent one. */
export function workspaceErrorCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const code = err.body?.code;
  return typeof code === 'string' ? code : null;
}

/** The name to show for a user: the display name, else the email. */
export function userLabel(u: { name: string | null; email: string }): string {
  return u.name?.trim() || u.email;
}

// ── Lists ──────────────────────────────────────────────────────────────────

/** Admin first, then by name; archived last. */
export function sortWorkspaces<T extends Pick<Workspace, 'name' | 'isAdmin' | 'archived'>>(
  list: readonly T[],
): T[] {
  return [...list].sort((a, b) => {
    if (a.archived !== b.archived) return a.archived ? 1 : -1;
    if (a.isAdmin !== b.isAdmin) return a.isAdmin ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** User search runs from this many characters for a Moderator (the brain's
 *  minimum). An Admin user may search with nothing typed: the full list. */
export const USER_SEARCH_MIN = 3;

export function userSearchMin(areas: readonly string[] | null | undefined): number {
  return userSearchPaged(areas) ? 0 : USER_SEARCH_MIN;
}

/** The full user list, in pages: the Users and workspaces area. */
export function userSearchPaged(areas: readonly string[] | null | undefined): boolean {
  return hasArea(areas, 'users');
}

/** How long user search waits after the last key. */
export const USER_SEARCH_DEBOUNCE_MS = 250;

export function userSearchReady(q: string, min = USER_SEARCH_MIN): boolean {
  return q.trim().length >= min;
}

/** An Admin user's search answers pages of this many. */
export const USER_SEARCH_PAGE = 50;

/** The offset of the next page, or undefined when there is none. Only an
 *  Admin user pages (a Moderator gets one answer of at most 10); a full page
 *  may have more behind it. */
export function nextUserSearchOffset(
  pages: readonly (readonly unknown[])[],
  paged: boolean,
): number | undefined {
  if (!paged) return undefined;
  const last = pages[pages.length - 1];
  return last && last.length >= USER_SEARCH_PAGE ? pages.length * USER_SEARCH_PAGE : undefined;
}

/** Search hits that are not in the workspace yet. */
export function addableHits(
  hits: readonly UserSearchHit[],
  users: readonly Pick<WorkspaceUser, 'loginId'>[],
): UserSearchHit[] {
  const inIt = new Set(users.map((u) => u.loginId));
  return hits.filter((h) => !inIt.has(h.loginId));
}

/** The workspaces a login is in, by name, from the details the screen has. */
export function workspacesOfLogin(
  details: readonly (WorkspaceDetail | undefined)[],
  loginId: string,
): Pick<Workspace, 'id' | 'name'>[] {
  const found = details.filter(
    (d): d is WorkspaceDetail =>
      !!d && !d.workspace.archived && d.users.some((u) => u.loginId === loginId),
  );
  return sortWorkspaces(found.map((d) => d.workspace)).map(({ id, name }) => ({ id, name }));
}

export const workspaceHref = (id: string) =>
  `/settings/workspaces?selected=${encodeURIComponent(id)}`;

// ── Resources (plan 1.4: one section per descriptor) ───────────────────────

/**
 * The resource types a workspace can hold. A new type is one more entry here
 * and one more value the brain accepts: no new screen. W5a has connectors;
 * the assistant is its own section (at most one).
 */
export type ResourceKind = {
  kind: string;
  /** The section heading. */
  label: string;
  /** One of them, in a sentence. */
  noun: string;
  /** What the Writable switch means for this type. */
  writeHint: string;
};

/** A resource's write column, its switch and its word on the read view
 *  (the grant panel's word). */
export const WRITABLE_LABEL = 'Writable';

/** Under an Admin user's name in a workspace's Users: why their Moderator
 *  tick is on and fixed. */
export const ADMIN_USER_MODERATOR_TEXT = 'Admin user: a Moderator here';

export const RESOURCE_KINDS: readonly ResourceKind[] = [
  {
    kind: 'connector',
    label: 'Connectors',
    noun: 'connector',
    writeHint:
      'Writable on: Moderators can use the tools that change data. Off, or for other users: read tools only.',
  },
];

/** The connectors not on the workspace yet: by slug against the
 *  workspace's resources, and none the brain says it holds. */
export function addableResources<T extends { slug: string; held?: boolean }>(
  all: readonly T[],
  resources: readonly WorkspaceResource[],
  kind: string,
): T[] {
  const held = new Set(resources.filter((r) => r.kind === kind).map((r) => r.id));
  return all.filter((c) => !held.has(c.slug) && c.held !== true);
}

/** A connector's kind as its small label in the add picker. */
export function connectorKindLabel(kind: WorkspaceConnectorKind): string {
  return kind === 'mcp' ? 'MCP' : 'API';
}

/** The brain has no GET /api/workspaces/:id/connector-options (an older
 *  brain): a 404 without a workspace refusal's code. A workspace the caller
 *  may not see is a 404 too, with `code: 'not_found'`. */
export function isMissingConnectorOptionsRoute(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404 && typeof err.body?.code !== 'string';
}

/** An older brain's add list: its MCP connectors (/api/mcp-connectors), all
 *  it offered before the brain answered the list itself. */
export function olderBrainConnectorOptions(
  connectors: readonly { slug: string; name: string }[],
): WorkspaceConnectorOption[] {
  return connectors.map((c) => ({ slug: c.slug, name: c.name, kind: 'mcp', held: false }));
}

// ── The switcher's choice (a per-login preference) ─────────────────────────

/** The switcher's value for "All my workspaces". */
export const ALL_WORKSPACES = 'all';

/** The choice to show: the stored one while it is still one of the login's
 *  workspaces, else All. */
export function resolveCurrentWorkspace(
  stored: string | null | undefined,
  workspaces: readonly Pick<ShellWorkspace, 'id'>[],
): string {
  if (stored && workspaces.some((w) => w.id === stored)) return stored;
  return ALL_WORKSPACES;
}

/** What the switcher calls the login's private workspace. */
export const PRIVATE_WORKSPACE_LABEL = 'Only you';

/** Whether this is the login's private workspace (where its own work lands
 *  when it names no other: the "Mine" of before W6b). The shell marks it
 *  with `private: true` (W6b fix round, contract change 3); its name is
 *  never the sign. */
export function isPrivateWorkspace(w: Pick<ShellWorkspace, 'private'>): boolean {
  return w.private === true;
}

/** A workspace's name in the switcher: "Only you" for the private one. */
export function workspaceLabel(w: Pick<ShellWorkspace, 'name' | 'private'>): string {
  return isPrivateWorkspace(w) ? PRIVATE_WORKSPACE_LABEL : w.name;
}

/** What the switcher's button says. */
export function currentWorkspaceLabel(
  current: string,
  workspaces: readonly Pick<ShellWorkspace, 'id' | 'name' | 'private'>[],
): string {
  const ws = workspaces.find((w) => w.id === current);
  return ws ? workspaceLabel(ws) : ALL_WORKSPACES_LABEL;
}

/** The shell's workspaces, as far as this client can read them: [] for a
 *  brain that sends none or something it does not know. */
export function shellWorkspacesOf(
  shell: { workspaces?: unknown } | null | undefined,
): ShellWorkspace[] {
  const raw = shell?.workspaces;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (w): w is ShellWorkspace =>
      !!w && typeof w === 'object' && typeof w.id === 'string' && typeof w.name === 'string',
  );
}

/** The shell's areas; undefined for a brain that sends none (all on). */
export function shellAreasOf(shell: { areas?: unknown } | null | undefined): string[] | undefined {
  const raw = shell?.areas;
  return Array.isArray(raw) ? raw.filter((a): a is string => typeof a === 'string') : undefined;
}

/** What the brain says a login is (GET /api/shell `role`, W5c contract:
 *  lib/contract/shell.ts). Since W6b every login reads its data on the same
 *  routes; the role picks the chat, the app runner and the byte routes. */
export type { ShellRole };

/**
 * The login's role from a loaded shell: null with no shell yet. A brain that
 * sends no role answered /api/shell for an admin only, so that is 'admin'.
 * There are two roles since W8 (no client login). A role this build does not
 * know reads as 'member' (fail closed: never the owner screens; what a member
 * reads is its workspaces', which the brain decides).
 */
export function shellRoleOf(shell: { role?: unknown } | null | undefined): ShellRole | null {
  if (!shell) return null;
  const role = shell.role;
  if (role === undefined || role === null) return 'admin';
  return role === 'admin' ? 'admin' : 'member';
}

/**
 * Whether a loaded shell names an Admin user: the brain's role 'admin' (a
 * brain that sends no role: everyone it answered). The screens hide what the
 * owner-only routes do for anyone else (W6b). False for no shell at all.
 */
export function isAdminUserShell(shell: { role?: unknown } | null | undefined): boolean {
  return shellRoleOf(shell) === 'admin';
}

/**
 * Whether a loaded shell names the brain's owner (its anchor login, the
 * brain's `isOwner`, W6b fix round 2): only the owner's app deletes are
 * removed after 30 days. A brain that sends no `isOwner` (before that round)
 * removes every Admin user's delete after 30 days, so it reads as
 * isAdminUserShell. False for no shell at all.
 */
export function isOwnerShell(
  shell: { role?: unknown; isOwner?: unknown } | null | undefined,
): boolean {
  if (!shell) return false;
  if (typeof shell.isOwner === 'boolean') return shell.isOwner;
  return isAdminUserShell(shell);
}

/** The nav without the screens the login may not manage (plan 7.1: screens
 *  hide by area). A group left empty goes too, and a hidden href leaves a
 *  collapsible group's cold-start head. */
export function navWithAreas<
  G extends { items: { href: string }[]; defaultHead?: readonly string[] },
>(groups: readonly G[], areas: readonly string[] | null | undefined): G[] {
  if (areas == null) return [...groups];
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => mayOpenPath(areas, i.href)),
      ...(g.defaultHead ? { defaultHead: g.defaultHead.filter((h) => mayOpenPath(areas, h)) } : {}),
    }))
    .filter((g) => g.items.length > 0);
}

// ── Admin workspace membership (W5a contract change 4) ─────────────────────

/** Until W5b a user of the Admin workspace IS an admin login: adding one is
 *  the role change to admin. Said where users are added to Admin. */
export const ADMIN_ADD_TEXT =
  'A user added here is an Admin user: they manage the brain and every workspace.';

/** What the remove confirm says. Leaving Admin is the change back to a
 *  member login, and it ends that login's sessions. */
export function removeUserText(ws: Pick<Workspace, 'name' | 'isAdmin'>, name: string): string {
  if (ws.isAdmin) {
    return `${name} stops being an Admin user and cannot manage the brain. Their sessions end, so they sign in again.`;
  }
  return `${name} stops reading the items shared with ${ws.name}, unless another of their workspaces has them.`;
}

/** Connectors on a workspace are set with the Connectors area (the brain
 *  answers 403 admin_only to anyone else). */
export function canSetConnectors(areas: readonly string[] | null | undefined): boolean {
  return hasArea(areas, 'connectors');
}
