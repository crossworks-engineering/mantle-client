import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { expect, type Page } from '@playwright/test';
import { GONE_ROUTE, MEMBER_OPEN } from './shell-nav';

/**
 * An in-memory brain for the workspace specs (phase W5c: one shell for every
 * login): a real HTTP server in the spec process. The owner UI runs with
 * MANTLE_SERVER_ORIGIN pointed here (playwright.workspace.config.ts), so the
 * browser calls it cross-origin with the bearer the real /login form got
 * from POST /api/auth/token.
 *
 * Two logins, one password: an admin (every area, every workspace) and a
 * member (a Moderator of Team, a user of Field crew, and its private
 * workspace "Mo Member (only you)"). There is no client login since W8. GET
 * /api/shell answers each as the brain does (`role`, `loginId`,
 * `workspaces`, `areas`, `treeKinds`). Since W6b every login reads and
 * writes on the owner routes in its own scope: a member is refused
 * (403 member-login) every owner route that is not in
 * the brain's open list (MEMBER_OPEN in shell-nav.ts), a create names its
 * workspace with `?ws=` (403 workspace for one the login is not in), and the
 * retired routes answer 410. A member keeps /api/member/realtime and
 * /api/member/home. Every login's Home reads GET /api/home?ws= (task
 * d78e7bde: the current workspace's landing page, Desk here).
 * Every request is recorded with the role that sent it,
 * so a spec can assert what a login never asked for.
 *
 * Only what the specs need is answered. Anything else is a plain 404 (never
 * a 401, which would bounce the page to /login).
 */

export const MOCK_API_PORT = Number(process.env.E2E_WORKSPACE_API_PORT || 3922);
/** The "brain" origin the owner UI is started against. */
export const MOCK_API_ORIGIN = `http://127.0.0.1:${MOCK_API_PORT}`;

/** The key the owner UI under test is started with in place of the desktop
 *  shell's per-launch one (client/web/lib/desktop-brain.ts): a spec sending it
 *  names the brain a request renders for, as the shell does for each window. */
export const MOCK_DESKTOP_BRAIN_KEY = 'e2e-desktop-brain-key-not-a-secret';

/** The one password of every mock login (a test value, nothing real). */
export const PASSWORD = 'workspace-e2e-password-1';

export type Role = 'admin' | 'member';

export const LOGINS: Record<Role, { email: string; name: string; loginId: string }> = {
  admin: {
    email: 'ada@example.invalid',
    name: 'Ada Admin',
    loginId: '48484848-4848-4484-8484-484848484848',
  },
  member: {
    email: 'mo@example.invalid',
    name: 'Mo Member',
    loginId: '49494949-4949-4494-8494-494949494949',
  },
};

