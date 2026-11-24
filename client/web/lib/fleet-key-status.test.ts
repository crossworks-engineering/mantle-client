import { describe, expect, it } from 'vitest';
import { ApiError } from '@mantle/web-ui/api-fetch';
import {
  ageText,
  answerPending,
  boxSummary,
  boxWantsTest,
  canTest,
  FLEET_KEY_STATUS_KEY,
  keyBoxName,
  keysReasonText,
  keyStateText,
  olderKeys,
  printText,
  readFailText,
  testAnswerText,
  testCallFailText,
  testedById,
  testedText,
  withTested,
  type FleetKeyBox,
  type FleetKeyLine,
} from './fleet-key-status';
import { FLEET_KEY } from './fleet';

const NOW = Date.parse('2026-11-24T12:00:00.000Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

const line = (over: Partial<FleetKeyLine> = {}): FleetKeyLine => ({
  service: 'openrouter',
  setAt: ago(600),
  print: 'sk-or-v1-abc…wxyz',
  testable: true,
  test: { ok: true, at: ago(5) },
  state: 'works',
  ...over,
});

const box = (over: Partial<FleetKeyBox> = {}): FleetKeyBox => ({
  id: 'b1',
  url: 'https://box-a.example',
  label: 'Box A',
  at: ago(2),
  reason: null,
  keys: [line()],
  keysReason: null,
  lastSet: null,
  ...over,
});

describe('ageText', () => {
  it('reads minutes, hours and days', () => {
    expect(ageText(ago(0), NOW)).toBe('just now');
    expect(ageText(ago(5), NOW)).toBe('5 min ago');
    expect(ageText(ago(180), NOW)).toBe('3 h ago');
    expect(ageText(ago(60 * 72), NOW)).toBe('3 days ago');
  });
  it('a time in the future reads as just now; no time or a bad one as unknown', () => {
    expect(ageText(new Date(NOW + 60_000).toISOString(), NOW)).toBe('just now');
    expect(ageText(null, NOW)).toBe('unknown');
    expect(ageText('not a date', NOW)).toBe('unknown');
  });
});

describe('keyStateText', () => {
  it('works: a green tick and the test time', () => {
    expect(keyStateText(line(), NOW)).toEqual({
      tone: 'ok',
      mark: 'tick',
      label: 'Works',
      text: 'Works, tested 5 min ago',
      wantsTest: false,
    });
  });
  it('failed: a red cross and the test time', () => {
    const s = keyStateText(line({ state: 'failed', test: { ok: false, at: ago(30) } }), NOW);
    expect(s).toEqual({
      tone: 'bad',
      mark: 'cross',
      label: 'Failed',
      text: 'Failed, tested 30 min ago',
      wantsTest: false,
    });
  });
  it('stale and not-tested ask for Test now; no-test does not', () => {
    expect(keyStateText(line({ state: 'stale' }), NOW)).toMatchObject({
      text: 'Set again since its last test',
      wantsTest: true,
    });
    expect(keyStateText(line({ state: 'not-tested', test: null }), NOW)).toMatchObject({
      text: 'Never tested',
      wantsTest: true,
    });
    expect(keyStateText(line({ state: 'no-test', test: null }), NOW)).toMatchObject({
      text: 'This service has no test',
      mark: 'none',
      wantsTest: false,
    });
  });
  it('an unknown state (a newer brain), or one named like an Object method, is plain', () => {
    for (const state of ['revoked', 'toString', '__proto__']) {
      expect(keyStateText(line({ state: state as FleetKeyLine['state'] }), NOW)).toEqual({
        tone: 'muted',
        mark: 'none',
        label: 'Unknown state',
        text: 'Unknown state',
        wantsTest: false,
      });
    }
  });
});

describe('testedText and printText', () => {
  it('the last test, or never', () => {
    expect(testedText(line(), NOW)).toBe('passed 5 min ago');
    expect(testedText(line({ test: { ok: false, at: ago(60) } }), NOW)).toBe('failed 1 h ago');
    expect(testedText(line({ test: null }), NOW)).toBe('never');
  });
  it('a null print reads "not shown"', () => {
    expect(printText(null)).toBe('not shown');
    expect(printText('sk-or-v1-abc…wxyz')).toBe('sk-or-v1-abc…wxyz');
  });
});

describe('keysReasonText', () => {
  it('each reason in plain words', () => {
    expect(keysReasonText('old-box')).toBe('Update this box to see its keys.');
    expect(keysReasonText('scope')).toBe('This box refuses the Control Center.');
    expect(keysReasonText('no-facts')).toBe('Not read yet.');
    expect(keysReasonText('error')).toBe('Key status failed on this box.');
    expect(keysReasonText('bad-reply')).toBe(
      'This box sent key lines the Control Center cannot read.',
    );
    expect(keysReasonText('keys-area')).toBe("You need the Keys area to see this box's keys.");
  });
  it('an unknown reason, null, or constructor gets the fallback', () => {
    expect(keysReasonText('later-reason')).toBe('This box sent no key lines.');
    expect(keysReasonText(null)).toBe('This box sent no key lines.');
    expect(keysReasonText('constructor')).toBe('This box sent no key lines.');
  });
});

describe('readFailText', () => {
  it('null when the read was good; the reason in words else', () => {
    expect(readFailText(null)).toBeNull();
    expect(readFailText('unreachable')).toBe('This box cannot reach the box over HTTPS.');
    expect(readFailText('http-502')).toBe('The box answered HTTP 502.');
    expect(readFailText('something-new')).toBe('The last run failed.');
  });
});

describe('testAnswerText', () => {
  it('each tested code in plain words', () => {
    expect(testAnswerText('ok')).toEqual({ tone: 'ok', text: 'Tested just now.' });
    expect(testAnswerText('scope').text).toMatch(/refuses the Control Center/);
    expect(testAnswerText('bad-call').text).toMatch(/update the box/);
    expect(testAnswerText('unreachable').text).toMatch(/Could not reach the box/);
    expect(testAnswerText('http-500').text).toBe('A test could not run on that box.');
    expect(testAnswerText('busy').text).toMatch(/10 calls already wait/);
    expect(testAnswerText('pending')).toEqual({
      tone: 'wait',
      text: 'No answer yet. Reading again shortly.',
    });
    expect(testAnswerText('keys-area').text).toMatch(/Keys area/);
    expect(testAnswerText('error').text).toBe('The test failed on this box.');
  });
  it('an unknown code (a newer brain) gets a safe generic text, never a crash', () => {
    for (const code of ['http-503', 'hasOwnProperty', '__proto__', '']) {
      expect(testAnswerText(code)).toEqual({
        tone: 'bad',
        text: 'The box did not finish the test.',
      });
    }
  });
});

describe('testCallFailText', () => {
  it('a 429 says to try again in a few minutes', () => {
    expect(testCallFailText(new ApiError('Too many', 429))).toBe(
      'Too many tests. Try again in a few minutes.',
    );
  });
  it('anything else is a plain failure', () => {
    expect(testCallFailText(new ApiError('nope', 500))).toBe('Could not run the test. Try again.');
    expect(testCallFailText(new Error('x'))).toBe('Could not run the test. Try again.');
  });
});

describe('the box', () => {
  it('the CC own box is "This box"; a linked one its label, else its host', () => {
    expect(keyBoxName({ id: 'self', url: null, label: null })).toBe('This box');
    expect(keyBoxName({ id: 'b1', url: 'https://box-a.example', label: 'Box A' })).toBe('Box A');
    expect(keyBoxName({ id: 'b2', url: 'https://box-b.example', label: null })).toBe(
      'box-b.example',
    );
  });
  it('Test now is offered unless the box refuses, is behind, or lacks the Keys area', () => {
    expect(canTest(box())).toBe(true);
    expect(canTest(box({ keys: null, keysReason: 'no-facts' }))).toBe(true);
    expect(canTest(box({ keys: null, keysReason: 'error' }))).toBe(true);
    for (const r of ['old-box', 'scope', 'keys-area'] as const) {
      expect(canTest(box({ keys: null, keysReason: r }))).toBe(false);
    }
  });
  it('a box wants a test while a line is stale or never tested', () => {
    expect(boxWantsTest(box())).toBe(false);
    expect(boxWantsTest(box({ keys: [line(), line({ state: 'stale' })] }))).toBe(true);
    expect(boxWantsTest(box({ keys: null, keysReason: 'error' }))).toBe(false);
  });
  it('the card line: a reason, no keys, failed, to test, or all fine', () => {
    expect(boxSummary(box({ keys: null, keysReason: 'scope' }))).toEqual({
      tone: 'muted',
      text: 'This box refuses the Control Center.',
    });
    expect(boxSummary(box({ keys: [] }))).toEqual({ tone: 'muted', text: 'Holds no keys.' });
    expect(boxSummary(box({ keys: [line(), line({ state: 'failed' })] })).text).toBe(
      '2 keys, 1 failed',
    );
    expect(boxSummary(box({ keys: [line({ state: 'not-tested' })] })).text).toBe(
      '1 key, 1 to test',
    );
    expect(boxSummary(box())).toEqual({ tone: 'ok', text: '1 key, all fine' });
  });
});

describe('Test now answers', () => {
  const self = box({ id: 'self', url: null, label: null });
  const b = box({ id: 'b1' });
  it('the answered boxes replace their old lines; tested is kept apart', () => {
    const fresh = { ...b, keys: [line({ state: 'failed' })], tested: 'ok' };
    const out = withTested({ boxes: [self, b] }, { boxes: [fresh] });
    expect(out.boxes[0]).toBe(self);
    expect(out.boxes[1]).toEqual({ ...b, keys: [line({ state: 'failed' })] });
    expect('tested' in out.boxes[1]!).toBe(false);
    expect(testedById({ boxes: [fresh] })).toEqual({ b1: 'ok' });
  });
  it('a pending box asks for a read again', () => {
    expect(answerPending({ boxes: [{ ...b, tested: 'ok' }] })).toBe(false);
    expect(answerPending({ boxes: [{ ...b, tested: 'pending' }] })).toBe(true);
  });
  it('the query key sits under the Fleet key: a Fleet refresh reads it again', () => {
    expect(FLEET_KEY_STATUS_KEY.slice(0, FLEET_KEY.length)).toEqual(FLEET_KEY);
  });
});

describe('olderKeys', () => {
  it('marks a line set earlier with another print than the newest of its service', () => {
    const a = box({ id: 'a', keys: [line({ setAt: ago(10), print: 'sk-or-v1-new…aaaa' })] });
    const b = box({ id: 'b', keys: [line({ setAt: ago(9000), print: 'sk-or-v1-old…bbbb' })] });
    const c = box({ id: 'c', keys: [line({ setAt: ago(500), print: 'sk-or-v1-new…aaaa' })] });
    const d = box({ id: 'd', keys: [line({ setAt: ago(700), print: null })] });
    const e = box({ id: 'e', keys: null, keysReason: 'scope' });
    expect(olderKeys([a, b, c, d, e])).toEqual(new Set(['b:openrouter', 'd:openrouter']));
  });
  it('services are compared apart; one box alone holds no older key', () => {
    const a = box({
      id: 'a',
      keys: [
        line({ service: 'openrouter', setAt: ago(10) }),
        line({ service: 'anthropic', setAt: ago(9000), print: 'sk-ant-api03…cccc' }),
      ],
    });
    expect(olderKeys([a])).toEqual(new Set());
  });
});
