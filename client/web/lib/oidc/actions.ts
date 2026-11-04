import type {
  AuthWhoami,
  OidcConfigDTO,
  OidcExchanged,
  OidcFreshStarted,
  OidcLinkStarted,
  OidcOfferDismissed,
  OidcRefusal,
} from '@mantle/client-types';
import { apiUrl, withAuth } from '@mantle/web-ui/api-fetch';
import { desktopShell } from '@mantle/web-ui/desktop-shell';
import { currentBrainOrigin } from '@mantle/web-ui/session-registry';
import { SIGN_IN_TIMEOUT_MS } from '@/lib/sign-in-error';
import { clearPendingFlow, savePendingFlow, type PendingFlow } from './flow';
import { challengeFor, newVerifier } from './pkce';

/**
 * The company sign-in calls. Raw `fetch`, never `apiFetch`: a link start
 * answers 401 for a password it needs or a wrong one, and `apiFetch` reads
 * every 401 as a dead session (lib/member-password.ts has the same story).
 */

/** Where the desktop shell's flows end. */
const APP_TARGET = 'mantle://oidc';

/** This client can end a flow here: a browser always can, a desktop shell only
 *  once it can open the browser and take `mantle://oidc` back. */
export function companySignInWorksHere(): boolean {
  const shell = desktopShell();
  return !shell || !!shell.oidc;
}

function target(): string {
  return desktopShell()?.oidc ? APP_TARGET : `${window.location.origin}/auth/oidc`;
}

/** GET /api/auth/oidc/config. A brain from before company sign-in, or one that
 *  cannot be read, is off: the sign-in screen stays as it is. */
export async function readOidcConfig(): Promise<OidcConfigDTO> {
  try {
    const res = await fetch(apiUrl('/api/auth/oidc/config'), {
      credentials: 'omit',
      signal: AbortSignal.timeout(SIGN_IN_TIMEOUT_MS),
    });
    if (!res.ok) return { mode: 'off' };
    const body = (await res.json()) as OidcConfigDTO;
    return body.mode === 'optional' || body.mode === 'required' ? body : { mode: 'off' };
  } catch {
    return { mode: 'off' };
  }
}

/** A flow's next step: on its way (a web page is leaving for the provider), or
 *  waiting for the person in the browser the desktop shell opened. */
export type FlowStarted = 'leaving' | 'in-browser';

const NOT_THIS_ADDRESS =
  "Company sign-in works only at this brain's public address. Open it there, and try again.";

/**
 * Take the person to the provider. A web page leaves; the desktop shell asks
 * the system's browser. The way there starts on the brain this page talks to,
 * or the flow could not come back here anyway (`iss` would name another
 * address): say so now, not after the provider.
 */
async function goToProvider(raw: string): Promise<FlowStarted> {
  const url = new URL(raw, window.location.href);
  if (url.origin !== currentBrainOrigin()) {
    clearPendingFlow();
    throw new Error(NOT_THIS_ADDRESS);
  }
  const oidc = desktopShell()?.oidc;
  if (!oidc) {
    window.location.assign(url.href);
    return 'leaving';
  }
  if (!(await oidc.open(url.href))) {
    clearPendingFlow();
    throw new Error('The browser did not open. Try again.');
  }
  return 'in-browser';
}

/** A flow begun: its verifier kept, and its challenge and target for the brain. */
async function beginFlow(flow: Omit<PendingFlow, 'verifier' | 'brain' | 'startedAt'>) {
  const verifier = newVerifier();
  const challenge = await challengeFor(verifier);
  const kept = savePendingFlow({
    ...flow,
    verifier,
    brain: currentBrainOrigin(),
    startedAt: Date.now(),
  });
  if (!kept) throw new Error('This browser is keeping nothing for this site. Allow site data.');
  return { redirect: target(), challenge };
}

/** Sign in with the company account. */
export async function startSignIn(opts: { next?: string; add?: boolean }): Promise<FlowStarted> {
  const { redirect, challenge } = await beginFlow({ purpose: 'signin', ...opts });
  const q = new URLSearchParams({ redirect, challenge });
  return goToProvider(apiUrl(`/api/auth/oidc/start?${q.toString()}`));
}

/** What a link start came to. */
export type LinkStart =
  | { kind: 'started'; how: FlowStarted }
  /** No ticket any more: ask for the password. */
  | { kind: 'password-needed'; message: string }
  /** The password typed was not this login's. */
  | { kind: 'wrong-password'; message: string }
  /** It cannot go on from here: a dead session, or a held ticket that ended. */
  | { kind: 'signed-out' }
  /** It holds a link already. */
  | { kind: 'already-linked' }
  | { kind: 'error'; message: string };

