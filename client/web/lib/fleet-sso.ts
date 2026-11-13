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
 *  - `{ do: 'mode', boxId, mode, password }`: raise the box's sign-in mode
 *    one step (off, setup, optional, required), never down; the box holds
 *    the rule, and a mode line in its .env always wins;
 *  - `{ do: 'answers', callIds }`: the calls still pending (1 to 100).
 * The Control Center's own box is the target `self` (`boxIds: ['self']`,
 * `boxId: 'self'`): the route runs the box's own code at once, so its one
 * answer comes back with no pending ids, and the Control Center keeps no
 * view of it: the page holds it (selfView).
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
/** What the Control Center may raise a box to, one step at a time. */
export type SsoStep = Exclude<SsoMode, 'off'>;
export type SsoFrom = 'env' | 'row' | 'none';

/** What a box says of its sign-in. Never a value of the secret. */
export type FleetSsoStatus = {
  mode: SsoMode;
  /** Where the mode comes from: the box .env (the Control Center cannot
   *  raise it), the Control Center, or neither (off). Absent from a box a
   *  release behind. */
  modeFrom?: SsoFrom;
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
  /** The last raise of the mode: the mode asked, and the one before. */
  mode?: {
    to: string;
    from: string | null;
    ok: boolean;
    reason: string | null;
    by: string;
    at: string;
  } | null;
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
  /** sso_mode: the mode before the raise. */
  from?: string;
  status?: FleetSsoStatus;
};

