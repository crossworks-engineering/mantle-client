import { describe, expect, it } from 'vitest';
import {
  FLEET_TOOL_PATH,
  isNoChannel,
  NO_CHANNEL_TEXT,
  outcomeOf,
  parseToolReply,
  runFleetTool,
  toolReasonText,
  USERS_LIST_TOOL,
  WORKSPACE_USER_SET_TOOL,
  type Send,
} from './fleet-tool';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const call = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;
const answer = (id: string, boxId: string, more: Record<string, unknown>) => ({
  id,
  boxId,
  kind: 'tool',
  name: USERS_LIST_TOOL,
  by: 'it@example.com',
  at: '2026-11-12T10:00:00.000Z',
  done: '2026-11-12T10:00:01.000Z',
  ...more,
});

describe('fleet tool (the admin channel)', () => {
  it('names its route and the two box tools', () => {
    expect(FLEET_TOOL_PATH).toBe('/api/fleet/tool');
    expect(USERS_LIST_TOOL).toBe('users_list');
    expect(WORKSPACE_USER_SET_TOOL).toBe('workspace_user_set');
  });

  it('reads the route reply, held to the boxes asked and the calls made', () => {
    const r = parseToolReply(
      {
        answers: [
          answer(call(1), A, { ok: true, reason: null, output: { n: 1 } }),
          answer(call(2), B, { ok: false, reason: 'scope' }),
          answer(call(3), C, { ok: true, output: 'not asked' }),
          answer('not-a-uuid', A, { ok: true }),
          answer(call(4), A, { ok: 'yes' }),
          answer(call(5), B, { ok: true, truncated: true, output: '{"cut' }),
          answer(call(6), A, { ok: false, reason: 'Some <b>text</b>' }),
        ],
        pending: [call(7), 'junk'],
        gone: [call(8)],
      },
      { boxIds: [A, B] },
    );
    expect(r.answers.map((a) => [a.callId, a.boxId, a.ok, a.reason, a.output])).toEqual([
      [call(1), A, true, null, { n: 1 }],
      [call(2), B, false, 'scope', undefined],
      [call(4), A, false, 'no-reason', undefined],
      [call(5), B, false, 'truncated', undefined],
      [call(6), A, false, 'error', undefined],
    ]);
    expect(r.pending).toEqual([call(7)]);
    expect(r.gone).toEqual([call(8)]);
    // A follow-up keeps only the calls it asks about.
    const f = parseToolReply(
      { answers: [answer(call(1), A, { ok: true }), answer(call(9), A, { ok: true })] },
      { boxIds: [A], callIds: [call(1)] },
    );
    expect(f.answers.map((a) => a.callId)).toEqual([call(1)]);
  });

  it('sorts reasons into not run and unknown', () => {
    for (const r of [
      'scope',
      'tool',
      'size',
      'busy',
      'replay',
      'expired',
      'bad-call',
      'not-queued',
      'no-channel',
      'forbidden',
      'too-large',
      'invalid',
    ]) {
      expect(outcomeOf({ ok: false, reason: r })).toBe('not-run');
    }
    // error: the tool threw while running; refused with no rows; no reason;
    // a code this box does not know: all unknown (audit N1).
    for (const r of [
      'error',
      'refused',
      'no-reason',
      'odd-code',
      'pending',
      'timeout',
      'network',
      'unreachable',
      'gone',
      'truncated',
    ]) {
      expect(outcomeOf({ ok: false, reason: r })).toBe('unknown');
    }
    expect(outcomeOf({ ok: true, reason: null })).toBe('ok');
  });

  it('words each reason', () => {
    expect(toolReasonText('scope')).toBe(
      'This box has not opened its admin tools to the Control Center (MANTLE_CONTROL_CENTER_SCOPE).',
    );
    expect(toolReasonText('tool', USERS_LIST_TOOL)).toBe(
      'This box does not offer users_list to the Control Center yet (a box release, and the admin scope must include it).',
    );
    expect(toolReasonText('truncated')).toBe(
      "The box's answer was too large; showing nothing for this box.",
    );
    expect(toolReasonText('error')).toBe('The box hit an error while running it.');
    expect(toolReasonText('unreachable')).toBe('This box cannot reach the box over HTTPS.');
    expect(toolReasonText('sig')).toBe('The box holds another key. Copy the key line again.');
    expect(toolReasonText('no-channel')).toBe(NO_CHANNEL_TEXT);
    for (const r of ['busy', 'replay', 'expired', 'size']) {
      expect(toolReasonText(r)).not.toBe('The box could not run it.');
    }
  });

  it('takes only the plain not-found as no channel (audit L7)', () => {
    const e = (status: number, body?: unknown) => Object.assign(new Error('x'), { status, body });
    expect(isNoChannel(e(404, { error: 'not found' }))).toBe(true);
    expect(isNoChannel(e(405))).toBe(true);
    expect(isNoChannel(e(404, { error: 'Box not found.' }))).toBe(false);
    expect(isNoChannel(e(404, { error: 'not found', code: 'x' }))).toBe(false);
    expect(isNoChannel(e(400, { error: 'not found' }))).toBe(false);
  });

  it('runs a call, follows up a pending one, and says what stays unknown', async () => {
    const sent: unknown[] = [];
    const replies: unknown[] = [
      { answers: [answer(call(1), A, { ok: true, output: 1 })], pending: [call(2)], gone: [] },
      { answers: [], pending: [call(2)], gone: [] },
      { answers: [answer(call(2), B, { ok: true, output: 2 })], pending: [], gone: [] },
    ];
    const send: Send = async (body) => {
      sent.push(body);
      return replies.shift();
    };
    const slept: number[] = [];
    const out = await runFleetTool(
      [A, B],
      USERS_LIST_TOOL,
      {},
      {
        send,
        followUps: 3,
        sleep: async (ms) => void slept.push(ms),
      },
    );
    expect(sent).toEqual([
      { boxIds: [A, B], name: 'users_list', args: {} },
      { callIds: [call(2)] },
      { callIds: [call(2)] },
    ]);
    expect(slept).toEqual([30_000, 30_000]);
    expect(out).toEqual([
      { boxId: A, outcome: 'ok', reason: null, output: 1 },
      { boxId: B, outcome: 'ok', reason: null, output: 2 },
    ]);

    // Still pending after every follow-up: unknown, never "not run".
    const stuck: Send = async (body) =>
      (body as { callIds?: string[] }).callIds
        ? { answers: [], pending: [call(2)], gone: [] }
        : { answers: [], pending: [call(2)], gone: [] };
    const left = await runFleetTool(
      [A],
      WORKSPACE_USER_SET_TOOL,
      {},
      {
        send: stuck,
        followUps: 3,
        sleep: async () => {},
      },
    );
    expect(left).toEqual([{ boxId: A, outcome: 'unknown', reason: 'pending', output: undefined }]);
  });

  it('a timeout, a 400 and a missing route each end their own way (audit L9)', async () => {
    const hang: Send = (_body, signal) =>
      new Promise((_r, reject) =>
        signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        ),
      );
    expect(await runFleetTool([A], USERS_LIST_TOOL, {}, { send: hang, timeoutMs: 5 })).toEqual([
      { boxId: A, outcome: 'unknown', reason: 'timeout', output: undefined },
    ]);
    const full: Send = async () => {
      throw Object.assign(new Error('No call was queued'), { status: 400, body: { error: 'x' } });
    };
    expect(await runFleetTool([A], USERS_LIST_TOOL, {}, { send: full })).toEqual([
      { boxId: A, outcome: 'not-run', reason: 'not-queued', output: undefined },
    ]);
    const gone: Send = async () => {
      throw Object.assign(new Error('not found'), { status: 404, body: { error: 'not found' } });
    };
    expect(await runFleetTool([A], USERS_LIST_TOOL, {}, { send: gone })).toBeNull();
    // Refused by the Control Center before queueing: not run, its own words (audit N6).
    for (const [status, code] of [
      [403, 'forbidden'],
      [413, 'too-large'],
      [422, 'invalid'],
    ] as const) {
      const refused: Send = async () => {
        throw Object.assign(new Error('no'), { status, body: { error: 'no' } });
      };
      expect(await runFleetTool([A], USERS_LIST_TOOL, {}, { send: refused })).toEqual([
        { boxId: A, outcome: 'not-run', reason: code, output: undefined },
      ]);
      expect(toolReasonText(code)).toMatch(/^The Control Center refused the call/);
    }
    const net: Send = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await runFleetTool([A], USERS_LIST_TOOL, {}, { send: net })).toEqual([
      { boxId: A, outcome: 'unknown', reason: 'network', output: undefined },
    ]);
  });
});