/**
 * POST /api/auth/oidc/link with the flow handed to this client.
 *
 * `held`: a login with no session yet, on the ticket its password sign-in
 * answered. It sends no credential at all: another login held on this device
 * would be read as the login that is linking. Otherwise the session's own
 * bearer, with the offer's ticket, or the password typed again.
 */
export async function startLink(opts: {
  held?: { ticket: string };
  ticket?: string;
  password?: string;
  next?: string;
  add?: boolean;
}): Promise<LinkStart> {
  const handoff = await beginFlow({
    purpose: 'link',
    ...(opts.next ? { next: opts.next } : {}),
    ...(opts.add ? { add: true } : {}),
    ...(opts.held ? { held: true } : {}),
  });
  const body = JSON.stringify({
    handoff,
    ...(opts.held ? { ticket: opts.held.ticket } : opts.ticket ? { ticket: opts.ticket } : {}),
    ...(opts.password ? { password: opts.password } : {}),
  });
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(SIGN_IN_TIMEOUT_MS),
  };
  const res = await fetch(
    apiUrl('/api/auth/oidc/link'),
    opts.held ? { ...init, credentials: 'omit' } : withAuth(init),
  );
  const answer = (await res.json().catch(() => ({}))) as Partial<OidcRefusal & OidcLinkStarted> & {
    message?: string;
  };
  if (res.ok && answer.url) return { kind: 'started', how: await goToProvider(answer.url) };
  clearPendingFlow();
  if (res.status === 401 && answer.code === 'password-needed') {
    return { kind: 'password-needed', message: answer.error ?? '' };
  }
  if (res.status === 401) {
    return opts.password
      ? { kind: 'wrong-password', message: 'That is not your password.' }
      : { kind: 'signed-out' };
  }
  if (res.status === 409 && answer.code === 'already-linked') return { kind: 'already-linked' };
  // A right password the box's password rule holds, or anything else.
  return {
    kind: 'error',
    message: answer.message ?? answer.error ?? 'Could not start the link. Try again.',
  };
}

/** POST /api/auth/oidc/fresh: confirm who this is with a new company sign-in. */
export async function startFresh(next: string): Promise<FlowStarted> {
  const handoff = await beginFlow({ purpose: 'fresh', next });
  const res = await fetch(
    apiUrl('/api/auth/oidc/fresh'),
    withAuth({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(handoff),
      signal: AbortSignal.timeout(SIGN_IN_TIMEOUT_MS),
    }),
  );
  const answer = (await res.json().catch(() => ({}))) as Partial<OidcFreshStarted> & {
    error?: string;
  };
  if (!res.ok || !answer.url) {
    clearPendingFlow();
    throw new Error(answer.error ?? 'Could not start the company sign-in. Try again.');
  }
  return goToProvider(answer.url);
}

/** The refusal of a spent code, or what it bought. */
export type Spent = { ok: true; answer: OidcExchanged } | { ok: false; result: string };

/** POST /api/auth/oidc/exchange. Public: the code and the verifier are the proof. */
export async function spendCode(code: string, verifier: string): Promise<Spent> {
  const res = await fetch(apiUrl('/api/auth/oidc/exchange'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, verifier, deviceName: 'Web client' }),
    credentials: 'omit',
    signal: AbortSignal.timeout(SIGN_IN_TIMEOUT_MS),
  });
  const answer = (await res.json().catch(() => null)) as
    (OidcExchanged & { code?: undefined }) | { code?: string } | null;
  if (res.ok && answer) return { ok: true, answer: answer as OidcExchanged };
  const refused = answer && 'code' in answer ? answer.code : undefined;
  return { ok: false, result: refused ?? 'expired' };
}

/** Who a bearer belongs to: GET /api/auth/whoami, sent with that bearer only. */
export async function whoamiOf(token: string): Promise<AuthWhoami | null> {
  const res = await fetch(apiUrl('/api/auth/whoami'), {
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'omit',
    signal: AbortSignal.timeout(SIGN_IN_TIMEOUT_MS),
  }).catch(() => null);
  return res?.ok ? ((await res.json().catch(() => null)) as AuthWhoami | null) : null;
}

/** POST /api/auth/oidc/offer: hide the link offer for 7 days. */
export async function dismissOffer(): Promise<OidcOfferDismissed | null> {
  const res = await fetch(apiUrl('/api/auth/oidc/offer'), withAuth({ method: 'POST' })).catch(
    () => null,
  );
  return res?.ok ? ((await res.json().catch(() => null)) as OidcOfferDismissed | null) : null;
}

/** What an unlink came to. */
export type Unlink = { ok: true } | { ok: false; message: string };

/** DELETE /api/auth/oidc/link: the login's sessions end with it. */
export async function unlinkSelf(): Promise<Unlink> {
  const res = await fetch(apiUrl('/api/auth/oidc/link'), withAuth({ method: 'DELETE' }));
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, message: body.error ?? 'Could not remove the link. Try again.' };
}
