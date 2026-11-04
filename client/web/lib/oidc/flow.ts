import type { OidcFreshProof, OidcHandoffPurpose, OidcStatusDTO } from '@mantle/client-types';
import { safeNext } from '@/lib/safe-next';

/**
 * A company sign-in handed to this client (brain docs/oidc-sign-in.md,
 * "Handing a sign-in to a client"). The page keeps a verifier, the person goes
 * to the provider in a browser, and the flow comes back to /auth/oidc with a
 * one-time code in the fragment.
 *
 * Every flow ends on that one page, on the web and in the desktop shell (which
 * loads it in the brain's window when `mantle://oidc` arrives). What the flow
 * was for lives in this tab's sessionStorage in between: it outlives the trip
 * to the provider, no other tab or brain window sees it, and a code that
 * arrives with nothing waiting is never spent.
 */

const FLOW_KEY = 'mantle.oidc.flow';
const OUTCOME_KEY = 'mantle.oidc.outcome';

/** A flow past this age is forgotten: the brain's own flow lasts 10 minutes. */
const FLOW_MAX_AGE_MS = 15 * 60_000;

export type PendingFlow = {
  purpose: OidcHandoffPurpose;
  verifier: string;
  /** The brain this page was talking to when the flow began. */
  brain: string;
  startedAt: number;
  /** An in-app path to land on. */
  next?: string;
  /** "Add a login": a sign-in that stops goes back to that screen. */
  add?: boolean;
  /** A link on a held ticket: there is no session to go back to. */
  held?: boolean;
};

/** What a flow that began in a screen came to, for that screen to read. */
export type FlowOutcome =
  | { purpose: 'link'; linked: true }
  | { purpose: 'link' | 'fresh'; result: string }
  | { purpose: 'fresh'; proof: OidcFreshProof };

function tab(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function readJson<T>(store: Storage, key: string): T | null {
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Keep a flow for its way back. False: this tab cannot keep it. */
export function savePendingFlow(flow: PendingFlow): boolean {
  const store = tab();
  if (!store) return false;
  try {
    store.setItem(FLOW_KEY, JSON.stringify(flow));
    return true;
  } catch {
    return false;
  }
}

export function readPendingFlow(now = Date.now()): PendingFlow | null {
  const store = tab();
  const flow = store ? readJson<PendingFlow>(store, FLOW_KEY) : null;
  if (!flow || typeof flow.verifier !== 'string' || now - flow.startedAt > FLOW_MAX_AGE_MS) {
    return null;
  }
  return flow;
}

export function clearPendingFlow(): void {
  try {
    tab()?.removeItem(FLOW_KEY);
  } catch {
    /* nothing kept to clear */
  }
}

export function saveOutcome(outcome: FlowOutcome): void {
  try {
    tab()?.setItem(OUTCOME_KEY, JSON.stringify(outcome));
  } catch {
    /* the screen then shows no result; the person can try again */
  }
}

/** The outcome of a flow for `purpose`, read once. */
export function takeOutcome(purpose: 'link' | 'fresh'): FlowOutcome | null {
  const store = tab();
  if (!store) return null;
  const outcome = readJson<FlowOutcome>(store, OUTCOME_KEY);
  if (!outcome || outcome.purpose !== purpose) return null;
  store.removeItem(OUTCOME_KEY);
  return outcome;
}

/** A flow's end, as the fragment says it. */
export type FlowEnd = { result: string; purpose: string | null; iss: string | null };

/** The fragment the brain sent (its `code` is taken apart: lib/link-code.ts). */
export function readFlowEnd(hash: string): FlowEnd | null {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  const result = q.get('oidc');
  return result ? { result, purpose: q.get('purpose'), iss: q.get('iss') } : null;
}

function originOf(url: string | null): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

/** What to do with what came back. */
export type Arrival =
  /** Nothing in the address: someone opened the page by hand. */
  | { kind: 'nothing' }
  /** Nothing is waiting for this answer, or it is for another purpose. */
  | { kind: 'no-flow' }
  /** It names another brain than the one this page talks to. */
  | { kind: 'other-brain' }
  | { kind: 'stopped'; flow: PendingFlow; result: string }
  | { kind: 'spend'; flow: PendingFlow; code: string }
  | { kind: 'fresh'; flow: PendingFlow; proof: OidcFreshProof };

/**
 * Pure, so each refusal is pinned by a test. The brain the answer names is
 * compared with `brain`, the origin this page connected to itself, never with
 * a value a brain told it (RFC 9207): a device can hold several brains, and a
 * code from another one must never be sent here.
 */
export function decideArrival(
  end: FlowEnd | null,
  code: string,
  flow: PendingFlow | null,
  brain: string,
): Arrival {
  if (!end) return { kind: 'nothing' };
  if (originOf(end.iss) !== originOf(brain)) return { kind: 'other-brain' };
  if (!flow || originOf(flow.brain) !== originOf(brain)) return { kind: 'no-flow' };
  if (end.result !== 'code') return { kind: 'stopped', flow, result: end.result };
  if (!code || end.purpose !== flow.purpose) return { kind: 'no-flow' };
  return flow.purpose === 'fresh'
    ? { kind: 'fresh', flow, proof: { code, verifier: flow.verifier } }
    : { kind: 'spend', flow, code };
}

/** Where a sign-in that stopped goes: the sign-in screen, saying why. */
export function signInStoppedPath(flow: PendingFlow, result: string): string {
  const q = new URLSearchParams({ oidc: result });
  const next = safeNext(flow.next);
  if (next) q.set('next', next);
  if (flow.add) q.set('add', '1');
  return `/login?${q.toString()}`;
}

/** The words for why a flow stopped. The provider's own text is never shown. */
export function flowStoppedMessage(result: string): string {
  switch (result) {
    case 'expired':
      return 'That sign-in took too long. Try again.';
    case 'cancelled':
      return 'Company sign-in was cancelled.';
    case 'unavailable':
      return 'Company sign-in cannot be reached now. Try again later.';
    case 'not-linked':
      return 'No login here uses that company account. Sign in with your password, then link it.';
    case 'not-allowed':
      return 'This login is turned off. Ask an admin.';
    case 'taken':
      return 'That company account is linked to another login.';
    case 'has-other':
      return 'This login holds another company account. Remove that link first.';
    case 'wrong-account':
      return 'You signed in with another account. Use the company account linked to this login.';
    default:
      return 'Company sign-in did not finish. Try again.';
  }
}

/**
 * Whether the menu offers "Change password": not where the password is no way
 * in (required mode, a linked login) and not where there is none. The brain
 * says so; nothing here works it out from how this session signed in. Whether
 * a change is DUE is the brain's too, for this request's own credential
 * (`mustChangePassword` on GET /api/auth/whoami): an SSO session of such a login
 * never gets it.
 */
export function changePasswordOffered(status: OidcStatusDTO): boolean {
  return status.mode === 'off' || status.passwordConfirms;
}
