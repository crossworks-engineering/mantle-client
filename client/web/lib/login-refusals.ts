/**
 * The brain's refusals about a former client login, in plain words
 * (workspaces W8). There is no client login since W8; the client logins a
 * brain had stay disabled, and their email and contact cannot come back as
 * a login:
 *
 *  - PATCH /api/users/:id enabling one answers 409 `former-client`;
 *  - POST /api/users and the invite create answer 409 `email-was-client`
 *    or `contact-was-client`, and so does a PATCH linking a login to the
 *    contact of one.
 *
 * And one about a System user (System workspace, audit r1): a password reset,
 * a disable, a sign out or a role change on a System user by an Admin user
 * outside System answers 403 `system_user_target`.
 *
 * Every refusal carries `{ error, reason }` (or `{ error, code }`). A known
 * reason or code gets the words below; any other refusal shows the brain's
 * own message, else the caller's fallback. Pure, pinned by login-refusals.test.ts. It reads an error by its
 * shape (the kit's ApiError: `status` and the parsed `body`), so the public
 * /invite page can use the words without the kit's fetch module.
 */

type Refusal = Error & { status?: unknown; body?: unknown };

const asRefusal = (err: unknown): Refusal | null =>
  err instanceof Error && typeof (err as Refusal).status === 'number' ? (err as Refusal) : null;

export const FORMER_CLIENT_ENABLE_TEXT =
  'This was a client login. It stays disabled and cannot be enabled again.';

export const EMAIL_WAS_CLIENT_TEXT =
  'That email belonged to a client login. It cannot be invited or given a new login.';

export const CONTACT_WAS_CLIENT_TEXT =
  'That contact belonged to a client login. It cannot be invited or given a new login.';

export const SYSTEM_USER_TARGET_TEXT = "Only a System user can change a System user's login.";

const TEXT_BY_REASON: Record<string, string> = {
  'former-client': FORMER_CLIENT_ENABLE_TEXT,
  'email-was-client': EMAIL_WAS_CLIENT_TEXT,
  'contact-was-client': CONTACT_WAS_CLIENT_TEXT,
  system_user_target: SYSTEM_USER_TARGET_TEXT,
};

/** A refusal body's reason, else its code, when the brain named one. */
export function bodyReason(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const { reason, code } = body as { reason?: unknown; code?: unknown };
  if (typeof reason === 'string') return reason;
  return typeof code === 'string' ? code : null;
}

/** The refusal's reason (or code), when the brain named one. */
export function refusalReason(err: unknown): string | null {
  return bodyReason(asRefusal(err)?.body);
}

/** The words for the reason, or null when it is not one of these. */
export function formerClientText(reason: unknown): string | null {
  return typeof reason === 'string' ? (TEXT_BY_REASON[reason] ?? null) : null;
}

/** The words for a refusal this map knows, or null. */
export function knownRefusalText(err: unknown): string | null {
  return formerClientText(refusalReason(err));
}

/** What the admin reads for a refused login change, create or invite. */
export function loginRefusalText(err: unknown, fallback: string): string {
  const known = knownRefusalText(err);
  if (known) return known;
  const r = asRefusal(err);
  if (r && r.message && r.status !== 401) return r.message;
  return fallback;
}
