/**
 * User invites, the client's side. An admin makes an invite in Settings >
 * Users and hands over the link; the person opens /invite, sets a password
 * and has a login. What it reads comes from the workspaces an admin adds it
 * to.
 *
 * The public half cannot use `apiFetch`: the accept route answers every bad
 * code with a 401, and `apiFetch` reads a 401 as a dead session and sends the
 * browser to /login, which would throw the person off the page they are on.
 * So /invite reads the raw answers and this module says what they mean. Pure,
 * so each wording and each split is pinned by a test.
 */
import type { MemberInviteRow } from '@mantle/client-types';
import { formerClientText } from './login-refusals';
import { readLinkCode } from './link-code';
import { MAX_PASSWORD, MIN_PASSWORD } from './member-password';
import { OLD_RULE, passwordRuleError, type PasswordRule } from './password-rule';

export { MAX_PASSWORD, MIN_PASSWORD };

/** The invites route (GET, POST; DELETE /:id). Kept under Team admin's
 *  old name by the W5c brain contract: one constant, so a move is one line. */
export const INVITES_PATH = '/api/team-admin/invites';

/** One invite's route, for Revoke. */
export const invitePath = (id: string) => `${INVITES_PATH}/${encodeURIComponent(id)}`;

/** How long an invite lives, as the brain sets it (docs/member-logins.md §9). */
export const INVITE_LIFETIME_HOURS = 72;

/** The link an admin shares: the client's own origin plus the brain's
 *  `linkPath` (`/invite#code=…`; `/invite?code=…` from brains before the
 *  client logins audit fixes). */
export function inviteLink(origin: string, linkPath: string): string {
  const path = linkPath.startsWith('/') ? linkPath : `/${linkPath}`;
  return `${origin.replace(/\/+$/, '')}${path}`;
}

/**
 * The code in what a person typed or pasted: a bare invite code, or the whole
 * invite link. Codes are case sensitive and never contain spaces, so only
 * whitespace is dropped. Nothing else is judged here: whether a code redeems
 * is the brain's answer (an old 8-character team code gets its 404, the same
 * "not valid" as any other).
 */
export function readInviteCode(input: string): string {
  const raw = input.trim();
  if (/^https?:\/\//i.test(raw) || raw.startsWith('/invite')) {
    try {
      // The fragment's code first (`#code=`), else the query's.
      const { code } = readLinkCode(new URL(raw, 'http://invite.local').href);
      if (code) return code;
    } catch {
      // Not a URL after all: fall through and treat it as a code.
    }
  }
  return raw.replace(/\s+/g, '');
}

/** What the admin is told when a create is refused. `reason` is the brain's
 *  MemberInviteError reason (409 for an existing login or a former client
 *  login's email or contact, 400 otherwise). */
export function inviteCreateErrorText(
  status: number,
  body: { reason?: unknown; error?: unknown } | undefined,
): string {
  switch (body?.reason) {
    case 'email-has-login':
      return 'Someone already signs in with that email. Find them in Settings > Users.';
    case 'contact-has-login':
      return 'This contact already has a login. Find them in Settings > Users.';
    case 'no-email':
      return 'This contact has no email address. Enter the email the invite is for.';
    case 'contact-not-found':
      return 'That contact is not in this brain any more.';
    // A former client login's email or contact (W8): plain words, never the
    // reason code (lib/login-refusals.ts).
    case 'email-was-client':
    case 'contact-was-client':
      return formerClientText(body.reason) ?? 'Could not create the invite.';
  }
  if (status === 400) return 'Enter a valid email address.';
  if (typeof body?.error === 'string' && body.error) return body.error;
  return 'Could not create the invite. Try again.';
}

/** The open invites, newest first (the brain's order): the section above
 *  the logins in Settings > Users. Accepted ones are logins now, and
 *  expired ones need a new invite. */
export function openInvites(invites: readonly MemberInviteRow[] | undefined): MemberInviteRow[] {
  return (invites ?? []).filter((i) => i.state === 'open');
}

/** Who an invite is for, as a title: its name, else the contact's, else
 *  the email. */
export function inviteName(i: Pick<MemberInviteRow, 'displayName' | 'contactName' | 'email'>) {
  return i.displayName || i.contactName || i.email;
}

/** Shown when the preview answers 404: the code redeems nothing. */
export const INVITE_NOT_VALID =
  'This invite is not valid or has expired. Ask your admin for a new one.';

/** Shown when accept answers 401: the same words for every reason, as the
 *  brain gives the same answer for every reason. */
export const CODE_NOT_VALID = 'That code is not valid. Ask your admin for a new invite.';

export type InviteForm = { code: string; password: string; confirm: string };
export type InviteFormErrors = Partial<Record<keyof InviteForm, string>>;

/** The brain's rules, checked before anything is sent. */
export function validateInviteForm(f: InviteForm, rule: PasswordRule = OLD_RULE): InviteFormErrors {
  const errors: InviteFormErrors = {};
  const ruleError = f.password ? passwordRuleError(f.password, rule) : null;
  if (!readInviteCode(f.code)) errors.code = 'Enter your invite code.';
  if (!f.password) errors.password = 'Choose a password.';
  else if (ruleError) errors.password = ruleError;
  // The brain's own cap: above it the accept is refused as a bad request,
  // which read as "That code is not valid".
  else if (f.password.length > MAX_PASSWORD) errors.password = 'That password is too long.';
  if (!errors.password && f.confirm !== f.password) errors.confirm = 'The two passwords differ.';
  return errors;
}

export type AcceptOutcome =
  | { kind: 'ok'; email: string }
  /** The code redeems nothing: stay on the page and say so. */
  | { kind: 'bad-code'; message: string }
  /** A rule, the rate limit, the brain down: say it. */
  | { kind: 'error'; message: string };

/** What POST /api/auth/invite/accept's answer means. A 401 is never "signed
 *  out" here: nobody is signed in yet. */
export function acceptOutcome(status: number, body: unknown): AcceptOutcome {
  const b = body && typeof body === 'object' ? (body as { error?: unknown; email?: unknown }) : {};
  const error = typeof b.error === 'string' && b.error ? b.error : null;
  if (status >= 200 && status < 300) {
    return { kind: 'ok', email: typeof b.email === 'string' ? b.email : '' };
  }
  if (status === 401) return { kind: 'bad-code', message: CODE_NOT_VALID };
  if (status === 429)
    return { kind: 'error', message: error ?? 'Too many attempts. Try again in a minute.' };
  if (status === 400 && error) return { kind: 'error', message: error };
  return { kind: 'error', message: 'Could not accept the invite. Try again.' };
}

/** A contact picked in a dialog (Invite, a workspace's contact): its id, how it is
 *  named, and its email if it has one. */
export type PickedContact = { id: string; name: string; email: string | null };

/** What a New link for an invite starts with: what the invite was made with
 *  (its contact, its email and its own name), so the form shows what it
 *  sends. */
export function newLinkSeed(invite: MemberInviteRow): {
  contact: PickedContact | null;
  email: string;
  name: string;
} {
  return {
    contact: invite.contactId
      ? {
          id: invite.contactId,
          name: invite.contactName ?? inviteName(invite),
          email: invite.email,
        }
      : null,
    email: invite.email,
    name: invite.displayName ?? '',
  };
}