export const WORKSPACES = {
  admin: { id: 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0', name: 'Admin' },
  team: { id: 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1', name: 'Team' },
  field: { id: 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2', name: 'Field crew' },
  board: { id: 'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3', name: 'Board room' },
  desk: { id: 'e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4', name: 'Client desk' },
  /** The member's private workspace (W6b): the brain names it "<name> (only
   *  you)" and the shell marks it `private: true` (fix round); the switcher
   *  calls it Only you by the mark. */
  own: { id: 'f5f5f5f5-f5f5-4f5f-8f5f-f5f5f5f5f5f5', name: 'Mo Member (only you)' },
} as const;
type WorkspaceKey = keyof typeof WORKSPACES;

/** Which workspaces each login is in (a Moderator of the ones marked). */
const MEMBERSHIP: Record<Role, { ws: WorkspaceKey; moderator: boolean }[]> = {
  admin: [
    { ws: 'admin', moderator: true },
    { ws: 'team', moderator: true },
    { ws: 'field', moderator: false },
    { ws: 'board', moderator: true },
    { ws: 'desk', moderator: true },
  ],
  member: [
    { ws: 'team', moderator: true },
    { ws: 'field', moderator: false },
    { ws: 'own', moderator: true },
  ],
};

/** The brain's pages, each in one workspace. The member's answers hold the
 *  pages of its own workspaces only; Board minutes and Brain policy are in
 *  none of them. */
export const PAGES = {
  policy: {
    id: '44444444-4444-4444-8444-444444444444',
    title: 'Brain policy',
    ws: 'admin',
  },
  handbook: {
    id: '55555555-5555-4555-8555-555555555555',
    title: 'Crew handbook',
    ws: 'team',
  },
  survey: {
    id: '77777777-7777-4777-8777-777777777777',
    title: 'Site survey',
    ws: 'field',
  },
  minutes: {
    id: '99999999-9999-4999-8999-999999999999',
    title: 'Board minutes',
    ws: 'board',
  },
} as const satisfies Record<string, { id: string; title: string; ws: WorkspaceKey }>;

/** The other lists' items (Notes, Files and Apps), one in Admin and one in
 *  Team each, so a switch shows which workspace a list was asked for. */
export const KIND_ITEMS = {
  notes: [
    { id: '41414141-4141-4414-8414-414141414141', title: 'Admin note', ws: 'admin' },
    { id: '42424242-4242-4424-8424-424242424242', title: 'Team note', ws: 'team' },
  ],
  files: [
    { id: '43434343-4343-4434-8434-434343434343', title: 'Admin file', ws: 'admin' },
    { id: '45454545-4545-4454-8454-454545454545', title: 'Team file', ws: 'team' },
  ],
  apps: [
    { id: '46464646-4646-4464-8464-464646464646', title: 'Admin app', ws: 'admin' },
    { id: '47474747-4747-4474-8474-474747474747', title: 'Team app', ws: 'team' },
  ],
} as const satisfies Record<string, { id: string; title: string; ws: WorkspaceKey }[]>;

/** The member's snapshot copy of an accepted page (W6b): read only, in its
 *  private workspace (no other login reads it); the member may delete it. */
export const COPY = {
  id: '88888888-8888-4888-8888-888888888888',
  title: 'My accepted rota',
  ws: 'own',
  snapshotOf: PAGES.handbook.id,
} as const satisfies { id: string; title: string; ws: WorkspaceKey; snapshotOf: string };

/** A file in the brain the member reads (Team), for the /n link spec. */
export const FILE = {
  id: '66666666-6666-4666-8666-666666666666',
  filename: 'rota.md',
  parentPath: 'files/crew',
  content: 'Monday: Mo.',
} as const;

const ALL_AREAS = ['settings', 'users', 'assistants', 'connectors', 'keys'];
/** The kinds the tree serves, by the tree's own name (a member's: the
 *  brain's reader kinds). */
const MEMBER_TREE_KINDS = ['files', 'notes', 'pages', 'draw', 'tables'];

const tokenOf = (role: Role) => `ws-e2e-${role}-bearer`;
const roleOfToken = (header: string | undefined): Role | null => {
  const token = header?.replace(/^Bearer\s+/i, '');
  return (['admin', 'member'] as const).find((r) => tokenOf(r) === token) ?? null;
};

/** What anyone may ask, signed in or not: what /login asks, and sign-in. */
const PUBLIC = [
  /^\/api\/version$/,
  /^\/api\/appearance(\/|$)/,
  /^\/api\/auth\/bootstrap-state$/,
  /^\/api\/auth\/token$/,
  /^\/api\/auth\/(mobile-)?logout$/,
];
/** What the brain answers every signed-in login. */
const EVERY_LOGIN = [/^\/api\/shell$/, /^\/api\/workspaces(\/|$)/, /^\/api\/profile\/home-desk$/];

export type MockRequest = { method: string; path: string; query: string; role: Role | 'anon' };

/** A page a spec made through POST /api/pages, and where the brain put it. */
export type MockCreated = { id: string; title: string; ws: WorkspaceKey; role: Role };

/** A page as the mock holds it (a created one, or one of PAGES). */
type MockPage = { id: string; title: string; ws: WorkspaceKey; snapshotOf?: string };

export type MockWorkspaceApi = {
  /** Every request, in order (CORS preflights left out). */
  requests: MockRequest[];
  /** Every sign-in, with the email asked for and the status answered. */
  signIns: { email: string; status: number }[];
  /** The paths `role` asked for (method and path), in order. */
  asked: (role: Role) => string[];
  /** What GET /api/shell says in `onboarded`, for every login (default true). */
  onboarded: boolean;
  /** The pages made in this run, with the workspace each landed in. */
  created: MockCreated[];
  /** Workspaces a login was taken out of after its shell loaded: the shell
   *  still lists them, the brain refuses a create there (403 workspace). */
  leftSince: Partial<Record<Role, WorkspaceKey[]>>;
  /** A workspace's home app (task d78e7bde): GET /api/home?ws= names it.
   *  `frame` true: its frame ticket and frame answer (the app loads but
   *  never signals ready); false: the ticket is a 404 (no build), so the
   *  landing page falls back to Desk. */
  homeApps: Partial<Record<WorkspaceKey, { id: string; title: string; frame: boolean }>>;
  /** Each login's Desk as GET /api/profile/home-desk answers it (none: null
   *  and 0). PUT is compare-and-set on `version`, as on a brain: a spec sets
   *  one here to play another device's save. */
  desks: Partial<Record<Role, { homeDesk: unknown; version: number }>>;
  close: () => Promise<void>;
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function startMockWorkspaceApi(clientOrigin: string): Promise<MockWorkspaceApi> {
  const now = new Date().toISOString();
  const state: MockWorkspaceApi = {
    requests: [],
    signIns: [],
    asked: (role) =>
      state.requests.filter((r) => r.role === role).map((r) => `${r.method} ${r.path}`),
    onboarded: true,
    created: [],
    leftSince: {},
    homeApps: {},
    desks: {},
    close: async () => undefined,
  };

  const cors = {
    'access-control-allow-origin': clientOrigin,
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization, last-event-id, idempotency-key',
    'access-control-max-age': '600',
  };
  const send = (res: ServerResponse, status: number, type: string, body: string) => {
    res.writeHead(status, { ...cors, 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };
  const json = (res: ServerResponse, status: number, body: unknown) =>
    send(res, status, 'application/json', JSON.stringify(body));

  const shellWorkspaces = (role: Role) =>
    MEMBERSHIP[role].map(({ ws, moderator }) => ({
      id: WORKSPACES[ws].id,
      name: WORKSPACES[ws].name,
      isAdmin: ws === 'admin',
      moderator,
      ...(ws === 'own' ? { private: true as const } : {}),
    }));
  /** The pages a login reads (its workspaces; the admin is in all of
   *  them), narrowed to `ws` when a list names one. */
  const pagesOf = (role: Role, ws: string | null = null) => {
    const mine = new Set<WorkspaceKey>(MEMBERSHIP[role].map((m) => m.ws));
    const all: MockPage[] = [...Object.values(PAGES), COPY, ...state.created];
    return all.filter((p) => mine.has(p.ws) && (!ws || WORKSPACES[p.ws].id === ws));
  };
  /** A kind's items a login reads, narrowed to `ws` like pagesOf. */
  const itemsOf = (kind: string, role: Role, ws: string | null = null): MockPage[] => {
    if (kind === 'pages') return pagesOf(role, ws);
    if (!(kind in KIND_ITEMS)) return [];
    const mine = new Set<WorkspaceKey>(MEMBERSHIP[role].map((m) => m.ws));
    return KIND_ITEMS[kind as keyof typeof KIND_ITEMS].filter(
      (p) => mine.has(p.ws) && (!ws || WORKSPACES[p.ws].id === ws),
    );
  };
  const keyOfWs = (id: string): WorkspaceKey | null =>
    (Object.keys(WORKSPACES) as WorkspaceKey[]).find((k) => WORKSPACES[k].id === id) ?? null;
  /** Where a create lands (W6b contract item 3): `?ws=` when the login
   *  moderates it, else the login's private workspace (a member), else
   *  Admin; or a refusal. */
  const createHome = (
    role: Role,
    asked: string | null,
  ): { ws: WorkspaceKey } | { status: number; body: unknown } => {
    const fallback: WorkspaceKey = role === 'admin' ? 'admin' : 'own';
    if (!asked) return { ws: fallback };
    const key = keyOfWs(asked);
    const m = key ? MEMBERSHIP[role].find((x) => x.ws === key) : undefined;
    if (!key || !m || state.leftSince[role]?.includes(key)) {
      return {
        status: 403,
        body: {
          error: 'forbidden',
          reason: 'workspace',
          message: 'You are not in that workspace.',
        },
      };
    }
    return { ws: m.moderator ? key : fallback };
  };

  const shell = (role: Role) => ({
    role,
    loginId: LOGINS[role].loginId,
    // The brain's anchor login (W6b fix round 2): Ada is the owner here.
    isOwner: role === 'admin',
    workspaces: shellWorkspaces(role),
    areas: role === 'admin' ? ALL_AREAS : [],
    treeKinds: MEMBER_TREE_KINDS,
    onboarded: state.onboarded,
    displayName: LOGINS[role].name,
    email: LOGINS[role].email,
    avatar: null,
    avatarPhotoVersion: null,
    pendingApprovals: 0,
    assetToken: '',
    siteName: null,
    peerName: null,
    logoVersion: null,
    logoDarkVersion: null,
    colorTheme: null,
    fontLogo: null,
    fontTitle: null,
    fontUi: null,
    fontProse: null,
    fontSize: null,
    fontLogoSize: null,
    fontTitleSize: null,
    fontProseSize: null,
  });

  /** A tree answer in the brain's shape, every item at the top level. */
  const tree = (kind: string, items: Record<string, unknown>[], url: URL) => ({
    kind,
    folder: null,
    crumbs: [],
    folders: [],
    items,
    sort: url.searchParams.get('sort') ?? 'name',
    nextCursor: null,
  });
  /** The caller's caps on a page (W6b fix round, ItemCaps): an admin may
   *  do everything (the system pool); a member edits and manages in the
   *  workspaces it moderates and only reads the rest. A snapshot copy is
   *  read only for everyone; its author may delete it. */
  const capsOf = (role: Role, p: MockPage) => {
    if (role === 'admin') return { mayEdit: true, mayManage: true };
    const mod = MEMBERSHIP[role].some((m) => m.ws === p.ws && m.moderator);
    if (p.snapshotOf) {
      return { mayEdit: false, mayManage: mod, readOnly: true, snapshotOf: p.snapshotOf };
    }
    return { mayEdit: mod, mayManage: mod };
  };
  const treeItem = (role: Role) => (p: MockPage) => ({
    id: p.id,
    title: p.title,
    icon: null,
    color: null,
    subtype: null,
    level: 'team',
    state: null,
    updatedAt: now,
    ...capsOf(role, p),
  });

  /** A member's own routes kept in W6b (/api/member/*); true when it
   *  answered. */
  const handleMember = (res: ServerResponse, path: string): boolean => {
    if (path === '/api/member/realtime')
      return (send(res, 200, 'text/event-stream', ':\n\n'), true);
    if (path === '/api/member/home') return (json(res, 200, { homeApp: null, hub: null }), true);
    return false;
  };

  /** The owner item routes every login uses in its own scope (W6b); true
   *  when it answered. */
  const handleItems = async (
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    path: string,
    role: Role,
  ): Promise<boolean> => {
    const method = req.method ?? 'GET';
    const ws = url.searchParams.get('ws');
    const treeM = /^\/api\/tree\/([a-z]+)(\/search)?$/.exec(path);
    if (treeM && method === 'GET') {
      const kind = treeM[1]!;
      const items = itemsOf(kind, role, ws).map(treeItem(role));
      const echo = ws ? { ws } : {};
      if (treeM[2]) {
        const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
        const hits = items
          .filter((i) => String(i.title).toLowerCase().includes(q))
          .map((i) => ({ ...i, crumbs: [] }));
        return (
          json(res, 200, { kind, folders: [], items: hits, nextCursor: null, ...echo }),
          true
        );
      }
      return (json(res, 200, { ...tree(kind, items, url), ...echo }), true);
    }
    // The landing page of the current workspace (task d78e7bde): the
    // Desk's data, kept to `ws` (none: every workspace of the
    // login). A workspace the login is not in is 404.
    if (path === '/api/home' && method === 'GET') {
      const key = ws ? keyOfWs(ws) : null;
      if (ws && (!key || !MEMBERSHIP[role].some((m) => m.ws === key))) {
        return (json(res, 404, { error: 'Workspace not found.', code: 'not_found' }), true);
      }
      const sections = pagesOf(role, ws).map((p) => ({
        token: p.id,
        title: p.title,
        icon: null,
        summary: null,
        updatedAt: now,
        parentToken: null,
      }));
      const counts = {
        page: sections.length,
        note: itemsOf('notes', role, ws).length,
        file: itemsOf('files', role, ws).length,
        table: 0,
        draw: 0,
      };
      const apps = itemsOf('apps', role, ws).map((a) => ({
        token: a.id,
        title: a.title,
        description: null,
        updatedAt: now,
      }));
      const homeApp = key ? state.homeApps[key] : undefined;
      return (
        json(res, 200, {
          ws: ws ?? null,
          homeApp: homeApp
            ? { appId: homeApp.id, title: homeApp.title, icon: null, color: null }
            : null,
          hub: {
            siteName: null,
            memberName: LOGINS[role].name,
            version: '0.0.0',
            sections,
            counts,
            apps,
          },
        }),
        true
      );
    }
    // A home app's frame (task d78e7bde): a ticket, then a page that never
    // signals ready; or a 404 ticket (no build).
    const frameM = /^\/api\/apps\/([0-9a-f-]{36})\/(frame-ticket|frame)$/.exec(path);
    const framed = frameM
      ? Object.values(state.homeApps).find((a) => a?.id === frameM[1])
      : undefined;
    if (frameM && framed) {
      if (!framed.frame) return (json(res, 404, { error: 'no build' }), true);
      if (frameM[2] === 'frame-ticket' && method === 'POST') {
        return (json(res, 200, { ticket: `ticket-${framed.id}` }), true);
      }
      if (frameM[2] === 'frame' && method === 'GET') {
        return (send(res, 200, 'text/html', '<!doctype html><p>home app</p>'), true);
      }
    }
    // The Apps screen's paged list (this mock's tree serves no apps).
    if (path === '/api/apps' && method === 'GET') {
      const apps = itemsOf('apps', role, ws).map((a) => ({
        id: a.id,
        title: a.title,
        icon: null,
        color: null,
        tags: [],
        summary: null,
        description: null,
        toolCount: 0,
        hasBuild: false,
        hasDraft: false,
        shareMode: null,
        isHub: false,
        ...capsOf(role, a),
      }));
      const echo = ws ? { ws } : {};
      return (json(res, 200, { apps, total: apps.length, page: 1, pageSize: 50, ...echo }), true);
    }
    if (path === '/api/pages' && method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}') as { title?: string };
      const home = createHome(role, ws);
      if ('status' in home) return (json(res, home.status, home.body), true);
      const n = state.created.length + 1;
      const id = `abcdef${String(n).padStart(2, '0')}-0000-4000-8000-000000000000`;
      const made: MockCreated = { id, title: body.title ?? 'Untitled', ws: home.ws, role };
      state.created.push(made);
      return (json(res, 201, { page: pageRow(role, made) }), true);
    }
    const pageM = /^\/api\/pages\/([0-9a-f-]{36})$/.exec(path);
    if (pageM && method === 'GET') {
      const p = pagesOf(role).find((x) => x.id === pageM[1]);
      return (
        p ? json(res, 200, { page: pageRow(role, p) }) : json(res, 404, { error: 'not found' }),
        true
      );
    }
    // A /n link (GET /api/nodes/:id) and the Files screen: the member reads
    // the file's detail on the owner route (W6b fix round, contract
    // change 4); since W7e its bytes are on the owner route too.
    const nodeM = /^\/api\/nodes\/([0-9a-f-]{36})$/.exec(path);
    if (nodeM && method === 'GET') {
      const page = pagesOf(role).find((x) => x.id === nodeM[1]);
      if (nodeM[1] === FILE.id) {
        return (json(res, 200, { node: { id: FILE.id, type: 'file' } }), true);
      }
      return (
        page
          ? json(res, 200, { node: { id: page.id, type: 'page', ...capsOf(role, page) } })
          : json(res, 404, { error: 'not found' }),
        true
      );
    }
    if (path === '/api/files/folders' && method === 'GET') {
      return (
        json(res, 200, {
          folders: [folderRow('files', 'Files'), folderRow(FILE.parentPath, 'crew')],
        }),
        true
      );
    }
    if (path === '/api/files/files' && method === 'GET') {
      const parent = url.searchParams.get('parent');
      const files = parent === FILE.parentPath ? [fileRow()] : [];
      return (json(res, 200, { files }), true);
    }
    if (path === `/api/files/files/${FILE.id}` && method === 'GET') {
      if (url.searchParams.has('raw') || url.searchParams.has('thumb')) {
        return (json(res, 401, { error: 'Unauthorized' }), true);
      }
      return (json(res, 200, { file: fileRow(), content: FILE.content }), true);
    }
    return false;
  };
  const folderRow = (p: string, title: string) => ({
    id: `folder-${title}`,
    path: p,
    title,
    slug: title.toLowerCase(),
    description: '',
    indexing: null,
    childFolderCount: 0,
    fileCount: p === FILE.parentPath ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  });
  /** The member reads the file through Team, where it is a Moderator. */
  const fileRow = () => ({
    id: FILE.id,
    parentPath: FILE.parentPath,
    filename: FILE.filename,
    extension: 'md',
    mimeType: 'text/markdown',
    sizeBytes: FILE.content.length,
    isText: true,
    summary: null,
    indexing: null,
    indexingApplied: null,
    createdAt: now,
    updatedAt: now,
    mayEdit: true,
    mayManage: true,
  });
  const pageRow = (role: Role, p: MockPage) => ({
    id: p.id,
    title: p.title,
    icon: null,
    tags: [],
    parentId: null,
    folderId: null,
    content: { type: 'doc', content: [] },
    hasDraft: false,
    visibility: 'private',
    width: 'narrow',
    createdAt: now,
    updatedAt: now,
    workspaces: [{ id: WORKSPACES[p.ws].id, name: WORKSPACES[p.ws].name }],
    hasLink: false,
    ...capsOf(role, p),
  });

  /** The owner routes the admin's Users screen needs; true when it
   *  answered. */
  const handleAdmin = (res: ServerResponse, url: URL, path: string): boolean => {
    // Settings > Users: every login, in the brain's UserRow shape.
    if (path === '/api/users') {
      const users = (Object.keys(LOGINS) as Role[]).map((r) => ({
        id: LOGINS[r].loginId,
        email: LOGINS[r].email,
        displayName: LOGINS[r].name,
        isOwner: r === 'admin',
        createdAt: '2026-09-01T08:00:00.000Z',
        lastLoginAt: null,
        agent: null,
        role: r,
        contactId: null,
        disabledAt: null,
      }));
      return (json(res, 200, { users, currentActorId: LOGINS.admin.loginId }), true);
    }
    // The flat Users screen's other reads (kept W5c routes): open invites,
    // and the agents a personal assistant copies from.
    if (path === '/api/team-admin/invites') return (json(res, 200, { invites: [] }), true);
    if (path === '/api/agents') return (json(res, 200, { agents: [] }), true);
    return false;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? 'GET';
    if (method === 'OPTIONS') return send(res, 204, 'text/plain', '');
    const url = new URL(req.url ?? '/', MOCK_API_ORIGIN);
    const path = url.pathname;
    const role = roleOfToken(req.headers.authorization);
    state.requests.push({ method, path, query: url.search, role: role ?? 'anon' });

    if (PUBLIC.some((re) => re.test(path))) {
      if (path === '/api/version') return json(res, 200, { version: 'mock' });
      if (path.startsWith('/api/appearance')) return json(res, 200, { siteName: null });
      if (path === '/api/auth/bootstrap-state') return json(res, 200, { firstRun: false });
      if (path === '/api/auth/token' && method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}') as {
          email?: string;
          password?: string;
        };
        const who = (Object.keys(LOGINS) as Role[]).find((r) => LOGINS[r].email === body.email);
        const status = who && body.password === PASSWORD ? 200 : 401;
        state.signIns.push({ email: body.email ?? '', status });
        return who && status === 200
          ? json(res, 200, { token: tokenOf(who) })
          : json(res, 401, { error: 'Invalid email or password.' });
      }
      return json(res, 200, { ok: true });
    }
    if (!role) return json(res, 401, { error: 'Unauthorized' });

    if (EVERY_LOGIN.some((re) => re.test(path))) {
      if (path === '/api/shell') return json(res, 200, shell(role));
      if (path === '/api/profile/home-desk') {
        const stored = state.desks[role] ?? { homeDesk: null, version: 0 };
        if (method === 'GET') return json(res, 200, stored);
        if (method === 'PUT') {
          const body = JSON.parse((await readBody(req)) || '{}') as {
            homeDesk?: unknown;
            version?: unknown;
          };
          if (body.version !== stored.version) return json(res, 409, stored);
          const saved = { homeDesk: body.homeDesk, version: stored.version + 1 };
          state.desks[role] = saved;
          return json(res, 200, saved);
        }
      }
      return json(res, 404, { error: `not mocked: ${method} ${path}` });
    }
    // The routes a W6b, W7 or W8 brain retired (the client portal among
    // them): 410.
    if (GONE_ROUTE.test(path)) {
      return json(res, 410, { error: 'This was removed from the brain.', code: 'gone' });
    }
    // Every login's own chats (W7c): no unread replies in the mock.
    if (path === '/api/assistant/conversations') return json(res, 200, { conversations: [] });
    // Telegram per user (W7d): no chats paired, none moderated.
    if (path === '/api/telegram/my-chats' || path === '/api/telegram/moderated-chats') {
      return json(res, 200, { chats: [] });
    }
    // The brain's gates (W6b): a member keeps its own /api/member/* routes; a
    // member uses the owner routes the brain opened to it; an
    // admin every owner route.
    if (/^\/api\/member\//.test(path)) {
      if (role !== 'member') return json(res, 403, { error: 'forbidden', reason: `${role}-login` });
      if (handleMember(res, path)) return;
    } else if (role !== 'admin' && !MEMBER_OPEN.some((re) => re.test(`${method} ${path}`))) {
      return json(res, 403, { error: 'forbidden', reason: `${role}-login` });
    } else if (await handleItems(req, res, url, path, role)) {
      return;
    } else if (role === 'admin' && handleAdmin(res, url, path)) {
      return;
    }
    return json(res, 404, { error: `not mocked: ${method} ${path}` });
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => json(res, 500, { error: String(err) }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(MOCK_API_PORT, '127.0.0.1', () => resolve());
  });
  state.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return state;
}

/**
 * Sign in through the real /login form: the password goes to the mock's
 * POST /api/auth/token, the form keeps the bearer (the token store) and
 * lands on the home.
 */
export async function signIn(page: Page, role: Role): Promise<void> {
  await page.goto('/login');
  await page.locator('#email').fill(LOGINS[role].email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL((u) => u.pathname === '/', { timeout: 60_000 });
}
