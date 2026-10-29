import { expect, type Page } from '@playwright/test';

/** The workspace screens every login opens, as the nav names them. */
export const WORK_ROWS = ['Pages', 'Notes', 'Files', 'Tables', 'Draw', 'Apps'] as const;

/** Rows only a login with an Admin area sees: the settings it manages and
 *  the brain's own screens. */
export const ADMIN_ROWS = [
  'Users',
  'Agents',
  'AI workers',
  'Connectors',
  'API keys',
  'Tools',
  'Tool groups',
  'Skills',
  'Peers',
  'Backups',
  'Audit log',
  'Runs',
  'Journal',
  'Contacts',
  'Secrets',
] as const;

/**
 * The rail's nav, opened to every row the login may see. An admin picks the
 * Admin scope (the whole menu, components/layout/sidebar-nav.tsx). A member
 * holds no settings area: it gets no Work / Settings / Admin choice at all,
 * and its rows are all there, flat.
 */
export async function wholeNav(page: Page, role: 'admin' | 'member') {
  const nav = page.getByRole('navigation', { name: 'Primary' });
  const scopes = nav.getByRole('group', { name: 'How much of the menu to show' });
  if (role === 'admin') {
    await nav.getByRole('radio', { name: 'Admin', exact: true }).click();
  } else {
    await expect(nav.getByRole('link', { name: 'Pages', exact: true })).toBeVisible();
    await expect(scopes).toHaveCount(0);
    await expect(nav.getByRole('radio')).toHaveCount(0);
  }
  return nav;
}

/** Paths a login asks of any brain: the shell, its own Desk, the version,
 *  what /login asks and sign-in itself. */
export const ANY_LOGIN = [
  /^\/api\/shell$/,
  // The login's own Desk (GET and PUT), for every login.
  /^\/api\/profile\/home-desk$/,
  /^\/api\/version$/,
  /^\/api\/appearance(\/|$)/,
  /^\/api\/auth\//,
  // The messenger (Chats): every route is open to every login on the brain
  // (`open: 'any'`, mantle docs/messenger.md "The API").
  /^\/api\/messenger(\/|$)/,
];

/** Any live-update stream: the owner's /api/realtime or a member's
 *  /api/member/realtime (lib/realtime-stream.ts picks one by role). */
export const ANY_STREAM = /^GET \/api\/(member\/)?realtime$/;

/** The requests (`METHOD /path`) whose path matches none of `allowed`. */
export function outside(asked: readonly string[], allowed: readonly RegExp[]): string[] {
  return asked.filter((r) => {
    const path = r.slice(r.indexOf(' ') + 1);
    return !allowed.some((re) => re.test(path));
  });
}

const ID = '[0-9a-f-]{36}';
const KIND = '[a-z]+';
const rx = (method: string, path: string) => new RegExp(`^${method} ${path}$`);

/**
 * The owner routes a W6b brain opens to a member (route-scope.ts
 * MEMBER_OPEN_READS and MEMBER_OPEN_WRITES at the brain commit this phase was
 * built against), as `METHOD path`. Every other owner route refuses them.
 * Also /api/grants and /api/workspaces, which answer every login.
 */
export const MEMBER_OPEN: readonly RegExp[] = [
  // Reads.
  rx('GET', `/api/(pages|notes|draws|tables|apps)`),
  rx('GET', `/api/(pages|notes|draws|tables|apps)/${ID}`),
  rx('GET', `/api/pages/${ID}/(backlinks|descendant-count)`),
  rx('GET', `/api/tables/${ID}/rows`),
  rx('GET', `/api/tree/${KIND}(/(search|tags|marks))?`),
  rx('GET', `/api/nodes/${ID}`),
  rx('GET', `/api/(search|mentions/search|formulas)`),
  rx('GET', `/api/formulas/${ID}`),
  rx('GET', `/api/files/(files|folders)`),
  rx('GET', `/api/files/folders/${ID}`),
  // A file's detail and text, and since W7e its bytes (?raw, ?thumb) and a
  // drawing's SVG, in the login's own scope.
  rx('GET', `/api/files/files/${ID}`),
  rx('GET', `/api/draws/${ID}/svg`),
  // The landing page of the current workspace (task d78e7bde).
  rx('GET', `/api/home`),
  // The app runner (W7e).
  rx('POST', `/api/apps/${ID}/(frame-ticket|db-broker|tool-broker)`),
  rx('GET', `/api/apps/${ID}/frame`),
  // Writes.
  rx('POST', `/api/(pages|notes|draws|tables|apps|files/files|files/folders)`),
  rx('(PATCH|DELETE)', `/api/(pages|notes|draws|tables|apps|files/files|files/folders)/${ID}`),
  rx('PUT', `/api/(pages|draws|tables|apps)/${ID}/draft`),
  rx('DELETE', `/api/apps/${ID}/draft`),
  rx('POST', `/api/(pages|draws|tables)/${ID}/(commit|discard-draft)`),
  rx('POST', `/api/pages/${ID}/move`),
  rx('POST', `/api/tables/${ID}/draft-ops`),
  rx('POST', `/api/apps/${ID}/(build|format|publish)`),
  rx('POST', `/api/tree/${KIND}/(folders|move)`),
  rx('(PATCH|DELETE)', `/api/tree/${KIND}/folders/${ID}`),
  rx('POST', `/api/tree/items/${ID}/opened`),
  rx('PUT', `/api/tree/items/${ID}/pin`),
  // Every login.
  /^[A-Z]+ \/api\/(grants|workspaces)(\/|$)/,
  // Every login's own chats (W7c). The live-stream sub-routes of a turn
  // (/turn/:id/stream, cancel, suggestion) and /turn/stage stay Admin-only.
  rx('GET', `/api/assistant/(thread|messages|threads|conversations|stream)`),
  rx('GET', `/api/assistant/threads/${ID}`),
  rx('POST', `/api/assistant/(turn|threads|read|transcribe)`),
  rx('POST', `/api/assistant/threads/${ID}/(continue|summarize)`),
  // Telegram per user (W7d): pair your own chat, your own chats, and the
  // chats of the bots you moderate.
  rx('GET', `/api/telegram/(my-chats|moderated-chats)`),
  rx('POST', `/api/telegram/pair`),
  rx('DELETE', `/api/telegram/my-chats/${ID}`),
  rx('POST', `/api/telegram/chats/${ID}/(block|unpair)`),
];

/** The paths a W6b or W7 brain answers 410, and the ones a W7e brain
 *  deprecated: THE list the app's source guard reads too
 *  (client/web/lib/gone-routes.ts). */
export { GONE_ROUTE } from '../../client/web/lib/gone-routes';

/** The requests (`METHOD /path`) that match none of `allowed`, where each
 *  allowed pattern is tested against the whole `METHOD /path`. */
export function outsideRoutes(asked: readonly string[], allowed: readonly RegExp[]): string[] {
  return asked.filter((r) => !allowed.some((re) => re.test(r)));
}
