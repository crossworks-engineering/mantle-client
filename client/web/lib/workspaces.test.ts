/**
 * The pure rules of the workspaces screens (W5a): areas, who may change
 * what, the words, the lists and the switcher's choice.
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '@mantle/web-ui/api-fetch';
import {
  ALL_WORKSPACES,
  ALL_WORKSPACES_LABEL,
  addableHits,
  addableResources,
  connectorKindLabel,
  isMissingConnectorOptionsRoute,
  olderBrainConnectorOptions,
  archiveConfirmText,
  areaForPath,
  canArchiveWorkspace,
  archiveBlocked,
  addedText,
  canChangeUser,
  ADMIN_WORKSPACE_MODERATOR_TEXT,
  moderatorErrorText,
  moderatorLockedByAdmin,
  canAddToWorkspace,
  ADMIN_ADD_AREA_TEXT,
  addUserErrorText,
  nextUserSearchOffset,
  canManageWorkspace,
  canPickAssistant,
  canSetConnectors,
  canSetContact,
  removeUserText,
  BUILT_IN_NAME_HINT,
  canRemoveUser,
  isViewerRow,
  removeBlockedReason,
  canSetLook,
  canTickModerator,
  MODERATOR_TICK_ADMIN_ONLY_TEXT,
  REMOVE_ADMIN_KEPT_TEXT,
  REMOVE_SELF_ADMIN_TEXT,
  REMOVE_MODERATOR_ADMIN_ONLY_TEXT,
  isBuiltIn,
  showsMemberSettings,
  userSearchPaged,
  userSearchMin,
  currentWorkspaceLabel,
  isPrivateWorkspace,
  PRIVATE_WORKSPACE_LABEL,
  workspaceLabel,
  hasArea,
  isAdminUserShell,
  isOwnerShell,
  shellRoleOf,
  mayOpenPath,
  navWithAreas,
  onboardingExit,
  goesToOnboarding,
  PATH_AREAS,
  resolveCurrentWorkspace,
  shellAreasOf,
  shellWorkspacesOf,
  sortWorkspaces,
  userLabel,
  userSearchReady,
  workspaceErrorCode,
  workspaceErrorText,
  workspaceMeta,
  workspacesOfLogin,
  type Workspace,
  type WorkspaceConnectorOption,
  type WorkspaceDetail,
} from './workspaces';

function ws(over: Partial<Workspace> = {}): Workspace {
  return {
    id: 'w1',
    name: 'Team',
    description: '',
    contactNodeId: null,
    assistant: null,
    isAdmin: false,
    adminModerated: false,
    archived: false,
    userCount: 2,
    resourceCount: 1,
    me: { member: true, moderator: false },
    // Admin and Team are the built-in two (the brain always sends it).
    builtIn: over.isAdmin === true || over.adminModerated === true,
    ...over,
  };
}

describe('areas', () => {
  it('a brain that names no areas leaves every area on (it serves only admins)', () => {
    expect(hasArea(undefined, 'keys')).toBe(true);
    expect(hasArea(null, 'users')).toBe(true);
  });

  it('a named list is the only truth', () => {
    expect(hasArea(['settings'], 'settings')).toBe(true);
    expect(hasArea(['settings'], 'keys')).toBe(false);
    expect(hasArea([], 'settings')).toBe(false);
  });

  it('maps settings paths to their area, and the Workspaces list to none', () => {
    expect(areaForPath('/settings/users')).toBe('users');
    expect(areaForPath('/settings/agents')).toBe('assistants');
    expect(areaForPath('/settings/connectors')).toBe('connectors');
    expect(areaForPath('/settings/keys')).toBe('keys');
    expect(areaForPath('/settings/appearance')).toBe('settings');
    expect(areaForPath('/settings')).toBe('settings');
    expect(areaForPath('/settings/workspaces')).toBeNull();
    expect(areaForPath('/pages')).toBeNull();
    // A prefix is a whole segment: /settings/usersx is not Users.
    expect(areaForPath('/settings/usersx')).toBe('settings');
  });

  // Phase W5c: one table for every screen (PATH_AREAS).
  it.each([
    '/journal',
    '/inbox',
    '/recall',
    '/formulas',
    '/events',
    '/contacts',
    '/secrets',
    '/docs',
    '/models',
    '/pending',
    '/nodes',
    '/heartbeats',
    '/studio',
    '/dev-tools',
    '/runners',
    '/runs',
    '/sandboxes',
    '/traces',
    '/debug',
    '/changelog',
    '/tasks',
    '/onboarding',
  ])('%s and what is under it need the settings area', (p) => {
    expect(areaForPath(p)).toBe('settings');
    expect(areaForPath(`${p}/x/y`)).toBe('settings');
    expect(areaForPath(`${p}?q=1`)).toBe('settings');
    expect(mayOpenPath([], p)).toBe(false);
    expect(mayOpenPath(['users'], p)).toBe(false);
    expect(mayOpenPath(['settings'], p)).toBe(true);
    // A path no row names needs the settings area too.
    expect(areaForPath(`${p}x`)).toBe('settings');
  });

  it.each([
    '/',
    '/files',
    '/notes',
    '/pages',
    '/draw',
    '/tables',
    '/apps',
    '/n',
    '/settings/workspaces',
    '/settings/mcp',
    '/settings/api-access',
    '/settings/telegram',
    '/assistant',
  ])('%s and what is under it are open to every login', (p) => {
    expect(areaForPath(p)).toBeNull();
    expect(mayOpenPath([], p)).toBe(true);
    if (p !== '/') {
      expect(areaForPath(`${p}/abc`)).toBeNull();
      expect(mayOpenPath([], `${p}/abc`)).toBe(true);
    }
  });

  it('the table names each prefix once, the narrow settings rows above /settings', () => {
    const prefixes = PATH_AREAS.map(([p]) => p);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    const settingsAt = prefixes.indexOf('/settings');
    prefixes.forEach((p, i) => {
      if (p.startsWith('/settings/')) expect(i, p).toBeLessThan(settingsAt);
    });
  });

  it('a path no row names needs the settings area; / matches the home only', () => {
    expect(areaForPath('/somewhere-new')).toBe('settings');
    expect(areaForPath('/nx')).toBe('settings');
    expect(areaForPath('/pagesx')).toBe('settings');
    expect(areaForPath('')).toBeNull();
  });

  it('opens a path only with its area', () => {
    expect(mayOpenPath(['settings'], '/settings/keys')).toBe(false);
    expect(mayOpenPath(['keys'], '/settings/keys')).toBe(true);
    expect(mayOpenPath([], '/settings/workspaces')).toBe(true);
    expect(mayOpenPath([], '/pages')).toBe(true);
    expect(mayOpenPath(undefined, '/settings/keys')).toBe(true);
  });

  it('drops nav rows (and empty groups, and cold-start heads) the login may not open', () => {
    const groups = [
      {
        label: 'Settings',
        items: [{ href: '/settings/keys' }, { href: '/settings/workspaces' }],
        defaultHead: ['/settings/keys', '/settings/workspaces'],
      },
      { label: 'Keys', items: [{ href: '/settings/keys' }] },
      { label: 'Work', items: [{ href: '/pages' }] },
    ];
    const out = navWithAreas(groups, ['settings']);
    expect(out.map((g) => g.label)).toEqual(['Settings', 'Work']);
    expect(out[0]!.items.map((i) => i.href)).toEqual(['/settings/workspaces']);
    expect(out[0]!.defaultHead).toEqual(['/settings/workspaces']);
    expect(navWithAreas(groups, undefined)).toEqual(groups);
  });
});

describe('shellRoleOf and isAdminUserShell', () => {
  it('reads the role the brain names', () => {
    expect(shellRoleOf({ role: 'admin' })).toBe('admin');
    expect(shellRoleOf({ role: 'member' })).toBe('member');
  });
  it('a brain that names no role answered an admin only', () => {
    expect(shellRoleOf({})).toBe('admin');
    expect(shellRoleOf({ role: null })).toBe('admin');
  });
  it('a role this build does not know fails closed, as a member (W8: no client role)', () => {
    expect(shellRoleOf({ role: 'guest' })).toBe('member');
    expect(shellRoleOf({ role: 7 })).toBe('member');
    // A brain before W8 could still name a client login: never the owner screens.
    expect(shellRoleOf({ role: 'client' })).toBe('member');
  });
  it('no shell yet: no role', () => {
    expect(shellRoleOf(undefined)).toBeNull();
    expect(shellRoleOf(null)).toBeNull();
  });
  it('an Admin user is the admin role, and only that', () => {
    expect(isAdminUserShell({ role: 'admin' })).toBe(true);
    expect(isAdminUserShell({})).toBe(true);
    expect(isAdminUserShell({ role: 'member' })).toBe(false);
    expect(isAdminUserShell({ role: 'client' })).toBe(false);
    expect(isAdminUserShell(undefined)).toBe(false);
  });
});

describe('isOwnerShell (W6b fix round 2)', () => {
  it('is the isOwner the brain names, whatever the role', () => {
    expect(isOwnerShell({ role: 'admin', isOwner: true })).toBe(true);
    expect(isOwnerShell({ role: 'admin', isOwner: false })).toBe(false);
    expect(isOwnerShell({ role: 'member', isOwner: false })).toBe(false);
    expect(isOwnerShell({ role: 'client', isOwner: false })).toBe(false);
  });
  it('a brain that sends no isOwner: every Admin user, as that brain removes their deletes', () => {
    expect(isOwnerShell({ role: 'admin' })).toBe(true);
    expect(isOwnerShell({})).toBe(true);
    expect(isOwnerShell({ role: 'member' })).toBe(false);
    expect(isOwnerShell({ role: 'client' })).toBe(false);
  });
  it('a value that is not a boolean reads as no isOwner', () => {
    expect(isOwnerShell({ role: 'member', isOwner: 'true' })).toBe(false);
    expect(isOwnerShell({ role: 'admin', isOwner: 'false' })).toBe(true);
  });
  it('no shell yet: not the owner', () => {
    expect(isOwnerShell(undefined)).toBe(false);
    expect(isOwnerShell(null)).toBe(false);
  });
});

describe('who may change what', () => {
  it('a Moderator manages their workspace without any area', () => {
    expect(canManageWorkspace(ws({ me: { member: true, moderator: true } }), [])).toBe(true);
  });

  it('a plain user does not', () => {
    expect(canManageWorkspace(ws(), ['settings'])).toBe(false);
  });

  it('the Users and workspaces area manages any workspace', () => {
    expect(canManageWorkspace(ws({ me: { member: false, moderator: false } }), ['users'])).toBe(
      true,
    );
  });

  it('nobody changes an archived workspace here', () => {
    expect(
      canManageWorkspace(ws({ archived: true, me: { member: true, moderator: true } }), ['users']),
    ).toBe(false);
  });

  it('Admin is never offered Archive', () => {
    const mod = { member: true, moderator: true };
    expect(canArchiveWorkspace(ws({ me: mod }), [])).toBe(true);
    expect(canArchiveWorkspace(ws({ isAdmin: true, me: mod }), ['users'])).toBe(false);
  });

  it('built in: the brain says so, else Admin or an Admin-moderated workspace', () => {
    expect(isBuiltIn({ builtIn: true, isAdmin: false, adminModerated: false })).toBe(true);
    expect(isBuiltIn({ builtIn: false, isAdmin: false, adminModerated: true })).toBe(false);
    expect(isBuiltIn({ isAdmin: true, adminModerated: false })).toBe(true);
    expect(isBuiltIn({ isAdmin: false, adminModerated: true })).toBe(true);
    expect(isBuiltIn({ isAdmin: false, adminModerated: false })).toBe(false);
    expect(BUILT_IN_NAME_HINT).toBe('Built-in workspaces keep their names.');
  });

  it('the member settings show on the Admin workspace to the settings area only (0286)', () => {
    const admin = { isAdmin: true, archived: false };
    expect(showsMemberSettings(admin, ['settings'])).toBe(true);
    // A brain that sends no areas answered the shell for an admin.
    expect(showsMemberSettings(admin, undefined)).toBe(true);
    expect(showsMemberSettings(admin, ['users'])).toBe(false);
    expect(showsMemberSettings(admin, [])).toBe(false);
    expect(showsMemberSettings({ ...admin, archived: true }, ['settings'])).toBe(false);
    // Team is a normal workspace: no member settings there.
    expect(showsMemberSettings({ isAdmin: false, archived: false }, ['settings'])).toBe(false);
  });

  it('only an Admin user (the users area) ticks Moderator (0286)', () => {
    expect(canTickModerator(['users'])).toBe(true);
    expect(canTickModerator(undefined)).toBe(true);
    expect(canTickModerator([])).toBe(false);
    expect(canTickModerator(['settings'])).toBe(false);
    expect(MODERATOR_TICK_ADMIN_ONLY_TEXT).toBe(
      'Only an Admin user can change the Moderator switch.',
    );
  });

  it('Team is never offered Archive, even to its Moderator with the users area', () => {
    const mod = { member: true, moderator: true };
    expect(canArchiveWorkspace(ws({ adminModerated: true, me: mod }), ['users'])).toBe(false);
    expect(canArchiveWorkspace(ws({ builtIn: true, me: mod }), ['users'])).toBe(false);
  });

  it('no Remove on your own row in Admin', () => {
    const u = (loginId: string, email: string) => ({ loginId, email });
    const byEmail = (email: string) => ({ email });
    expect(canRemoveUser({ isAdmin: true }, u('l1', 'Me@x.test'), byEmail('me@X.test'))).toBe(
      false,
    );
    expect(canRemoveUser({ isAdmin: true }, u('l2', 'b@x.test'), byEmail('me@x.test'))).toBe(true);
    expect(canRemoveUser({ isAdmin: false }, u('l1', 'me@x.test'), byEmail('me@x.test'))).toBe(
      true,
    );
    expect(canRemoveUser({ isAdmin: true }, u('l1', 'me@x.test'), null)).toBe(true);
    // The login id decides when the shell sends it.
    expect(canRemoveUser({ isAdmin: true }, u('l1', 'x@x.test'), { loginId: 'L1' })).toBe(false);
    expect(
      canRemoveUser({ isAdmin: true }, u('l2', 'me@x.test'), { loginId: 'l1', email: 'me@x.test' }),
    ).toBe(true);
  });

  it('isViewerRow: by login id, else by email, else unknown (fix round 2, L6)', () => {
    const row = { loginId: 'l1', email: 'Me@x.test' };
    expect(isViewerRow(row, { loginId: 'l1' })).toBe(true);
    expect(isViewerRow(row, { loginId: 'l2', email: 'me@x.test' })).toBe(false);
    expect(isViewerRow(row, { loginId: null, email: 'me@X.test' })).toBe(true);
    expect(isViewerRow(row, { email: 'b@x.test' })).toBe(false);
    expect(isViewerRow(row, { loginId: null, email: null })).toBeNull();
    expect(isViewerRow(row, null)).toBeNull();
  });

  it('the look field: a brain that sends the look, and whoever may rename (task 5edc9149)', () => {
    const mod = { member: true, moderator: true };
    const plain = { member: true, moderator: false };
    expect(canSetLook(ws({ kind: 'other', me: mod }), [])).toBe(true);
    expect(canSetLook(ws({ kind: 'other', me: plain }), ['users'])).toBe(true);
    expect(canSetLook(ws({ kind: 'other', me: plain }), [])).toBe(false);
    // An older brain sends no kind: its PATCH refuses a look (audit M1).
    expect(canSetLook(ws({ me: mod }), ['users'])).toBe(false);
    expect(canSetLook(ws({ kind: 'other', me: mod, archived: true }), ['users'])).toBe(false);
    // The same rule on every workspace: Team's Moderator sets Team's look,
    // Admin's Moderators (Admin users) set Admin's.
    expect(canSetLook(ws({ kind: 'other', name: 'Team', me: mod }), [])).toBe(true);
    expect(canSetLook(ws({ kind: 'admin', isAdmin: true, builtIn: true, me: mod }), [])).toBe(true);
    expect(canSetLook(ws({ kind: 'admin', isAdmin: true, builtIn: true, me: plain }), [])).toBe(
      false,
    );
  });

  it('why Remove is off: an Admin user kept here, or your own row in Admin (task 19790beb)', () => {
    const user = (email: string, adminViaArea = false) => ({
      loginId: `l-${email}`,
      email,
      adminViaArea,
      moderator: false,
    });
    const admin = ['users'];
    const me = { email: 'me@x.test' };
    expect(removeBlockedReason({ isAdmin: false }, user('a@x.test', true), me, admin)).toBe(
      REMOVE_ADMIN_KEPT_TEXT,
    );
    expect(
      removeBlockedReason({ isAdmin: true }, user('Me@x.test'), { email: 'me@X.test' }, admin),
    ).toBe(REMOVE_SELF_ADMIN_TEXT);
    expect(removeBlockedReason({ isAdmin: true }, user('b@x.test'), me, admin)).toBeNull();
    expect(removeBlockedReason({ isAdmin: false }, user('me@x.test'), me, admin)).toBeNull();
  });

  it("Remove on another Moderator's row: an Admin user only, the tick's own rule (Q2)", () => {
    const ws = { isAdmin: false };
    const mod = (loginId: string, email: string) => ({
      loginId,
      email,
      adminViaArea: false,
      moderator: true,
    });
    const plain = { loginId: 'l-p', email: 'p@x.test', adminViaArea: false, moderator: false };
    const viewer = { loginId: 'l-me', email: 'me@x.test' };
    // A Moderator who is not an Admin user: dimmed on another Moderator...
    expect(removeBlockedReason(ws, mod('l-b', 'b@x.test'), viewer, [])).toBe(
      REMOVE_MODERATOR_ADMIN_ONLY_TEXT,
    );
    expect(REMOVE_MODERATOR_ADMIN_ONLY_TEXT).toBe('Only an Admin user can remove a Moderator.');
    // ...not on a plain user, and not on their own row (leaving), found by
    // login id even when the emails differ.
    expect(removeBlockedReason(ws, plain, viewer, [])).toBeNull();
    expect(removeBlockedReason(ws, mod('l-me', 'other@x.test'), viewer, [])).toBeNull();
    // An unknown viewer (no shell yet) dims nothing for this rule: a
    // Moderator can always leave, and the brain refuses the rest (L6).
    expect(removeBlockedReason(ws, mod('l-b', 'b@x.test'), null, [])).toBeNull();
    expect(removeBlockedReason(ws, mod('l-b', 'b@x.test'), { loginId: null }, [])).toBeNull();
    // An Admin user removes a Moderator (the same check as the tick).
    expect(removeBlockedReason(ws, mod('l-b', 'b@x.test'), viewer, ['users'])).toBeNull();
    expect(canTickModerator(['users'])).toBe(true);
  });

  it('the contact is set by an Admin user; the assistant needs the Assistants area', () => {
    expect(canSetContact(['users'])).toBe(true);
    expect(canSetContact(['settings'])).toBe(false);
    expect(canSetContact([])).toBe(false);
    expect(canPickAssistant(['assistants'])).toBe(true);
    expect(canPickAssistant(['settings'])).toBe(false);
  });

  it('an Admin user kept in Team is demoted or removed by nobody', () => {
    expect(canChangeUser({ adminViaArea: true })).toBe(false);
    expect(canChangeUser({ adminViaArea: false })).toBe(true);
  });

  it('says who added a user, and when', () => {
    const at = '2026-10-10T09:00:00.000Z';
    expect(addedText({ addedBy: { loginId: 'l1', name: 'Ann Lee' }, addedAt: at })).toMatch(
      /^Added by Ann Lee on \S/,
    );
    expect(addedText({ addedBy: null, addedAt: at })).toMatch(/^Added on \S/);
    expect(addedText({ addedBy: null })).toBeNull();
    expect(addedText({ addedAt: 'nonsense' })).toBeNull();
  });

  it('connectors are set with the Connectors area', () => {
    expect(canSetConnectors(['connectors'])).toBe(true);
    expect(canSetConnectors([])).toBe(false);
  });

  it('removing from Admin is said as the role change it is', () => {
    expect(removeUserText({ name: 'Admin', isAdmin: true }, 'Bo')).toContain(
      'Bo stops being an Admin user',
    );
    expect(removeUserText({ name: 'Admin', isAdmin: true }, 'Bo')).toContain('sessions end');
    expect(removeUserText({ name: 'Team', isAdmin: false }, 'Bo')).toBe(
      'Bo stops reading the items shared with Team, unless another of their workspaces has them.',
    );
  });
});

describe('words', () => {
  it('counts users and names the assistant', () => {
    expect(workspaceMeta({ userCount: 1, assistant: null })).toBe('1 user');
    expect(workspaceMeta({ userCount: 3, assistant: { id: 'a', name: 'Nova' } })).toBe(
      '3 users · Nova',
    );
  });

  it('the archive confirm lists the shares that go', () => {
    const text = archiveConfirmText('Sales', { grantCount: 12, itemCount: 0 });
    expect(text).toContain('12 items shared with Sales lose that share');
    expect(archiveConfirmText('Sales', { grantCount: 1, itemCount: 0 })).toContain(
      '1 item shared with Sales loses that share',
    );
    expect(archiveConfirmText('Sales', { grantCount: 0, itemCount: 0 })).toContain(
      'No items are shared with Sales',
    );
    expect(archiveBlocked({ grantCount: 5, itemCount: 0 })).toBe(false);
  });

  it('archive waits while items have their home here', () => {
    expect(archiveBlocked({ grantCount: 0, itemCount: 2 })).toBe(true);
    expect(archiveConfirmText('Sales', { grantCount: 0, itemCount: 2 })).toBe(
      '2 items have their home in Sales. Move them to another workspace first.',
    );
    expect(archiveConfirmText('Sales', { grantCount: 0, itemCount: 1 })).toBe(
      '1 item has its home in Sales. Move it to another workspace first.',
    );
  });

  it('no em dashes in the words', () => {
    const dash = new RegExp(`[${String.fromCharCode(0x2014, 0x2013)}]`);
    for (const p of [
      { grantCount: 2, itemCount: 0 },
      { grantCount: 0, itemCount: 2 },
      { grantCount: 0, itemCount: 0 },
    ]) {
      expect(archiveConfirmText('X', p)).not.toMatch(dash);
    }
  });

  it('shows the brain error text plainly, with its code', () => {
    const err = new ApiError('This assistant has history in Team.', 409, {
      error: 'This assistant has history in Team.',
      code: 'assistant_has_history',
    });
    expect(workspaceErrorText(err)).toBe('This assistant has history in Team.');
    expect(workspaceErrorCode(err)).toBe('assistant_has_history');
    expect(workspaceErrorText(new Error('x'), 'Fallback.')).toBe('Fallback.');
    expect(workspaceErrorCode(new Error('x'))).toBeNull();
  });

  it('names a user by display name, else email', () => {
    expect(userLabel({ name: 'Ann Lee', email: 'a@x.test' })).toBe('Ann Lee');
    expect(userLabel({ name: '  ', email: 'a@x.test' })).toBe('a@x.test');
    expect(userLabel({ name: null, email: 'a@x.test' })).toBe('a@x.test');
  });
});

describe('lists', () => {
  it('sorts Admin first, then by name, archived last', () => {
    const out = sortWorkspaces([
      ws({ id: 'z', name: 'Zed', archived: true }),
      ws({ id: 'b', name: 'Beta' }),
      ws({ id: 'a', name: 'Admin', isAdmin: true }),
      ws({ id: 'c', name: 'Alpha' }),
    ]);
    expect(out.map((w) => w.id)).toEqual(['a', 'c', 'b', 'z']);
  });

  it('user search starts at three characters for a Moderator, at none for an Admin user', () => {
    expect(userSearchMin([])).toBe(3);
    expect(userSearchMin(['users'])).toBe(0);
    expect(userSearchMin(['settings'])).toBe(3);
    expect(userSearchPaged(['users'])).toBe(true);
    expect(userSearchPaged(['settings', 'keys'])).toBe(false);
    expect(userSearchReady(' ab ')).toBe(false);
    expect(userSearchReady(' abc ')).toBe(true);
    expect(userSearchReady('', 0)).toBe(true);
  });

  it('an Admin user pages the user search by 50; a Moderator never pages', () => {
    const full = Array.from({ length: 50 }, () => ({}));
    expect(nextUserSearchOffset([full], true)).toBe(50);
    expect(nextUserSearchOffset([full, full], true)).toBe(100);
    expect(nextUserSearchOffset([full, [{}]], true)).toBeUndefined();
    expect(nextUserSearchOffset([full], false)).toBeUndefined();
    expect(nextUserSearchOffset([], true)).toBeUndefined();
  });

  it('offers only users not in the workspace yet', () => {
    const hits = [
      { loginId: 'l1', name: 'A', email: 'a@x.test' },
      { loginId: 'l2', name: 'B', email: 'b@x.test' },
    ];
    expect(addableHits(hits, [{ loginId: 'l1' }]).map((h) => h.loginId)).toEqual(['l2']);
  });

  it('offers only connectors not on the workspace yet', () => {
    const all = [{ slug: 'drive' }, { slug: 'crm' }];
    const held = [{ kind: 'connector' as const, id: 'drive', name: 'Drive', write: false }];
    expect(addableResources(all, held, 'connector').map((c) => c.slug)).toEqual(['crm']);
  });

  it('offers API connectors as MCP ones, and none the brain says the workspace holds', () => {
    const all: WorkspaceConnectorOption[] = [
      { slug: 'drive', name: 'Drive', kind: 'mcp', held: false },
      { slug: 'crm', name: 'CRM', kind: 'api', held: false },
      { slug: 'mail', name: 'Mail', kind: 'mcp', held: true },
    ];
    expect(addableResources(all, [], 'connector').map((c) => c.slug)).toEqual(['drive', 'crm']);
  });

  it('labels a connector by its kind: MCP or API', () => {
    expect(connectorKindLabel('mcp')).toBe('MCP');
    expect(connectorKindLabel('api')).toBe('API');
  });

  it('an older brain (no connector-options route): its MCP connectors, none held', () => {
    expect(isMissingConnectorOptionsRoute(new ApiError('Not found', 404))).toBe(true);
    // A workspace the caller may not see is a 404 with its code: no fallback.
    expect(
      isMissingConnectorOptionsRoute(
        new ApiError('Workspace not found.', 404, { error: 'x', code: 'not_found' }),
      ),
    ).toBe(false);
    expect(isMissingConnectorOptionsRoute(new ApiError('Forbidden', 403))).toBe(false);
    expect(isMissingConnectorOptionsRoute(new Error('offline'))).toBe(false);
    expect(olderBrainConnectorOptions([{ slug: 'drive', name: 'Drive' }])).toEqual([
      { slug: 'drive', name: 'Drive', kind: 'mcp', held: false },
    ]);
  });

  it('finds the workspaces a login is in, Admin first, archived left out', () => {
    const detail = (w: Workspace, loginIds: string[]): WorkspaceDetail => ({
      workspace: w,
      users: loginIds.map((loginId) => ({
        loginId,
        name: null,
        email: `${loginId}@x.test`,
        moderator: false,
        adminViaArea: false,
        addedBy: null,
        addedAt: '2026-10-10T09:00:00.000Z',
      })),
      resources: [],
      hasHistory: false,
    });
    const out = workspacesOfLogin(
      [
        detail(ws({ id: 't', name: 'Team' }), ['l1']),
        detail(ws({ id: 'a', name: 'Admin', isAdmin: true }), ['l1']),
        detail(ws({ id: 'o', name: 'Old', archived: true }), ['l1']),
        detail(ws({ id: 's', name: 'Sales' }), ['l2']),
        undefined,
      ],
      'l1',
    );
    expect(out).toEqual([
      { id: 'a', name: 'Admin' },
      { id: 't', name: 'Team' },
    ]);
  });
});

describe('the switcher choice', () => {
  const list = [
    { id: 'a', name: 'Admin', isAdmin: true },
    { id: 't', name: 'Team', isAdmin: false },
    { id: 'p', name: 'Mo Member (only you)', isAdmin: false, private: true as const },
  ];

  it('calls the private workspace Only you (W6b)', () => {
    expect(currentWorkspaceLabel('p', list)).toBe(PRIVATE_WORKSPACE_LABEL);
    expect(isPrivateWorkspace({ private: true })).toBe(true);
    expect(isPrivateWorkspace({})).toBe(false);
    expect(workspaceLabel({ name: 'Team' })).toBe('Team');
    expect(workspaceLabel({ name: 'Anything', private: true })).toBe(PRIVATE_WORKSPACE_LABEL);
  });

  it('knows the private workspace by the shell flag, never by its name (W6b fix round)', () => {
    // A workspace a user named "(only you)" is not the private one.
    expect(isPrivateWorkspace({ name: 'Mo (only you)', isAdmin: false } as never)).toBe(false);
    expect(workspaceLabel({ name: 'Board (only you)' })).toBe('Board (only you)');
    // The private flag only counts as true itself.
    expect(isPrivateWorkspace({ private: 'true' } as never)).toBe(false);
  });

  it('keeps a stored workspace the login is still in', () => {
    expect(resolveCurrentWorkspace('t', list)).toBe('t');
    expect(currentWorkspaceLabel('t', list)).toBe('Team');
  });

  it('falls back to All for none, or a workspace the login left', () => {
    expect(resolveCurrentWorkspace(null, list)).toBe(ALL_WORKSPACES);
    expect(resolveCurrentWorkspace('gone', list)).toBe(ALL_WORKSPACES);
    expect(currentWorkspaceLabel(ALL_WORKSPACES, list)).toBe(ALL_WORKSPACES_LABEL);
  });
});

describe('the shell payload', () => {
  it('reads workspaces and areas, ignoring what it does not know', () => {
    expect(
      shellWorkspacesOf({
        workspaces: [{ id: 'a', name: 'Admin', isAdmin: true, moderator: true }, { id: 3 }, null],
      }),
    ).toEqual([{ id: 'a', name: 'Admin', isAdmin: true, moderator: true }]);
    expect(shellWorkspacesOf({})).toEqual([]);
    expect(shellAreasOf({ areas: ['users', 4] })).toEqual(['users']);
    expect(shellAreasOf({})).toBeUndefined();
  });
});

describe("onboardingExit (/onboarding is the settings area's)", () => {
  it('sends a login without the settings area home', () => {
    expect(onboardingExit({ areas: [] })).toBe('/');
    expect(onboardingExit({ areas: ['users', 'keys'] })).toBe('/');
  });

  it('keeps a login with it, and a brain that names no areas', () => {
    expect(onboardingExit({ areas: ['settings'] })).toBeNull();
    expect(onboardingExit({})).toBeNull();
  });

  it('waits for the shell', () => {
    expect(onboardingExit(undefined)).toBeNull();
    expect(onboardingExit(null)).toBeNull();
  });
});

describe('goesToOnboarding (the shell sends only a settings login to the wizard)', () => {
  it('sends a login that is not onboarded and holds the settings area', () => {
    expect(goesToOnboarding({ onboarded: false, areas: ['settings'] })).toBe(true);
    expect(goesToOnboarding({ onboarded: false })).toBe(true);
  });

  it('keeps a login without the settings area home: no loop with /onboarding', () => {
    for (const areas of [[], ['users', 'keys']]) {
      const shell = { onboarded: false, areas };
      expect(goesToOnboarding(shell)).toBe(false);
      // /onboarding would send it home again.
      expect(onboardingExit(shell)).toBe('/');
    }
  });

  it('a login the wizard keeps is one the shell may send there', () => {
    for (const areas of [undefined, [], ['settings'], ['users'], ['settings', 'users']]) {
      const shell = { onboarded: false, ...(areas ? { areas } : {}) };
      expect(goesToOnboarding(shell)).toBe(onboardingExit(shell) === null);
    }
  });

  it('sends nobody who is onboarded, and waits for the shell', () => {
    expect(goesToOnboarding({ onboarded: true, areas: ['settings'] })).toBe(false);
    expect(goesToOnboarding(null)).toBe(false);
    expect(goesToOnboarding(undefined)).toBe(false);
  });
});

// Task b8eea6cf (brain F4 fix round 1): every Admin user moderates Admin.
describe('the Admin workspace Moderator lock', () => {
  it('locks every row on Admin, none elsewhere', () => {
    expect(moderatorLockedByAdmin({ isAdmin: true })).toBe(true);
    expect(moderatorLockedByAdmin({ isAdmin: false })).toBe(false);
  });

  // F4 audit M1 (owner decision 2026-10-16): an add to Admin makes an
  // Admin user, so the brain asks for the Users area for any add there.
  it('offers an add to Admin only with the Users area; elsewhere always', () => {
    expect(canAddToWorkspace({ isAdmin: true }, ['users'])).toBe(true);
    expect(canAddToWorkspace({ isAdmin: true }, ['files'])).toBe(false);
    expect(canAddToWorkspace({ isAdmin: true }, [])).toBe(false);
    // No areas list: the owner, who holds every area.
    expect(canAddToWorkspace({ isAdmin: true }, undefined)).toBe(true);
    expect(canAddToWorkspace({ isAdmin: false }, ['files'])).toBe(true);
    expect(canAddToWorkspace({ isAdmin: false }, [])).toBe(true);
  });

  it("says an Admin add's 403 admin_only in plain words, nowhere else", () => {
    const adminOnly = new ApiError('admin_only', 403, { error: 'admin_only', code: 'admin_only' });
    expect(addUserErrorText(adminOnly, { isAdmin: true })).toBe(ADMIN_ADD_AREA_TEXT);
    expect(addUserErrorText(adminOnly, { isAdmin: false })).not.toBe(ADMIN_ADD_AREA_TEXT);
    const taken = new ApiError('This person is already a user of this workspace.', 409, {
      code: 'already_user',
    });
    expect(addUserErrorText(taken, { isAdmin: true })).toBe(
      'This person is already a user of this workspace.',
    );
    expect(ADMIN_ADD_AREA_TEXT).not.toMatch(/[\u2013\u2014]/);
  });

  it("says the 409 admin_workspace in plain words, else the brain's own", () => {
    const locked = new ApiError('Every Admin user is a Moderator of the Admin workspace.', 409, {
      error: 'Every Admin user is a Moderator of the Admin workspace.',
      code: 'admin_workspace',
    });
    expect(moderatorErrorText(locked)).toContain(ADMIN_WORKSPACE_MODERATOR_TEXT);
    expect(moderatorErrorText(locked)).not.toMatch(/[\u2013\u2014]/);
    const last = new ApiError('This is the last Moderator.', 409, { code: 'last_moderator' });
    expect(moderatorErrorText(last)).toBe('This is the last Moderator.');
    expect(moderatorErrorText(new Error('x'))).toBe('Could not save.');
  });
});
