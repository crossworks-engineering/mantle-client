import { describe, expect, it } from 'vitest';
import {
  answerText,
  askMany,
  blockedText,
  modeBody,
  nextStep,
  requiredWarning,
  FLEET_SSO_PATH,
  formRules,
  fromLabel,
  hasChange,
  linksText,
  parseAnswers,
  readAnswer,
  secretText,
  setBody,
  settleSso,
  ssoReasonText,
  testText,
  type FleetSsoAnswer,
  type FleetSsoAsk,
  type FleetSsoStatus,
} from './fleet-sso';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const call = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;

const status = (more: Partial<FleetSsoStatus> = {}): FleetSsoStatus => ({
  mode: 'setup',
  tenant: null,
  issuer: '',
  issuerFrom: 'none',
  clientId: '',
  clientIdFrom: 'none',
  secret: 'none',
  secretSetAt: null,
  redirectUri: 'https://box.example.invalid/api/auth/oidc/callback',
  missing: [],
  linked: null,
  active: null,
  ...more,
});

const answer = (more: Partial<FleetSsoAnswer>): FleetSsoAnswer => ({
  id: call(1),
  boxId: A,
  kind: 'sso',
  name: 'sso_status',
  by: 'it@example.com',
  at: '2026-11-12T10:00:00.000Z',
  ...more,
});

const EMPTY = { tenant: '', clientId: '', secret: '' };

