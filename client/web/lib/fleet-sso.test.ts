import { describe, expect, it } from 'vitest';
import {
  answerText,
  askMany,
  blockedText,
  ENTRA_FOLDED,
  entraAppName,
  entraOpen,
  entraSteps,
  modeBody,
  nextStep,
  requiredWarning,
  FLEET_SSO_KEY,
  FLEET_SSO_PATH,
  FLEET_SSO_SELF_KEY,
  formRules,
  fromLabel,
  hasChange,
  linksText,
  modeControl,
  needsRead,
  needsReadAll,
  parseAnswers,
  readAnswer,
  readSelf,
  secretText,
  SELF,
  selfRow,
  selfView,
  setBody,
  settleSso,
  SSO_STATUS_MAX_AGE_MS,
  ssoReasonText,
  stageText,
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
  it('reads a status by itself on open: none held, or an old one', () => {
    const at = '2026-11-12T10:00:00.000Z';
    const t = Date.parse(at);
    expect(needsRead(null, t)).toBe(true);
    expect(needsRead({ at, status: null }, t)).toBe(true);
    expect(needsRead({ at, status: status() }, t)).toBe(false);
    expect(needsRead({ at, status: status() }, t + SSO_STATUS_MAX_AGE_MS)).toBe(false);
    expect(needsRead({ at, status: status() }, t + SSO_STATUS_MAX_AGE_MS + 1)).toBe(true);
    expect(needsRead({ at: 'not a time', status: status() }, t)).toBe(true);
    expect(SSO_STATUS_MAX_AGE_MS).toBe(10 * 60_000);
  });

  it('reads every box on open only when no box has a status', () => {
    const view = { at: '2026-11-12T10:00:00.000Z', reason: null, test: null, set: null };
    expect(needsReadAll([])).toBe(false);
    expect(needsReadAll([{ ssoView: null }, { ssoView: { ...view, status: null } }])).toBe(true);
    expect(needsReadAll([{ ssoView: null }, { ssoView: { ...view, status: status() } }])).toBe(
      false,
    );
  });

  it('always shows a mode control or a reason, never neither', () => {
    // No status: a spinner while the read runs, then the reason and Read status.
    expect(modeControl(null, null, true, null)).toEqual({
      act: 'wait',
      label: 'Reading status',
      text: null,
    });
    expect(modeControl(null, null, false, null)).toEqual({
      act: 'read',
      label: 'Read status',
      text: blockedText('none'),
    });
    const failed = ssoReasonText('unreachable');
    expect(modeControl(null, null, false, failed)).toEqual({
      act: 'read',
      label: 'Read status',
      text: failed,
    });
    // A status: the raise, off with the existing sentence when blocked.
    expect(modeControl(status({ mode: 'off', modeFrom: 'none' }), null, false, null)).toEqual({
      act: 'raise',
      mode: 'setup',
      label: 'Open setup',
      text: null,
      blocked: false,
    });
    expect(modeControl(status({ mode: 'setup', modeFrom: 'row' }), null, true, null)).toEqual({
      act: 'raise',
      mode: 'optional',
      label: 'Turn on (optional)',
      text: blockedText('test'),
      blocked: true,
    });
    expect(modeControl(status({ mode: 'off', modeFrom: 'env' }), null, false, null)).toMatchObject({
      act: 'raise',
      text: blockedText('env'),
      blocked: true,
    });
    expect(modeControl(status({ mode: 'off' }), null, false, null)).toMatchObject({
      act: 'raise',
      text: blockedText('old'),
      blocked: true,
    });
    expect(modeControl(status({ mode: 'required', modeFrom: 'row' }), 'ok', false, null)).toEqual({
      act: 'top',
      text: blockedText('top'),
    });
    // Every state has a button or a sentence.
    for (const c of [
      modeControl(null, null, true, null),
      modeControl(null, null, false, null),
      modeControl(status({ mode: 'required', modeFrom: 'row' }), null, false, null),
    ]) {
      expect('label' in c || c.text).toBeTruthy();
    }
  });

  it('says why the staging fields are off in mode off, and names the button', () => {
    expect(stageText(status({ mode: 'off' }))).toBe(
      'The fields open in setup mode. Press Open setup first.',
    );
    expect(stageText(status({ mode: 'off' }))).toContain(
      nextStep(status({ mode: 'off', modeFrom: 'none' }), null).label!,
    );
    for (const mode of ['setup', 'optional', 'required'] as const) {
      expect(stageText(status({ mode }))).toBeNull();
    }
    // No status: the Sign-in mode part says what to do.
    expect(stageText(null)).toBeNull();
  });
  it('walks the Microsoft side with the values of this box', () => {
    const uri = 'https://box-a.example.invalid/api/auth/oidc/callback';
    expect(entraAppName('https://box-a.example.invalid')).toBe('Mantle box-a.example.invalid');
    expect(entraAppName('https://box-a.example.invalid:8443/x')).toBe(
      'Mantle box-a.example.invalid:8443',
    );
    expect(entraAppName('not a url')).toBe('Mantle not a url');
    const steps = entraSteps({ url: 'https://box-a.example.invalid' }, uri);
    const all = steps.flatMap((s) => [s.title, ...s.text]).join(' ');
    const values = steps.flatMap((s) => s.values.map((v) => v.value));
    // The doc's menus, in its order.
    expect(steps.map((s) => s.title)).toEqual([
      'Entra ID > App registrations > New registration',
      "On the app's Overview",
      'Certificates & secrets > Client secrets > New client secret',
      'Token configuration > Add optional claim',
      'Entra ID > Enterprise apps > All applications',
      'On this page',
    ]);
    // The box's own values, each one to copy.
    expect(values).toEqual([
      'Mantle box-a.example.invalid',
      uri,
      'auth_time',
      'Mantle box-a.example.invalid',
    ]);
    expect(all).toContain('Single tenant only');
    expect(all).toContain('platform Web');
    expect(all).toContain('Assignment required? to Yes');
    expect(all).toContain('Add user/group');
    // Where each Microsoft value goes on this page.
    expect(all).toContain('Directory (tenant) ID. It goes in Tenant ID');
    expect(all).toContain('Application (client) ID. It goes in Client ID');
    expect(all).toContain('Copy the Value. Not the Secret ID.');
    expect(all).toContain('calendar');
    expect(all).toMatch(/Then Test\. Then Turn on \(optional\)\.$/);
    // No terminal: no script and no .env.
    expect(all).not.toMatch(/scripts\/|\.sh|\.env/);
  });

  it('shows the Microsoft steps open in off and setup, folded once sign-in is on', () => {
    expect(entraOpen('off')).toBe(true);
    expect(entraOpen('setup')).toBe(true);
    expect(entraOpen('optional')).toBe(false);
    expect(entraOpen('required')).toBe(false);
    expect(ENTRA_FOLDED).toContain('new secret');
  });
});

