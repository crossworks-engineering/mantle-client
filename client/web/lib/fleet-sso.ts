/**
 * The Control Center's Fleet sign-in screen (POST /api/fleet/sso; mantle
 * docs/control-center.md, "The admin channel"): it stages each linked box's
 * company sign-in (Microsoft Entra OIDC), the tenant ID, the client ID and
 * the client secret. The secret is typed once and never shown again.
 *
 * One route, POST only, a Control Center only (404 elsewhere), body one of:
 *  - `{ do: 'list' }`: every box with its last sign-in view;
 *  - `{ do: 'status' | 'test', boxIds }`: ask 1 to 50 boxes;
 *  - `{ do: 'set', boxId, tenant?, clientId?, secret?, password }`;
 *  - `{ do: 'answers', callIds }`: the calls still pending (1 to 100).
 * The route waits up to 25 s, then hands back the ids still pending. The
 * Control Center saves each answer into the box's view, so the list is read
 * again after the answers come.
 *
 * The types are local: the published client types have no fleet sign-in
 * types (the other fleet screens type their routes here too). Pure but for
 * the default `send`, which loads the fetch helper when it runs.
 */
import { FLEET_PATH, reasonText } from './fleet';
import { testOutcomeText, type SsoSetupTestOutcome } from './sso-setup';

export const FLEET_SSO_PATH = `${FLEET_PATH}/sso`;
/** Under the Fleet key: a Fleet refresh reads it again too. */
export const FLEET_SSO_KEY = ['fleet', 'sso'];
/** The route's caps. */
export const MAX_SSO_BOXES = 50;
export const MAX_SSO_CALL_IDS = 100;
/** Pending calls are asked for again at most this many times (the route
 *  waits up to 25 s each time). */
export const SSO_FOLLOW_UPS = 4;

export type SsoMode = 'off' | 'setup' | 'optional' | 'required';
export type SsoFrom = 'env' | 'row' | 'none';

/** What a box says of its sign-in. Never a value of the secret. */
export type FleetSsoStatus = {
  mode: SsoMode;
  tenant: string | null;
  issuer: string;
  issuerFrom: SsoFrom;
  clientId: string;
  clientIdFrom: SsoFrom;
  secret: SsoFrom;
  secretSetAt: string | null;
  redirectUri: string;
  missing: string[];
  linked: number | null;
  active: number | null;
};

/** The Control Center's view of a box's sign-in, from its last answers. */
export type FleetSsoView = {
  at: string;
  /** The last call's failure code when no status came back. */
  reason: string | null;
  status: FleetSsoStatus | null;
  test: { code: string; at: string; by: string } | null;
  set: { fields: string[]; ok: boolean; reason: string | null; by: string; at: string } | null;
};

export type FleetSsoRow = {
  id: string;
  url: string;
  label: string | null;
  lastOkAt: string | null;
  lastReason: string | null;
  version: string | null;
  ssoView: FleetSsoView | null;
};

export type FleetSsoOutput = {
  ok: boolean;
  reason?: string | null;
  test?: string;
  secretCleared?: true;
  status?: FleetSsoStatus;
};

export type FleetSsoAnswer = {
  id: string;
  boxId: string;
  kind: 'sso';
  name: 'sso_status' | 'sso_set' | 'sso_test';
  by: string;
  at: string;
  done?: string;
  ok?: boolean;
  reason?: string | null;
  output?: FleetSsoOutput;
};

export type FleetSsoAnswers = { answers: FleetSsoAnswer[]; pending: string[]; gone: string[] };

export type FleetSsoAsk =
  | { do: 'list' }
  | { do: 'status' | 'test'; boxIds: string[] }
  | {
      do: 'set';
      boxId: string;
      tenant?: string;
      clientId?: string;
      secret?: string;
      password: string;
    }
  | { do: 'answers'; callIds: string[] };

// --- what the form may change ---------------------------------------------------------

/** Which fields of the form a box takes now. Tenant and client: only in
 *  setup mode, and only while the box .env does not hold them. Secret: in
 *  any mode but off, unless the .env holds it. No status: nothing yet. */
export function formRules(status: FleetSsoStatus | null): {
  tenant: boolean;
  clientId: boolean;
  secret: boolean;
  test: boolean;
} {
  if (!status) return { tenant: false, clientId: false, secret: false, test: true };
  const setup = status.mode === 'setup';
  return {
    tenant: setup && status.issuerFrom !== 'env',
    clientId: setup && status.clientIdFrom !== 'env',
    secret: status.mode !== 'off' && status.secret !== 'env',
    test: status.mode !== 'off',
  };
}