describe('fleet sign-in (POST /api/fleet/sso)', () => {
  it('names its route', () => {
    expect(FLEET_SSO_PATH).toBe('/api/fleet/sso');
  });

  it('takes tenant and client in setup mode only, and never over the .env', () => {
    expect(formRules(status())).toEqual({ tenant: true, clientId: true, secret: true, test: true });
    expect(formRules(status({ issuerFrom: 'env', clientIdFrom: 'env' }))).toMatchObject({
      tenant: false,
      clientId: false,
      secret: true,
    });
    expect(formRules(status({ mode: 'optional' }))).toMatchObject({
      tenant: false,
      clientId: false,
      secret: true,
    });
    expect(formRules(status({ mode: 'off' }))).toEqual({
      tenant: false,
      clientId: false,
      secret: false,
      test: false,
    });
    expect(formRules(status({ secret: 'env' })).secret).toBe(false);
    // No status read yet: nothing to change, a Test may still ask.
    expect(formRules(null)).toEqual({ tenant: false, clientId: false, secret: false, test: true });
  });

  it('sends only the fields filled in that the box takes', () => {
    const rules = formRules(status({ issuerFrom: 'env' }));
    expect(setBody(A, { tenant: ' t ', clientId: '', secret: ' s ' }, rules, 'pw')).toEqual({
      do: 'set',
      boxId: A,
      secret: 's',
      password: 'pw',
    });
    expect(hasChange(EMPTY, rules)).toBe(false);
    expect(hasChange({ ...EMPTY, tenant: 'x' }, rules)).toBe(false);
    expect(hasChange({ ...EMPTY, secret: 'x' }, rules)).toBe(true);
  });

  it('says where a value comes from, and never the secret', () => {
    expect(fromLabel('env')).toBe('from .env');
    expect(fromLabel('row')).toBe('from Control Center');
    expect(fromLabel('none')).toBeNull();
    expect(secretText(status())).toBe('None');
    expect(secretText(status({ secret: 'env' }))).toBe('In .env');
    expect(secretText(status({ secret: 'row', secretSetAt: 'T' }), (t) => `at ${t}`)).toBe(
      'Set at T',
    );
    expect(linksText(status())).toBe('–');
    expect(linksText(status({ linked: 4, active: 3 }))).toBe('4 linked, 3 active');
  });

  it('puts every reason and Test code in plain words', () => {
    expect(ssoReasonText('scope')).toContain('MANTLE_CONTROL_CENTER_SCOPE');
    expect(ssoReasonText('bad-call')).toContain('Update it');
    expect(ssoReasonText('unreachable')).toContain('HTTPS');
    expect(ssoReasonText('http-502')).toBe('The box answered HTTP 502.');
    expect(ssoReasonText('something-new')).toBe('The call failed.');
    expect(testText('ok')).toMatchObject({ good: true, label: 'Passed' });
    expect(testText('secret-refused')).toMatchObject({ good: false, label: 'Secret refused' });
  });

  it('reads an answer: the box refusal, the Test, the cleared secret', () => {
    const refused = answer({
      name: 'sso_set',
      ok: false,
      reason: 'refused',
      output: { ok: false, reason: 'test', test: 'secret-refused' },
    });
    expect(readAnswer(refused)).toMatchObject({ ok: false, reason: 'test' });
    expect(answerText(refused).tone).toBe('bad');
    expect(answerText(refused).text).toContain('nothing was saved');

    const cleared = answer({
      name: 'sso_set',
      ok: true,
      output: { ok: true, secretCleared: true },
    });
    expect(answerText(cleared)).toMatchObject({ tone: 'warn' });
    expect(answerText(cleared).text).toContain('old secret was cleared');

    const late = answer({ ok: false, reason: 'unreachable' });
    expect(readAnswer(late)).toMatchObject({ ok: false, reason: 'unreachable' });

    const tested = answer({ name: 'sso_test', ok: true, output: { ok: true, test: 'ok' } });
    expect(answerText(tested).tone).toBe('ok');
  });

  it('holds the reply to its shape', () => {
    expect(parseAnswers(null)).toEqual({ answers: [], pending: [], gone: [] });
    expect(
      parseAnswers({ answers: [{ id: call(1), boxId: A }, { nope: 1 }], pending: [call(2), 3] }),
    ).toMatchObject({ answers: [{ id: call(1) }], pending: [call(2)], gone: [] });
  });

  it('asks again for the pending calls until none is left', async () => {
    const sent: FleetSsoAsk[] = [];
    const send = async (body: FleetSsoAsk) => {
      sent.push(body);
      return sent.length === 1
        ? { answers: [], pending: [call(2)], gone: [] }
        : { answers: [answer({ id: call(2) })], pending: [], gone: [] };
    };
    const all = await settleSso({ answers: [answer({})], pending: [call(2)], gone: [] }, send);
    expect(all.answers.map((a) => a.id)).toEqual([call(1), call(2)]);
    expect(all.pending).toEqual([]);
    expect(sent).toEqual([
      { do: 'answers', callIds: [call(2)] },
      { do: 'answers', callIds: [call(2)] },
    ]);
  });

  it('stops after the follow-ups run out', async () => {
    let asks = 0;
    const send = async () => {
      asks++;
      return { answers: [], pending: [call(2)], gone: [] };
    };
    const all = await settleSso({ answers: [], pending: [call(2)], gone: [] }, send, 2);
    expect(asks).toBe(2);
    expect(all.pending).toEqual([call(2)]);
  });

  it('asks many boxes 50 at a time', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `box-${i}`);
    const sizes: number[] = [];
    await askMany('status', ids, async (body) => {
      if (body.do === 'status') sizes.push(body.boxIds.length);
      return { answers: [], pending: [], gone: [] };
    });
    expect(sizes).toEqual([50, 1]);
  });

  it('offers one raise at a time, never down, and says why when it cannot', () => {
    const row = (mode: FleetSsoStatus['mode'], modeFrom?: FleetSsoStatus['modeFrom']) =>
      status({ mode, ...(modeFrom ? { modeFrom } : {}) });
    expect(nextStep(row('off', 'none'), null)).toEqual({
      mode: 'setup',
      label: 'Open setup',
      blocked: null,
    });
    // Turning on asks a passed Test first (the page's rule, not the box's).
    expect(nextStep(row('setup', 'row'), null)).toMatchObject({
      mode: 'optional',
      blocked: 'test',
    });
    expect(nextStep(row('setup', 'row'), 'secret-refused').blocked).toBe('test');
    expect(nextStep(row('setup', 'row'), 'ok')).toEqual({
      mode: 'optional',
      label: 'Turn on (optional)',
      blocked: null,
    });
    expect(nextStep(row('optional', 'row'), null)).toEqual({
      mode: 'required',
      label: 'Make required',
      blocked: null,
    });
    expect(nextStep(row('required', 'row'), 'ok')).toEqual({
      mode: null,
      label: null,
      blocked: 'top',
    });
    // A .env mode line wins; a box a release behind has no modeFrom.
    expect(nextStep(row('setup', 'env'), 'ok').blocked).toBe('env');
    expect(nextStep(row('off', 'env'), null).blocked).toBe('env');
    expect(nextStep(row('off'), null).blocked).toBe('old');
    expect(nextStep(null, null).blocked).toBe('none');
    for (const b of ['env', 'old', 'test', 'none', 'top'] as const) {
      expect(blockedText(b).length).toBeGreaterThan(10);
    }
    expect(blockedText('env')).toContain('--mode cc');
  });

  it('sends the raise with the password, and reads its answer', () => {
    expect(modeBody(A, 'optional', 'pw')).toEqual({
      do: 'mode',
      boxId: A,
      mode: 'optional',
      password: 'pw',
    });
    const raised = answer({
      name: 'sso_mode',
      ok: true,
      output: { ok: true, from: 'setup', status: status({ mode: 'optional' }) },
    });
    expect(answerText(raised)).toEqual({ tone: 'ok', text: 'Raised to Optional.' });
    const envWins = answer({
      name: 'sso_mode',
      ok: false,
      output: { ok: false, reason: 'env-wins' },
    });
    expect(answerText(envWins)).toMatchObject({ tone: 'bad' });
    expect(answerText(envWins).text).toContain('.env sets the mode');
    const mode = answer({ name: 'sso_mode', ok: false, output: { ok: false, reason: 'mode' } });
    expect(answerText(mode).text).toContain('one step up');
    // A box a release behind: the call's own code.
    expect(answerText(answer({ name: 'sso_mode', ok: false, reason: 'bad-call' })).text).toBe(
      ssoReasonText('bad-call'),
    );
  });

  it('warns before required: what it does, the numbers, the way back', () => {
    const lines = requiredWarning({ linked: 3, active: 5 });
    expect(lines.join(' ')).toContain('3 of 5 active logins are linked, 2 are not');
    expect(lines.join(' ')).toContain('original account');
    expect(lines.join(' ')).toContain('--mode optional');
    expect(requiredWarning({ linked: null, active: null }).join(' ')).toContain('0 of 0');
  });
});