describe('this box: the Control Center itself (target self)', () => {
  const NOW = '2026-11-13T09:00:00.000Z';
  const LATER = '2026-11-13T09:05:00.000Z';
  const mine = (more: Partial<FleetSsoAnswer>) => answer({ boxId: SELF, ok: true, ...more });
  const one = (a: FleetSsoAnswer) => ({ answers: [a], pending: [], gone: [] });

  it('is the target self, and its key sits under the sign-in key', () => {
    expect(SELF).toBe('self');
    expect(FLEET_SSO_SELF_KEY).toEqual([...FLEET_SSO_KEY, 'self']);
  });

  it('a status read makes the view; a Test keeps its code; a later read keeps the Test', () => {
    const v1 = selfView(null, one(mine({ output: { ok: true, status: status() } })), NOW);
    expect(v1).toEqual({
      at: NOW,
      reason: null,
      status: status(),
      test: null,
      set: null,
      mode: null,
    });
    const v2 = selfView(
      v1,
      one(mine({ name: 'sso_test', output: { ok: true, test: 'ok', status: status() } })),
      LATER,
    );
    expect(v2!.test).toEqual({ code: 'ok', at: LATER, by: 'it@example.com' });
    const v3 = selfView(
      v2,
      one(mine({ output: { ok: true, status: status({ mode: 'optional' }) } })),
      LATER,
    );
    expect(v3!.test?.code).toBe('ok');
    expect(v3!.status?.mode).toBe('optional');
  });

  it('a save that went through makes the Test stale, unless it ran its own', () => {
    const tested = selfView(
      null,
      one(mine({ name: 'sso_test', output: { ok: true, test: 'ok', status: status() } })),
      NOW,
    );
    const saved = selfView(
      tested,
      one(mine({ name: 'sso_set', output: { ok: true, status: status() } })),
      LATER,
    );
    expect(saved!.test).toBeNull();
    const savedLive = selfView(
      tested,
      one(mine({ name: 'sso_set', output: { ok: true, test: 'ok', status: status() } })),
      LATER,
    );
    expect(savedLive!.test?.code).toBe('ok');
    // A refused save keeps the last Test.
    const refused = selfView(
      tested,
      one(
        mine({ name: 'sso_set', ok: false, reason: 'mode', output: { ok: false, reason: 'mode' } }),
      ),
      LATER,
    );
    expect(refused!.test?.code).toBe('ok');
    expect(refused!.status).toEqual(status());
    expect(refused!.reason).toBe('mode');
  });

  it("reads only this box's answers", () => {
    expect(selfView(null, one(answer({ output: { ok: true, status: status() } })), NOW)).toBeNull();
  });

  it('is a row with its own name, its address from the redirect URI, and no version', () => {
    const r = selfRow('Control', 'https://fallback.example.invalid', null);
    expect(r).toEqual({
      id: 'self',
      url: 'https://fallback.example.invalid',
      label: 'Control',
      lastOkAt: null,
      lastReason: null,
      version: null,
      ssoView: null,
    });
    const view = selfView(null, one(mine({ output: { ok: true, status: status() } })), NOW);
    expect(selfRow('Control', 'https://fallback.example.invalid', view).url).toBe(
      'https://box.example.invalid',
    );
    const bare = selfView(
      null,
      one(mine({ output: { ok: true, status: status({ redirectUri: '' }) } })),
      NOW,
    );
    expect(selfRow('Control', 'https://fallback.example.invalid', bare).url).toBe(
      'https://fallback.example.invalid',
    );
  });

  it('readSelf asks the status of self alone, and folds it into the view held after the answer', async () => {
    const asked: FleetSsoAsk[] = [];
    const prev = selfView(
      null,
      one(mine({ name: 'sso_test', output: { ok: true, test: 'ok', status: status() } })),
      NOW,
    );
    let held = prev;
    const v = await readSelf(
      () => held,
      async (body) => {
        asked.push(body);
        // A save lands while the read is on its way: its stale Test stays stale.
        held = prev && { ...prev, test: null };
        return {
          answers: [mine({ output: { ok: true, status: status() } })],
          pending: [],
          gone: [],
        };
      },
      () => LATER,
    );
    expect(asked).toEqual([{ do: 'status', boxIds: ['self'] }]);
    expect(v).toMatchObject({ at: LATER, test: null });
    // With nothing landing, the read keeps the last Test.
    const kept = await readSelf(
      () => prev,
      async () => ({
        answers: [mine({ output: { ok: true, status: status() } })],
        pending: [],
        gone: [],
      }),
      () => LATER,
    );
    expect(kept).toMatchObject({ test: { code: 'ok' } });
  });

  it('the warning before required names this box, your own session and the .env of this box', () => {
    const lines = requiredWarning({ linked: 1, active: 3 }, true);
    expect(lines[0]).toContain('This is the box you are signed in to.');
    expect(lines[0]).toContain('yours too, unless you are the original account');
    expect(lines[2]).toContain('1 of 3 active logins are linked, 2 are not.');
    expect(lines[3]).toContain('the .env of this box');
    expect(lines[3]).toContain('--mode optional');
    // A fleet box keeps its own words.
    expect(requiredWarning({ linked: 1, active: 3 })[0]).toContain(
      'Every password session on the box ends',
    );
  });
});
