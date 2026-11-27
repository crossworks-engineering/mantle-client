/**
 * The Secrets screen for every login (Secrets sharing, part S3). A secret is
 * a workspace kind on the brain since its migration 0400: a member opens the
 * secrets its workspaces read, as it opens a page.
 *
 * The client adds no rights rule. It asks the brain two things it already
 * says:
 *  - GET /api/shell `treeKinds`: the kinds this login browses as a tree. A
 *    brain with shared secrets names `secrets` there for a member.
 *  - the caps on each secret (`mayEdit`, `mayManage`, `mayMove`), read by
 *    `itemAccess` as on every item screen.
 *
 * A login with the keys area keeps the entry on any brain, as before. For
 * any other login the entry shows only when the brain names the kind, so a
 * brain before shared secrets does not offer a screen that only refuses.
 *
 * Pure helpers only: no DOM here. Pinned by secrets-screen.test.ts.
 */
import { ApiError } from '@mantle/web-ui/api-fetch';
import { hasArea, shellAreasOf } from './workspaces';

export const SECRETS_HREF = '/secrets';

/** What the screen says to a login the brain refuses (a brain before shared
 *  secrets, for a login without the keys area). */
export const SECRETS_REFUSED_TEXT = 'You have no access to secrets on this brain.';

/** What the detail pane says when the brain answers that a secret is not
 *  there: deleted, or no longer shared with the login. */
export const SECRET_GONE_TEXT = 'This secret is not there, or it is no longer shared with you.';

const isSecretsPath = (href: string): boolean =>
  href === SECRETS_HREF ||
  href.startsWith(`${SECRETS_HREF}/`) ||
  href.startsWith(`${SECRETS_HREF}?`);

/** Whether the shell offers the Secrets screen to its login: the keys area
 *  (every brain), or `secrets` among the shell's `treeKinds`. True for no
 *  shell yet, so nothing hides while it loads. */
export function secretsOfferedOf(shell: unknown): boolean {
  if (shell === null || typeof shell !== 'object') return true;
  const s = shell as { areas?: unknown; treeKinds?: unknown };
  if (hasArea(shellAreasOf(s), 'keys')) return true;
  return Array.isArray(s.treeKinds) && s.treeKinds.includes('secrets');
}

/** Whether the nav offers `href`. The sidebar and the search palette ask this. */
export function secretsOffered(href: string, offered: boolean): boolean {
  return offered || !isSecretsPath(href);
}

/** The nav without the Secrets row when the brain does not offer it. A
 *  hidden href leaves a collapsible group's cold-start head too, and a group
 *  left empty goes. */
export function withSecrets<
  G extends { items: { href: string }[]; defaultHead?: readonly string[] },
>(groups: readonly G[], offered: boolean): G[] {
  if (offered) return [...groups];
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => secretsOffered(i.href, offered)),
      ...(g.defaultHead
        ? { defaultHead: g.defaultHead.filter((h) => secretsOffered(h, offered)) }
        : {}),
    }))
    .filter((g) => g.items.length > 0);
}

/** How a failed read of the secrets, or of one secret, reads on the screen. */
export type SecretsFailure = 'refused' | 'gone' | 'error';

/** 403: the brain refuses the login. 404: the secret is not there for it.
 *  Anything else: a failure to try again. Never the error's own text: an
 *  error on this screen shows fixed words only. */
export function secretsFailureOf(err: unknown): SecretsFailure {
  if (err instanceof ApiError) {
    if (err.status === 403) return 'refused';
    if (err.status === 404) return 'gone';
  }
  return 'error';
}

/** A secret after a save: the brain's new row, with the caps and share
 *  marks the screen already holds where the answer carries none (a brain
 *  that sends no caps on a write). */
export function withKeptCaps<T extends object>(next: T, prev: object): T {
  const out = { ...next } as Record<string, unknown>;
  for (const k of ['mayEdit', 'mayManage', 'mayMove', 'workspaces', 'hasLink'] as const) {
    if (!(k in out) && k in prev) out[k] = (prev as Record<string, unknown>)[k];
  }
  return out as T;
}

/** What a person was doing when the brain refused or failed. */
export type SecretAct = 'reveal' | 'save' | 'create' | 'delete';

const ACT_REFUSED: Record<SecretAct, string> = {
  reveal: 'You cannot read this secret.',
  save: 'You cannot change this secret.',
  create: 'You cannot add a secret here.',
  delete: 'You cannot delete this secret.',
};

const ACT_FAILED: Record<SecretAct, string> = {
  reveal: 'Could not reveal this secret. Try again.',
  save: 'Could not save this secret. Check the fields and try again.',
  create: 'Could not save this secret. Check the fields and try again.',
  delete: 'Could not delete this secret. Try again.',
};

/** The toast for a failed act on a secret: fixed words by the status only.
 *  The brain's own error text is never shown here, so nothing a person
 *  typed into a secret can come back in a toast. */
export function secretFailureText(err: unknown, act: SecretAct): string {
  const failure = secretsFailureOf(err);
  if (failure === 'refused') return ACT_REFUSED[act];
  if (failure === 'gone' && act !== 'create') return SECRET_GONE_TEXT;
  return ACT_FAILED[act];
}