/** The set body: only the fields filled in, and only those the box takes. */
export function setBody(
  boxId: string,
  form: { tenant: string; clientId: string; secret: string },
  rules: { tenant: boolean; clientId: boolean; secret: boolean },
  password: string,
): Extract<FleetSsoAsk, { do: 'set' }> {
  const tenant = form.tenant.trim();
  const clientId = form.clientId.trim();
  const secret = form.secret.trim();
  return {
    do: 'set',
    boxId,
    ...(rules.tenant && tenant ? { tenant } : {}),
    ...(rules.clientId && clientId ? { clientId } : {}),
    ...(rules.secret && secret ? { secret } : {}),
    password,
  };
}

/** Whether the form holds anything to save. */
export function hasChange(
  form: { tenant: string; clientId: string; secret: string },
  rules: { tenant: boolean; clientId: boolean; secret: boolean },
): boolean {
  return (
    (rules.tenant && !!form.tenant.trim()) ||
    (rules.clientId && !!form.clientId.trim()) ||
    (rules.secret && !!form.secret.trim())
  );
}

// --- words ------------------------------------------------------------------------------

export function modeLabel(mode: SsoMode): string {
  return { off: 'Off', setup: 'Setup', optional: 'Optional', required: 'Required' }[mode];
}

/** The small mark beside a value: where it comes from. */
export function fromLabel(from: SsoFrom): string | null {
  if (from === 'env') return 'from .env';
  if (from === 'row') return 'from Control Center';
  return null;
}

/** The secret, in a few words. Never a value. `when` formats its time. */
export function secretText(
  status: Pick<FleetSsoStatus, 'secret' | 'secretSetAt'>,
  when: (iso: string) => string = (iso) => iso,
): string {
  if (status.secret === 'env') return 'In .env';
  if (status.secret === 'row')
    return status.secretSetAt ? `Set ${when(status.secretSetAt)}` : 'Set';
  return 'None';
}

/** Linked and active logins, as numbers. */
export function linksText(status: Pick<FleetSsoStatus, 'linked' | 'active'>): string {
  if (status.linked === null && status.active === null) return '–';
  return `${status.linked ?? '–'} linked, ${status.active ?? '–'} active`;
}

const TEST_LABEL: Record<string, string> = {
  ok: 'Passed',
  'secret-refused': 'Secret refused',
  unclear: 'Unclear',
  unreachable: 'Unreachable',
  'issuer-mismatch': 'Issuer mismatch',
  'env-missing': 'Missing from .env',
  'no-secret': 'No secret',
  'secret-unreadable': 'Secret unreadable',
};

/** A Test code in one or two words, and in a sentence. */
export function testText(code: string): { good: boolean; label: string; text: string } {
  const said = testOutcomeText(code as SsoSetupTestOutcome);
  return { good: said.good, label: TEST_LABEL[code] ?? code, text: said.text };
}

/** Plain words for a reason code: the box's own, or the call's. */
export function ssoReasonText(code: string | null): string {
  switch (code) {
    case null:
      return 'No answer yet.';
    case 'scope':
      return 'The box refuses Control Center calls: its MANTLE_CONTROL_CENTER_SCOPE is none.';
    case 'mode':
      return 'The sign-in mode on the box does not allow it: the mode is off, or a tenant or client ID was sent while the mode is not setup.';
    case 'env-wins':
      return 'The box .env holds that value, so it was not changed.';
    case 'test':
      return 'The Test of the new secret failed, so nothing was saved.';
    case 'replay':
      return 'The box refused the call as a repeat. Try again.';
    case 'busy':
      return 'The box is busy with other calls. Try again in a minute.';
    case 'bad-call':
      return 'The box runs an older release without company sign-in from the Control Center. Update it.';
    case 'expired':
      return 'The call was not sent in time, so it was dropped.';
    case 'refused':
      return 'The box refused the call.';
    case 'pending':
      return 'The box did not answer in time. Press Refresh later.';
    case 'gone':
      return 'The answer was not kept by the Control Center.';
    case 'off':
    case 'time':
    case 'sig':
    case 'unreachable':
    case 'bad-reply':
    case 'reply-too-large':
      return reasonText(code) ?? 'The call failed.';
    default:
      return /^http-\d{3}$/.test(code)
        ? (reasonText(code) ?? 'The call failed.')
        : 'The call failed.';
  }
}

/** One answer, read: ok or not, its reason, the Test's code, and whether
 *  the old secret was cleared. */
