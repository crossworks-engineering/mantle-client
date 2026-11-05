/**
 * Where a new item lands (workspaces W6b, contract item 3): every create
 * route takes `?ws=<workspaceId>`, the workspace the switcher shows. The
 * brain puts the item there when the login moderates it; when the login only
 * reads it, or when no workspace is named ("All my workspaces"), the brain
 * picks the home itself: the folder the item is made in when the login may
 * edit that folder, else the login's private workspace (an Admin user: the
 * folder, else Admin). A workspace the login is not in is refused (403
 * workspace, shown in the brain's words).
 *
 * The switcher's choice is held here too (CreateWorkspaceSync keeps it), so
 * a create made outside React (an upload, a mutation) reads it without a
 * hook.
 */
const CREATE_ROUTES = [
  /^\/api\/pages$/,
  /^\/api\/notes$/,
  /^\/api\/draws$/,
  /^\/api\/tables$/,
  /^\/api\/tables\/import$/,
  /^\/api\/apps$/,
  /^\/api\/files\/files$/,
  /^\/api\/files\/folders$/,
  /^\/api\/tree\/[a-z]+\/folders$/,
];

let current: string | null = null;

/** Keep the switcher's workspace (null: All my workspaces). */
export function setCreateWorkspace(id: string | null): void {
  current = id || null;
}

/** The workspace a create names now, or null. */
export function createWorkspace(): string | null {
  return current;
}

/** Whether `path` (no query) is a route that creates an item. */
export function isCreateRoute(path: string): boolean {
  const bare = path.split(/[?#]/)[0] ?? path;
  return CREATE_ROUTES.some((re) => re.test(bare));
}

/**
 * `path` with `ws=<id>` added when it is a create route and a workspace is
 * picked; else unchanged. `ws` defaults to the switcher's choice.
 */
export function withCreateWs(path: string, ws: string | null = current): string {
  if (!ws || !isCreateRoute(path)) return path;
  const [head, hash = ''] = path.split('#', 2) as [string, string?];
  const sep = head.includes('?') ? '&' : '?';
  return `${head}${sep}ws=${encodeURIComponent(ws)}${hash ? `#${hash}` : ''}`;
}

/** The rewrite apiFetch runs (setPathRewrite): a POST to a create route names
 *  the switcher's workspace. */
export function createWsRewrite(path: string, method: string): string {
  return method === 'POST' ? withCreateWs(path) : path;
}