export type FleetSsoAnswer = {
  id: string;
  boxId: string;
  kind: 'sso';
  name: 'sso_status' | 'sso_set' | 'sso_test' | 'sso_mode';
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
  | { do: 'mode'; boxId: string; mode: SsoStep; password: string }
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

// --- the one-way mode ------------------------------------------------------------------

/** The next step up and its button's word. */
const NEXT: Record<SsoMode, { mode: SsoStep; label: string } | null> = {
  off: { mode: 'setup', label: 'Open setup' },
  setup: { mode: 'optional', label: 'Turn on (optional)' },
  optional: { mode: 'required', label: 'Make required' },
  required: null,
};

/**
 * The one raise the page offers a box now, or why none. The Control Center
 * raises one step at a time and never lowers (the box holds that rule too):
 *  - `env`: the box .env sets the mode, which always wins;
 *  - `old`: the box runs a release before the raise;
 *  - `top`: required already;
 *  - `test`: setup, and the last Test did not pass (the page asks a passed
 *    Test before turning sign-in on; the box does not);
 *  - `none`: no status read yet.
 */
export function nextStep(
  status: FleetSsoStatus | null,
  lastTest: string | null,
):
  | { mode: SsoStep; label: string; blocked: null | 'env' | 'old' | 'test' }
  | { mode: null; label: null; blocked: 'none' | 'top' } {
  if (!status) return { mode: null, label: null, blocked: 'none' };
  const next = NEXT[status.mode];
  if (!next) return { mode: null, label: null, blocked: 'top' };
  if (status.modeFrom === 'env') return { ...next, blocked: 'env' };
  if (status.modeFrom === undefined) return { ...next, blocked: 'old' };
  if (next.mode === 'optional' && lastTest !== 'ok') return { ...next, blocked: 'test' };
  return { ...next, blocked: null };
}

/** Why the raise button is off, in a sentence. */
export function blockedText(blocked: 'env' | 'old' | 'test' | 'none' | 'top'): string {
  switch (blocked) {
    case 'env':
      return 'Set in .env: the box .env holds MANTLE_OIDC_MODE, which always wins. Remove it with scripts/sso-env.sh <box> --mode cc to raise the mode from here.';
    case 'old':
      return 'The box runs an older release without the raise from the Control Center. Update it.';
    case 'test':
      return 'Run a Test first. Sign-in turns on only after a Test passes.';
    case 'none':
      return 'Read the status first.';
    case 'top':
      return 'Required is the top mode. The way down is the box .env (scripts/sso-env.sh <box> --mode optional).';
  }
}

/** A stored status older than this is read again when its box opens. */
export const SSO_STATUS_MAX_AGE_MS = 10 * 60_000;

/** Whether opening a box reads its status by itself, once: the Control
 *  Center holds no status for it, or the one it holds is old. */
export function needsRead(view: Pick<FleetSsoView, 'at' | 'status'> | null, now: number): boolean {
  if (!view?.status) return true;
  const at = Date.parse(view.at);
  return !Number.isFinite(at) || now - at > SSO_STATUS_MAX_AGE_MS;
}

/** Whether opening the list reads every box by itself, once: no box has a
 *  status yet. */
export function needsReadAll(rows: readonly Pick<FleetSsoRow, 'ssoView'>[]): boolean {
  return rows.length > 0 && rows.every((r) => !r.ssoView?.status);
}

/**
 * What the Sign-in mode part shows, so it never shows no button and no
 * reason:
 *  - `raise`: the raise button, off with its reason when blocked;
 *  - `wait`: no status yet and the status is being read: a spinner button;
 *  - `read`: no status: the reason (the failed read, or none yet) and a
 *    Read status button;
 *  - `top`: required already: no button, the sentence says why.
 */
export function modeControl(
  status: FleetSsoStatus | null,
  lastTest: string | null,
  reading: boolean,
  failed: string | null,
):
  | { act: 'raise'; mode: SsoStep; label: string; text: string | null; blocked: boolean }
  | { act: 'wait'; label: string; text: null }
  | { act: 'read'; label: string; text: string }
  | { act: 'top'; text: string } {
  if (!status) {
    if (reading) return { act: 'wait', label: 'Reading status', text: null };
    return { act: 'read', label: 'Read status', text: failed ?? blockedText('none') };
  }
  const next = nextStep(status, lastTest);
  if (!next.mode) return { act: 'top', text: blockedText('top') };
  return {
    act: 'raise',
    mode: next.mode,
    label: next.label,
    text: next.blocked ? blockedText(next.blocked) : null,
    blocked: next.blocked !== null,
  };
}

/** Why the staging fields are off, when the mode is: off opens nothing. */
export function stageText(status: Pick<FleetSsoStatus, 'mode'> | null): string | null {
  if (status?.mode !== 'off') return null;
  return `The fields open in setup mode. Press ${NEXT.off!.label} first.`;
}

/** The raise body. */
export function modeBody(
  boxId: string,
  mode: SsoStep,
  password: string,
): Extract<FleetSsoAsk, { do: 'mode' }> {
  return { do: 'mode', boxId, mode, password };
}

/** What the warning before "Make required" says: what required does, the
 *  numbers, and the way back. `self`: the box is this Control Center, the
 *  one the person is signed in to, so their own session ends too unless they
 *  are the original account (an Admin cannot be marked outside). */
export function requiredWarning(
  status: Pick<FleetSsoStatus, 'linked' | 'active'>,
  self = false,
): string[] {
  const linked = status.linked ?? 0;
  const active = status.active ?? 0;
  const unlinked = Math.max(active - linked, 0);
  return [
    self
      ? 'This is the box you are signed in to. Every password session on it ends, yours too, unless you are the original account. Only the original account and honoured outside marks keep their passwords: keep the original account at hand.'
      : 'Every password session on the box ends, except those of the original account and of honoured outside marks, which keep their passwords.',
    'Linked logins then sign in with the company account only.',
    `Unlinked logins sign in with their password once and must link. Now: ${linked} of ${active} active logins are linked, ${unlinked} are not.`,
    self
      ? 'Nothing on this page can lower the mode. The way back is optional in the .env of this box (scripts/sso-env.sh <box> --mode optional).'
      : 'The Control Center cannot lower the mode. The way back is optional in the box .env (scripts/sso-env.sh <box> --mode optional).',
  ];
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

/** Why a box refused a raise. */
export function modeRefusalText(reason: 'env-wins' | 'mode'): string {
  return reason === 'env-wins'
    ? 'The box .env sets the mode, which always wins, so it was not raised.'
    : 'Not one step up from the mode the box runs now, or required cannot work on the box yet (its sign-in settings must be on). Read the status and try again.';
}

/** What a person reads after one answer of a box. */
export function answerText(a: FleetSsoAnswer): { tone: 'ok' | 'warn' | 'bad'; text: string } {
  const r = readAnswer(a);
  if (!r.ok) {
    if (a.name === 'sso_mode' && (r.reason === 'env-wins' || r.reason === 'mode')) {
      return { tone: 'bad', text: modeRefusalText(r.reason) };
    }
    const test = r.reason === 'test' && r.test ? ` ${testText(r.test).text}` : '';
    return { tone: 'bad', text: `${ssoReasonText(r.reason)}${test}` };
  }
  if (a.name === 'sso_mode') {
    const to = a.output?.status?.mode;
    return { tone: 'ok', text: to ? `Raised to ${modeLabel(to)}.` : 'Raised.' };
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

// --- the Microsoft side ----------------------------------------------------------------

/** One step of the click path in the Entra admin center. `values` are what
 *  the person types or picks there, each with a copy button. */
export type EntraStep = {
  title: string;
  text: string[];
  values: { label: string; value: string }[];
};

/** The name of the box's app in Entra: Mantle and the box host. */
export function entraAppName(url: string): string {
  try {
    return `Mantle ${new URL(url).host}`;
  } catch {
    return `Mantle ${url}`;
  }
}

/** Whether the Microsoft steps show open: in off and setup, where the app
 *  is still made. In optional and required they fold away. */
export function entraOpen(mode: SsoMode): boolean {
  return mode === 'off' || mode === 'setup';
}

export const ENTRA_FOLDED =
  'Sign-in is on. Show the Microsoft steps again, for example for a new secret.';

/**
 * The click path in the Entra admin center for one box, from mantle
 * docs/oidc-entra.md ("In the Entra admin center"), with this box's own
 * values. Menu names are Microsoft's; they change often.
 */
export function entraSteps(box: { url: string }, redirectUri: string): EntraStep[] {
  const app = entraAppName(box.url);
  return [
    {
      title: 'Entra ID > App registrations > New registration',
      text: [
        'Make one app for this box.',
        'Supported account types: Single tenant only.',
        'Redirect URI: pick the platform Web, and paste the address below.',
      ],
      values: [
        { label: 'Name', value: app },
        { label: 'Redirect URI (Web)', value: redirectUri },
      ],
    },
    {
      title: "On the app's Overview",
      text: [
        'Copy the Directory (tenant) ID. It goes in Tenant ID on this page.',
        'Copy the Application (client) ID. It goes in Client ID on this page.',
      ],
      values: [],
    },
    {
      title: 'Certificates & secrets > Client secrets > New client secret',
      text: [
        'Copy the Value. Not the Secret ID. Microsoft shows the Value only once.',
        'The Value goes in Client secret on this page.',
        'The secret has an end date. Put that date in a calendar: sign-in stops on that day.',
      ],
      values: [],
    },
    {
      title: 'Token configuration > Add optional claim',
      text: ['Token type: ID. Claim: auth_time.'],
      values: [{ label: 'Claim', value: 'auth_time' }],
    },
    {
      title: 'Entra ID > Enterprise apps > All applications',
      text: [
        'Open the app of this box. Entra made it at the registration.',
        'Properties: set Assignment required? to Yes.',
        'Users and groups > Add user/group: add the people or groups who may sign in to this box. Entra refuses a person who is not assigned.',
      ],
      values: [{ label: 'App', value: app }],
    },
    {
      title: 'On this page',
      text: [
        'Open setup, if the mode is still off.',
        'Under Stage the sign-in, paste the tenant ID, the client ID and the secret Value. Save.',
        'Then Test. Then Turn on (optional).',
      ],
      values: [],
    },
  ];
}

// --- this box: the Control Center itself -------------------------------------------------

/** The route's target for the Control Center's own box. */
export const SELF = 'self';
/** Under the sign-in key: a Fleet refresh reads this box's status again too. */
export const FLEET_SSO_SELF_KEY = [...FLEET_SSO_KEY, SELF];

/**
 * This box's view after its answers. The Control Center keeps no view of
 * its own box, so the page holds it, as the Control Center holds a fleet
 * box's: a new status replaces the old, a Test's code is kept, and a save
 * that went through makes the last Test stale (unless it ran its own). A
 * reload drops it, so Turn on asks a new Test. No last save or raise: the
 * answer shows at once on the pane.
 */
export function selfView(
  prev: FleetSsoView | null,
  all: FleetSsoAnswers,
  now: string,
): FleetSsoView | null {
  let view = prev;
  for (const a of all.answers) {
    if (a.boxId !== SELF) continue;
    const r = readAnswer(a);
    const status = a.output?.status ?? null;
    view = {
      at: now,
      reason: status ? null : (r.reason ?? 'refused'),
      status: status ?? view?.status ?? null,
      test: r.test
        ? { code: r.test, at: now, by: a.by }
        : a.name === 'sso_set' && r.ok
          ? null
          : (view?.test ?? null),
      set: null,
      mode: null,
    };
  }
  return view;
}

/** This box as a row of the list: its own name, its address (the redirect
 *  URI's origin once a status names it, else `fallbackUrl`), and the view
 *  the page holds. */
export function selfRow(name: string, fallbackUrl: string, view: FleetSsoView | null): FleetSsoRow {
  let url = fallbackUrl;
  try {
    if (view?.status?.redirectUri) url = new URL(view.status.redirectUri).origin;
  } catch {
    // A status with no usable redirect URI keeps the fallback.
  }
  return {
    id: SELF,
    url,
    label: name,
    lastOkAt: null,
    lastReason: null,
    version: null,
    ssoView: view,
  };
}

/** This box's status, read live (one ask), folded into the view the page
 *  holds so a read keeps the last Test. */
export async function readSelf(
  prev: FleetSsoView | null,
  send: SsoSend = defaultSend,
  now: () => string = () => new Date().toISOString(),
): Promise<FleetSsoView | null> {
  return selfView(prev, await askSso({ do: 'status', boxIds: [SELF] }, send), now());
}
