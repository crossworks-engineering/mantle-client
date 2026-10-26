/**
 * A workspace's landing page (task d78e7bde): what every login's Desk reads
 * from GET /api/home?ws=, the workspace's home app and the hub data the
 * Desk and the home app show. The older GET /api/member/home shape
 * stays for reference only; this client reads /api/home.
 *
 * Copied from mantle packages/client-types/src/dto/member-apps.ts (task
 * d78e7bde), keeping only the home types; nothing here reads
 * /api/member/apps. Replace the copy by hand when the brain's file changes.
 * AppTint is the published package's.
 */
import type { AppTint } from '@mantle/client-types/app-nav';

/** The brain's pinned home app, when a member may run it. */
export type MemberHomeApp = {
  appId: string;
  title: string;
  icon: string | null;
  color: AppTint | null;
};

/**
 * GET /api/member/home: the pinned home app (null = the built-in Desk, and
 * then `hub` is null too) and what its `host.hub.get()` answers. A section's
 * token is a page id; an app card's token is an app id.
 *
 * `THub` is the hub payload, `HubData` from
 * `@mantle/share-ui/app-bridge-protocol`. The contract leaves it to the
 * client (share-ui depends on this package, so it cannot be named here):
 * write `MemberHomeData<HubData>`.
 */
export type MemberHomeData<THub = unknown> =
  { homeApp: MemberHomeApp; hub: THub } | { homeApp: null; hub: null };

/**
 * GET /api/home?ws=<id>: the landing page of a workspace, for every login
 * (task d78e7bde). Without `ws` it is "All my workspaces": the built-in
 * Desk over every workspace of the login, never a home app.
 *
 * `ws` echoes the workspace asked for (null: all). `homeApp` is the
 * workspace's home app when the workspace still holds it, its published
 * build is green and the login may run it; null means the built-in Desk.
 * `hub` is always there: the data of the built-in Desk and what a home
 * app's `host.hub.get()` answers, read in the login's scope and kept to
 * what the workspace reads (sections are its newest pages, counts its items
 * per kind, apps the other apps it holds that the login may run). A
 * workspace the login may not name is 404 `{ error, code: 'not_found' }`.
 *
 * `THub` is `HubData` from `@mantle/share-ui/app-bridge-protocol` (see
 * MemberHomeData).
 */
export type WorkspaceHomeData<THub = unknown> = {
  ws: string | null;
  homeApp: MemberHomeApp | null;
  hub: THub;
};
