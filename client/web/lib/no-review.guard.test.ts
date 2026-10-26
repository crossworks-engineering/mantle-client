import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * No review UI in the owner screens (W5c): workspaces replace review. There
 * is no submit, no waiting for approval, no Approve, Reject, Take over or
 * Discard of a submitted item, no "Shared by members" and no member app
 * review. Items are shared by grants to workspaces (the Grant Access panel).
 *
 * Every W5c part has landed: Team admin, the client sign-in page and the
 * review leftovers are gone, and the Users screen and the sign-in pages are
 * scanned like any other screen. The shared UI kit (packages/web-ui) and the
 * desktop shell (client/desktop) are scanned too: the review UI must not
 * come back through them. Paths are the repo's.
 */
const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const WEB = 'client/web/';
const ROOTS = [WEB, 'packages/web-ui/src/', 'client/desktop/src/'];

/** The review UI's words, its components and its routes. */
const NEEDLES: [string, RegExp][] = [
  ['Waiting for approval', /Waiting for approval/],
  ['Shared by members', /Shared by members/],
  ['Take over', /Take over/],
  ['ItemReview', /\bItemReview(Sections)?\b/],
  ['ReviewSections', /\b(Workspace|MemberApps)?ReviewSections\b/],
  ['MemberAppReview', /\bMemberAppReview\b/],
  ['useReviewOpen', /\buseReviewOpen\b/],
  ['the /review route', /['"`]\/review\b|\/apps\/review\b/],
  ['a ?review= selection', /[?&]review=/],
  ['the shared member items route', /\/api\/team-admin\/member-items/],
  // Routes a W5c brain answers 410: the UI asks none of them.
  ['the review queue route', /['"`]\/api\/team-admin\/submissions/],
  ['the needs-you route', /['"`]\/api\/team-admin\/needs-you/],
  ['the member app review route', /['"`]\/api\/apps\/members/],
  ['the send-back route', /\/send-back\b/],
  ['the take-over route', /\/take-over\b/],
  // The rest of the W5c brain's 410 routes (contract e1b3e5518).
  ['the requests and notify routes', /\/api\/team-admin\/(requests|notify)\b/],
  ['a Team admin clients route', /\/api\/team-admin\/clients(?!\/signin-sender)/],
  ['Accept or Give back', /\/api\/admin\/space\/[^'"`\s]+\/(accept|give-back)\b|\/give-back\b/],
  ['the client report route', /\/api\/access\/client-report/],
  ['team drafts', /\/api\/member\/team-drafts/],
  ['client requests', /\/api\/member\/client-requests|['"`]client-requests['"`]/],
  ['the member shell route', /\/api\/member\/shell\b/],
  [
    'Share, Submit or Recall of a member item',
    /\/api\/member\/space\/[^'"`\s]+\/(submit|recall|share)\b|\$\{ownItemPath\([^)]*\)\}\/(submit|recall|share)\b/,
  ],
  [
    'Submit or Recall of a member app',
    /\/api\/member\/my-apps\/[^'"`\s]+\/(submit|recall)\b|myAppActionPath\([^)]*'(submit|recall)'\)/,
  ],
  ['the client portal routes', /['"`]\/api\/client\//],
  ['the client link route', /\/api\/auth\/client-link/],
  // The member review leftovers (W5c UI fix round 2): the home's review
  // lists, the With admin screen and the sections above the member tree.
  ['reviewListPath', /\breviewListPath\b/],
  ['WITH_ADMIN_TEXT', /\bWITH_ADMIN_TEXT\b/],
  // A list, section or screen of 'with-admin' items. The state itself stays:
  // the brain still answers 409 `with-admin` and sends the rows, and the
  // editor, the autosave and the chip must still read them.
  [
    "a 'with-admin' list, section or screen",
    /review=with-admin|\[\s*['"`]with-admin['"`]\s*\]|['"`]member-home['"`],\s*['"`]with-admin['"`]|member-with-admin|\bstate(:|\s*===)\s*['"`]with-admin['"`]|With an admin|By me \(accepted\)/,
  ],
];

const SELF = `${WEB}lib/no-review.guard.test.ts`;

/** Name a needle on purpose, and are no review UI: the retired-path
 *  redirects (/review goes home), and the member space's own `review`
 *  filter (Mine by state, a kept member route). */
const NAMES_ON_PURPOSE = [
  'middleware.ts',
  'middleware.test.ts',
  // Lists the client report route as one the Users screen must not name.
  'app/(app)/settings/users/users-flat.test.ts',
  // Pins that the gone-route needles catch the client portal's routes (W8).
  'lib/no-gone-route.guard.test.ts',
  // THE list of gone routes: it names the Team admin clients and client link
  // routes so that no-gone-route.guard.test.ts keeps every file off them.
  'lib/gone-routes.ts',
].map((f) => WEB + f);

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(relative(REPO, path).split(sep).join('/'));
  }
  return out;
}

/** lib/contract/ holds verbatim copies of the brain's contract files, whose
 *  comments name what W5c removed (Take over, the review filter). They are
 *  types, not callers. */
const CONTRACT_COPIES = `${WEB}lib/contract/`;

const scanned = ROOTS.flatMap((r) => sources(join(REPO, r))).filter(
  (f) => f !== SELF && !NAMES_ON_PURPOSE.includes(f) && !f.startsWith(CONTRACT_COPIES),
);

describe('no review UI in the owner screens (W5c)', () => {
  it('scans the owner screens, the UI kit and the desktop shell', () => {
    for (const f of [
      'app/(app)/pages/pages-client.tsx',
      'app/(app)/notes/notes-client.tsx',
      'app/(app)/files/files-client.tsx',
      'app/(app)/draw/draws-client.tsx',
      'app/(app)/tables/tables-shell.tsx',
      'app/(app)/apps/apps-client.tsx',
      // Users and the sign-in pages (W5c, once the other parts landed).
      'app/(app)/settings/users/users-client.tsx',
      'app/(app)/settings/users/invites.tsx',
      'app/login/login-client.tsx',
      'app/invite/invite-client.tsx',
      // The shell's (W5c): the home (every login's landing page since task
      // d78e7bde), the rail and the member libs.
      'components/home/desk/desk-home.tsx',
      'components/home/landing-home.tsx',
      'components/layout/rail/profile-menu.tsx',
    ].map((f) => WEB + f)) {
      expect(scanned).toContain(f);
    }
    for (const f of [
      'packages/web-ui/src/session-registry.ts',
      'packages/web-ui/src/token-store.ts',
      'packages/web-ui/src/layout/nav-items.ts',
      'client/desktop/src/main/brain-fence.ts',
      'client/desktop/src/main/index.ts',
    ]) {
      expect(scanned).toContain(f);
    }
  });

  it.each(NEEDLES)('no file names %s', (_name, needle) => {
    const hits = scanned.filter((f) => needle.test(readFileSync(join(REPO, f), 'utf8')));
    expect(hits).toEqual([]);
  });

  it('the review screens, Team admin and the review leftovers are gone', () => {
    for (const gone of [
      'app/(app)/review',
      'app/(app)/apps/review',
      'app/(app)/team-admin',
      'app/client-signin',
      'components/review',
      'components/team-admin',
      'components/team-chat',
      'components/app-nav/member-app-review.tsx',
      'components/app-nav/member-app-activity.tsx',
      'components/app-nav/member-apps-review.tsx',
      'lib/workspace-review.ts',
      'lib/member-review.ts',
      'lib/needs-you.ts',
      // Named the items a Submit or a Give back refusal pointed at.
      'components/member/item-links-notice.tsx',
      // The With admin and By me (accepted) sections above the member tree,
      // and the section list they alone used.
      'components/member/member-item-sections.tsx',
      'components/item-list/list-sections.tsx',
    ]) {
      expect(existsSync(join(REPO, WEB, gone)), gone).toBe(false);
    }
  });
});