export function readAnswer(a: FleetSsoAnswer): {
  ok: boolean;
  reason: string | null;
  test: string | null;
  secretCleared: boolean;
} {
  const out = a.output;
  const ok = (a.ok ?? out?.ok) === true && (out ? out.ok === true : true);
  const reason = ok ? null : (out?.reason ?? a.reason ?? 'refused');
  return {
    ok,
    reason,
    test: typeof out?.test === 'string' ? out.test : null,
    secretCleared: out?.secretCleared === true,
  };
}

/** What a person reads after one answer of a box. */
export function answerText(a: FleetSsoAnswer): { tone: 'ok' | 'warn' | 'bad'; text: string } {
  const r = readAnswer(a);
  if (!r.ok) {
    const test = r.reason === 'test' && r.test ? ` ${testText(r.test).text}` : '';
    return { tone: 'bad', text: `${ssoReasonText(r.reason)}${test}` };
  }
  if (a.name === 'sso_test') {
    const t = r.test ? testText(r.test) : null;
    return t ? { tone: t.good ? 'ok' : 'bad', text: t.text } : { tone: 'ok', text: 'Tested.' };
  }
  if (a.name === 'sso_set') {
    const cleared = r.secretCleared
      ? ' The tenant or client changed, so the old secret was cleared: paste the secret of the new app.'
      : '';
    return { tone: r.secretCleared ? 'warn' : 'ok', text: `Saved.${cleared}` };
  }
  return { tone: 'ok', text: 'Status read.' };
}

// --- the asks ----------------------------------------------------------------------------

/** A POST to the route. */
export type SsoSend = (body: FleetSsoAsk) => Promise<unknown>;

const defaultSend: SsoSend = async (body) => {
  const { apiSend } = await import('@mantle/web-ui/api-fetch');
  return apiSend(FLEET_SSO_PATH, 'POST', body);
};

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** The route's reply, held to its shape. */
export function parseAnswers(raw: unknown): FleetSsoAnswers {
  const top = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const answers = (Array.isArray(top.answers) ? top.answers : []).filter(
    (a): a is FleetSsoAnswer =>
      !!a &&
      typeof a === 'object' &&
      typeof (a as FleetSsoAnswer).id === 'string' &&
      typeof (a as FleetSsoAnswer).boxId === 'string',
  );
  return { answers, pending: strings(top.pending), gone: strings(top.gone) };
}

/** Every box's list. */
export async function listSso(send: SsoSend = defaultSend): Promise<FleetSsoRow[]> {
  const raw = (await send({ do: 'list' })) as { boxes?: unknown } | null;
  return Array.isArray(raw?.boxes) ? (raw.boxes as FleetSsoRow[]) : [];
}

/** One ask (status, test or set): the first reply. */
export async function askSso(
  body: Exclude<FleetSsoAsk, { do: 'list' } | { do: 'answers' }>,
  send: SsoSend = defaultSend,
): Promise<FleetSsoAnswers> {
  return parseAnswers(await send(body));
}

/** Status or Test on many boxes: one ask per 50. */
export async function askMany(
  what: 'status' | 'test',
  boxIds: readonly string[],
  send: SsoSend = defaultSend,
): Promise<FleetSsoAnswers> {
  const out: FleetSsoAnswers = { answers: [], pending: [], gone: [] };
  for (let i = 0; i < boxIds.length; i += MAX_SSO_BOXES) {
    const r = await askSso({ do: what, boxIds: boxIds.slice(i, i + MAX_SSO_BOXES) }, send);
    out.answers.push(...r.answers);
    out.pending.push(...r.pending);
    out.gone.push(...r.gone);
  }
  return out;
}

/** Ask again for the calls still pending, until none is left or the
 *  follow-ups run out. What is still pending then stays in `pending`. */
export async function settleSso(
  first: FleetSsoAnswers,
  send: SsoSend = defaultSend,
  followUps: number = SSO_FOLLOW_UPS,
): Promise<FleetSsoAnswers> {
  const answers = [...first.answers];
  const gone = [...first.gone];
  let pending = [...first.pending];
  for (let round = 0; pending.length > 0 && round < followUps; round++) {
    const next: string[] = [];
    for (let i = 0; i < pending.length; i += MAX_SSO_CALL_IDS) {
      const r = parseAnswers(
        await send({ do: 'answers', callIds: pending.slice(i, i + MAX_SSO_CALL_IDS) }),
      );
      answers.push(...r.answers);
      gone.push(...r.gone);
      next.push(...r.pending);
    }
    pending = next;
  }
  return { answers, pending, gone };
}
